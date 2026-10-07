"""Read a reviewed companion ZIP without executing any downloaded code.

Production admission uses only the controller-owned finite registry. A direct
Python call may provide one independently built test entry; the CLI cannot.
"""
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / 'contracts'
MAX_ZIP = 128 * 1024 * 1024
MAX_PROJECTION = 256 * 1024 * 1024
MAX_METADATA = 16 * 1024 * 1024
ENTRY_KEYS = {'reference','tree_sha','source','request','code_manifest','controller_contracts','artifact_layout','captured_inventory_sha256','fresh_receipt_inventory_sha256'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def exact(value, keys, label):
    require(isinstance(value, dict) and set(value) == set(keys), 'Invalid closed ' + label)


def parse(content):
    def pairs(values):
        result = {}
        for key,value in values:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(content,object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def canonical(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()


def sha(content):
    return hashlib.sha256(content).hexdigest()


def digest(value):
    return sha(canonical(value))


def git_blob(content):
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()


def valid_hash(value, length=64):
    return isinstance(value,str) and re.fullmatch('[a-f0-9]{'+str(length)+'}',value) is not None


def clock(value):
    require(isinstance(value,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})',value), 'Invalid receipt clock')
    return datetime.fromisoformat(value.replace('Z','+00:00'))


def safe_name(name, *, directory=False):
    require(isinstance(name,str) and name and not PurePosixPath(name).is_absolute() and '\\' not in name
            and all(part not in ('','.','..') for part in (name[:-1] if directory else name).split('/'))
            and (name.endswith('/') if directory else not name.endswith('/')), 'Unsafe archive member path')


def load_contracts():
    paths = {'reference_sha256':'financial_source_postcapture_reference_v1.json',
             'request_sha256':'financial_source_postcapture_request_v1.json',
             'receipt_schema_sha256':'financial_source_postcapture_receipt_v1.schema.json'}
    raw = {key:(CONTRACTS/name).read_bytes() for key,name in paths.items()}
    return {key:parse(value) for key,value in raw.items()}, {key:sha(value) for key,value in raw.items()}, raw


def select_review(receipt_sha256, reviewed_entry=None):
    if reviewed_entry is None:
        trust = parse((CONTRACTS/'financial_source_postcapture_trust_v1.json').read_bytes())
        exact(trust, ['schema_version','reviewed_requests'], 'postcapture trust registry')
        require(trust['schema_version']=='financial-source-postcapture-trust-v1' and isinstance(trust['reviewed_requests'],list)
                and len(trust['reviewed_requests'])<=32, 'Invalid finite postcapture registry')
        matches=[item for item in trust['reviewed_requests'] if item.get('reference',{}).get('receipt_sha256')==receipt_sha256]
        require(len(matches)==1, 'Receipt is not independently admitted by the finite controller registry')
        reviewed_entry=matches[0]
    exact(reviewed_entry,ENTRY_KEYS,'reviewed postcapture entry')
    require(reviewed_entry['reference'].get('receipt_sha256')==receipt_sha256, 'Reviewed receipt identity mismatch')
    return reviewed_entry


def verify_review(review, contracts, hashes, raw):
    request = contracts['request_sha256']
    require(review['controller_contracts']==hashes and review['source']==request['source'], 'Controller-owned contracts/source differ from review')
    exact(review['request'],['path','raw_sha256','canonical_sha256','git_blob_sha'],'reviewed request')
    require(review['request']=={'path':'.github/financial-source-postcapture/request.json','raw_sha256':hashes['request_sha256'],
            'canonical_sha256':digest(request),'git_blob_sha':git_blob(raw['request_sha256'])}, 'Reviewed closed request binding mismatch')
    require(valid_hash(review['tree_sha'],40) and isinstance(review['code_manifest'],dict)
            and set(review['code_manifest'])==set(contracts['reference_sha256']['required_code_paths']) and len(review['code_manifest'])==53, 'Incomplete independently reviewed code manifest')
    for path,entry in review['code_manifest'].items():
        safe_name(path)
        exact(entry,['bytes','sha256','git_blob_sha'],'reviewed code file')
        require(type(entry['bytes']) is int and 0<entry['bytes']<=MAX_METADATA and valid_hash(entry['sha256']) and valid_hash(entry['git_blob_sha'],40), 'Invalid reviewed code blob')
    code=review['code_manifest']
    for path,raw_bytes in [('.github/financial-source-postcapture/request.json',raw['request_sha256']),
                           ('.github/financial-source-postcapture/receipt.schema.json',raw['receipt_schema_sha256'])]:
        require(code.get(path)=={'bytes':len(raw_bytes),'sha256':sha(raw_bytes),'git_blob_sha':git_blob(raw_bytes)}, 'Reviewed code does not bind controller schema/request')
    require(review['captured_inventory_sha256']==request['captured_inventory']['sha256']
            and review['fresh_receipt_inventory_sha256']==request['refresh']['new_receipt_inventory_sha256'], 'Reviewed source inventories mismatch')
    layout=review['artifact_layout']
    exact(layout,['companion_prefix','files','directories'],'reviewed artifact layout')
    safe_name(layout['companion_prefix'],directory=True)
    require(isinstance(layout['files'],dict) and 11<=len(layout['files'])<=100 and isinstance(layout['directories'],list)
            and len(set(layout['directories']))==len(layout['directories']), 'Unbounded/duplicate reviewed ZIP layout')
    for name,entry in layout['files'].items():
        safe_name(name);exact(entry,['bytes','sha256'],'reviewed archive member')
        require(type(entry['bytes']) is int and 0<=entry['bytes']<=MAX_PROJECTION and valid_hash(entry['sha256']), 'Invalid reviewed archive member')
    for name in layout['directories']: safe_name(name,directory=True)
    require(not set(layout['files']) & set(layout['directories']), 'Conflicting reviewed ZIP paths')


def verify_projection(projection, receipt, fields):
    summary=receipt['projection'];source=receipt['source']
    exact(projection,['bindings','evaluated_at','knowledge_basis','point_in_time','qualification_authority','receipt_inventory','schema_version','source_data_as_of','source_publication_date','symbols'],'source-bound projection')
    require(projection['bindings']=={key:source[key] for key in ('archive_manifest_sha256','acquisition_base_sha256','cohort_sha256')}
            and projection['evaluated_at']==receipt['evaluated_at']
            and all(projection[key]==summary[key] for key in ('schema_version','knowledge_basis','point_in_time','qualification_authority','source_data_as_of','source_publication_date')), 'Projection source/time semantics mismatch')
    require(isinstance(projection['symbols'],dict) and len(projection['symbols'])==summary['cohort_count']==1894, 'Full projected cohort mismatch')
    inventory=projection['receipt_inventory']
    require(isinstance(inventory,list) and len(inventory)==summary['retained_receipts']==4154 and digest(inventory)==summary['receipt_inventory_sha256'], 'Receipt inventory digest/count mismatch')
    ids=[item['sha256'] for item in inventory]
    require(ids==sorted(set(ids)) and all(valid_hash(key) for key in ids), 'Duplicate/unsorted original receipt identity')
    for item in inventory:
        exact(item,['sha256','attribute','capture_id','observed_at','origin_binding','symbol'],'projected source receipt')
        require(item['attribute'] in {'income_stmt','quarterly_income_stmt'} and item['symbol'] in projection['symbols']
                and isinstance(item['capture_id'],str) and item['capture_id']
                and clock(item['observed_at'])<=clock(receipt['evaluated_at']), 'Source receipt identity/clock changed')
        exact(item['origin_binding'],['base_artifact_sha256','source_data_as_of'],'original receipt binding')
    times=[item['observed_at'] for item in inventory]
    require(summary['source_timestamp_bounds']=={'earliest':min(times,key=clock),'latest':max(times,key=clock)}, 'Original source timestamp bounds mismatch')
    for field,counts in summary['counts'].items():
        actual=Counter(item['availability_classification'][field] for item in projection['symbols'].values())
        require(set(actual)<=set(counts) and counts=={key:actual[key] for key in counts}, 'Availability counts differ from projected unknowns')
    # Only check declared proof expiry, never recalculate financial arithmetic.
    evaluated_ms=clock(receipt['evaluated_at']).timestamp()*1000
    capture_clocks={(item['symbol'],item['capture_id']):item['observed_at'] for item in inventory}
    for symbol,item in projection['symbols'].items():
        proof=item['financial_current']
        for field in ('eps_growth_yy','sales_growth_yy'):
            position=fields.index(field)
            category=item['availability_classification'][field]
            if category in {'ordinary','nonpositive'}:
                require(str(position) in proof['p'] and len(proof['p'][str(position)])>=6
                        and evaluated_ms<=proof['p'][str(position)][5], 'Expired availability was promoted')
                record=item['envelope']['financial_source_evidence']['fields'][field]
                observed=capture_clocks.get((symbol,record.get('capture_id')))
                require(observed==record.get('observed_at') and observed is not None
                        and proof['p'][str(position)][4]==round(clock(observed).timestamp()*1000), 'Proof renewed or changed original source clock')
    return inventory


def verify(path, receipt_sha256, reviewed_entry=None):
    path=Path(path)
    require(valid_hash(receipt_sha256), 'Invalid receipt digest')
    require(not path.is_symlink() and path.is_file() and path.stat().st_nlink==1 and path.stat().st_size<=MAX_ZIP, 'Unsafe or oversized companion ZIP')
    review=select_review(receipt_sha256,reviewed_entry)
    contracts,hashes,raw=load_contracts();verify_review(review,contracts,hashes,raw)
    reference=review['reference'];contract=contracts['reference_sha256'];request=contracts['request_sha256']
    exact(reference,contract['reference_keys'],'postcapture reference')
    require(reference['schema_version']==contract['schema_version'] and reference['repository']==contract['repository']
            and reference['workflow']==contract['validator_workflow'] and valid_hash(reference['head_sha'],40)
            and all(type(reference[key]) is int and 0<reference[key]<=9007199254740991 for key in ('run_id','run_attempt','job_id','artifact_id'))
            and reference['artifact_name']==f"{contract['artifact_prefix']}-{reference['head_sha']}-{reference['run_attempt']}"
            and valid_hash(reference['artifact_sha256']), 'Invalid exact companion reference')
    zip_bytes=path.read_bytes();require(sha(zip_bytes)==reference['artifact_sha256'], 'Companion artifact ZIP digest mismatch')
    layout=review['artifact_layout'];prefix=layout['companion_prefix']
    with zipfile.ZipFile(path) as zipped:
        infos=zipped.infolist();require(len(infos)==len(layout['files'])+len(layout['directories'])<=100, 'Unexpected artifact member count')
        seen=set();total=0;contents={}
        for info in infos:
            name,mode=info.filename,info.external_attr>>16
            safe_name(name,directory=info.is_dir())
            require(name not in seen and not info.flag_bits&1 and not stat.S_ISLNK(mode)
                    and (not stat.S_IFMT(mode) or stat.S_ISREG(mode) or info.is_dir() and stat.S_ISDIR(mode)), 'Duplicate, encrypted or special ZIP member')
            seen.add(name)
            if info.is_dir():
                require(name in layout['directories'] and info.file_size==0, 'Unreviewed ZIP directory');continue
            expected=layout['files'].get(name)
            maximum=MAX_PROJECTION if name.startswith(prefix+'projections/') else MAX_METADATA
            require(expected is not None and info.file_size==expected['bytes'] and 0<=info.file_size<=maximum, 'Unreviewed/oversized ZIP member')
            data=zipped.read(info);require(len(data)==expected['bytes'] and sha(data)==expected['sha256'], 'Reviewed ZIP member changed: '+name)
            contents[name]=data;total+=len(data)
            require(total<=MAX_PROJECTION+32*MAX_METADATA, 'Expanded companion ZIP exceeds bound')
        require(seen==set(layout['files'])|set(layout['directories']), 'Incomplete exact artifact layout')
    def body(relative):
        require(prefix+relative in contents,'Missing companion member: '+relative)
        return contents[prefix+relative]
    receipt_bytes=body('receipt.json');require(sha(receipt_bytes)==receipt_sha256, 'Receipt body digest mismatch')
    receipt=parse(receipt_bytes)
    Draft202012Validator(contracts['receipt_schema_sha256'],format_checker=FormatChecker()).validate(receipt)
    require(canonical(receipt)==receipt_bytes, 'Companion receipt must retain its canonical bytes')
    expected_names={'receipt.json','request.json','api-evidence.json','source-api-evidence.json','producer-job.log','validation-code-manifest.json','captured-inventory.json','fresh-receipts.json','retained-failures.json','reviewed-projector-migrations.json',receipt['projection']['path']}
    require({name[len(prefix):] for name in contents if name.startswith(prefix)}==expected_names, 'Unexpected companion output inventory')
    require(receipt['source']==request['source']==review['source'], 'Companion failed-source tuple mismatch')
    validation=receipt['validation']
    require(validation['code_sha']==reference['head_sha'] and validation['tree_sha']==review['tree_sha']
            and validation['request_sha256']==hashes['request_sha256'] and validation['request_canonical_sha256']==digest(request)
            and validation['receipt_schema_sha256']==hashes['receipt_schema_sha256'], 'Receipt review/code/schema binding mismatch')
    require(body('request.json')==raw['request_sha256'] and git_blob(body('request.json'))==review['request']['git_blob_sha'], 'Committed request bytes mismatch')
    manifest=parse(body('validation-code-manifest.json'))
    require(manifest==review['code_manifest'] and digest(manifest)==validation['code_manifest_sha256'], 'Self-reported code is not independently reviewed')
    require(validation['request_schema_sha256']==manifest['.github/financial-source-postcapture/request.schema.json']['sha256'], 'Request schema differs from reviewed code')
    for filename,expected in [('api-evidence.json',validation['api_evidence_sha256']),('source-api-evidence.json',validation['source_api_evidence_sha256']),
            ('producer-job.log',request['failure_boundary']['job_log_sha256']),('captured-inventory.json',review['captured_inventory_sha256']),
            ('fresh-receipts.json',review['fresh_receipt_inventory_sha256']),('retained-failures.json',receipt['retained_failures']['sha256']),
            ('reviewed-projector-migrations.json',receipt['reviewed_projector_migrations']['sha256']),
            (receipt['projection']['path'],receipt['projection']['sha256'])]:
        require(sha(body(filename))==expected,'Companion referenced output mismatch: '+filename)
    projection_bytes=body(receipt['projection']['path'])
    require(receipt['projection']['path']==f"projections/{sha(projection_bytes)}.json" and len(projection_bytes)==receipt['projection']['bytes'], 'Projection path/length mismatch')
    projection=parse(projection_bytes)
    # Read field ordering from the reviewed frozen contract via the controller's
    # existing immutable financial-current contract; the reader never runs it.
    financial_contract_bytes=(CONTRACTS/'static_financial_current_v1.json').read_bytes()
    require(sha(financial_contract_bytes)==manifest['.github/financial-source-postcapture/frozen/contracts/static_financial_current_v1.json']['sha256'], 'Financial proof contract differs from reviewed frozen code')
    fields=parse(financial_contract_bytes)['field_order']
    inventory=verify_projection(projection,receipt,fields)
    captured=parse(body('captured-inventory.json'))
    exact(captured,['schema_version','artifact_sha256','expanded_bytes','files','member_count'],'captured file inventory')
    require(captured['schema_version']=='postcapture-artifact-inventory-v1' and captured['artifact_sha256']==request['source']['artifact_sha256'] and captured['member_count']==len(captured['files'])==10055
            and captured['expanded_bytes']==sum(item['bytes'] for item in captured['files'].values())==227789637, 'Captured all-file inventory mismatch')
    for name,item in captured['files'].items():
        safe_name(name);exact(item,['bytes','sha256'],'captured file');require(valid_hash(item['sha256']) and type(item['bytes']) is int and 0<=item['bytes']<=32*1024*1024,'Invalid captured file metadata')
    fresh=parse(body('fresh-receipts.json'));ids=[item['sha256'] for item in fresh]
    require(len(fresh)==400 and ids==sorted(set(ids)) and digest(ids)==request['refresh']['new_receipt_ids_sha256'], 'Fresh 400 receipt identity mismatch')
    by_id={item['sha256']:item for item in inventory}
    require(all(by_id.get(item['sha256'])==item and captured['files'].get('archive/objects/'+item['sha256']+'.json',{}).get('sha256')==item['sha256'] for item in fresh)
            and len({item['symbol'] for item in fresh})==200
            and Counter(item['attribute'] for item in fresh)=={'income_stmt':200,'quarterly_income_stmt':200}, 'Fresh receipts do not bind captured source and full selected cohort')
    failures=parse(body('retained-failures.json'));migrations=parse(body('reviewed-projector-migrations.json'))
    require(len(failures)==receipt['retained_failures']['count'] and dict(Counter(item['category'] for item in failures))==receipt['retained_failures']['categories']
            and len(migrations)==receipt['reviewed_projector_migrations']['count'], 'Retained failure/migration inventory mismatch')
    source_api=parse(body('source-api-evidence.json'));evidence=parse(body('api-evidence.json'))
    exact(source_api,['run','jobs','artifacts'],'original source API evidence');exact(evidence,['run','jobs','artifacts','validator'],'complete recorded API evidence')
    require({key:evidence[key] for key in source_api}==source_api, 'Recorded source API snapshots differ')
    require(len(body('producer-job.log'))==request['failure_boundary']['job_log_bytes'], 'Original producer log length mismatch')
    require(sha(path.read_bytes())==reference['artifact_sha256'], 'Companion ZIP changed during verification')
    return {'receipt':receipt,'source_api_evidence':source_api,'validator_api_snapshot':evidence['validator']}


if __name__=='__main__':
    require(len(sys.argv)==3,'Usage: verify-postcapture-correction-archive.py ZIP RECEIPT_SHA256')
    result=canonical(verify(Path(sys.argv[1]),sys.argv[2]))
    require(len(result)+1<=16*1024*1024,'Verified metadata stdout exceeds bound')
    print(result.decode())
