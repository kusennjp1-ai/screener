#!/usr/bin/env python3
"""Exact historical A11 inputs for FUTU response capture only; no publication authority.
Download, ZIP/TAR/path and reserve machinery is adapted from reviewed e5eede1b.
"""
import hashlib,json,os,pathlib,shutil,stat,subprocess,sys,tarfile,zipfile,time,signal,selectors,tempfile,datetime,base64
REPO='kusennjp1-ai/screener'
HEAD='f4e00a1c840cb15b2b4a84c2ca442c0dbd60a607'
SOURCE_TREE='55a6960c0c59eb76121096cc62dba6bc2c931275'
PARENT='b464cd32691853b7128189f4e3350b74959468bb'
BRANCH='preview/oct6-actual-futu-capture-20261008'
WORKFLOW='.github/workflows/oct6-actual-futu-capture.yml'
RESERVE=8*1024**3
CAP=2*1024**3
ROOT=pathlib.Path(os.environ['RUNNER_TEMP'])/'oct6-actual-futu-capture'
REPORT=ROOT/'reports'
REPORT.mkdir(parents=True,exist_ok=False)
PINS={
 'source':{'run':37796977804,'head':HEAD,'artifact':11559992871,'bytes':318517277,'sha256':'a48c7653cf6fce0fb5915146b68d218c333b9764521407847353321886f65690','name':'static-site-data-37796977804-1'},
 'companion':{'run':37796977804,'head':HEAD,'artifact':11559054639,'bytes':7302589,'sha256':'b554ab891dbb17d08f5a6675992b2f04e83218419ebe040587b124f812b58b33','name':'static-site-data-manifest-37796977804-1'},
}
def require(value,message):
 if not value:raise RuntimeError(message)
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def reserve(extra=0):
 require(shutil.disk_usage(ROOT).free>=RESERVE+extra,'Eight GiB reserve would be exceeded')
def save(name,value):
 (REPORT/name).write_text(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
def api(route,name):
 result=subprocess.run(['gh','api',route],capture_output=True,timeout=60)
 require(result.returncode==0,'GitHub metadata read failed')
 require(len(result.stdout)<=16*1024**2,'Metadata response too large')
 value=json.loads(result.stdout);(REPORT/name).write_bytes(result.stdout);return value
def clean(name):
 while name.startswith('./'):name=name[2:]
 name=name.rstrip('/')
 require(name and not name.startswith('/') and '\\' not in name and all(x not in ('','.','..') for x in name.split('/')) and not any(ord(x)<32 or ord(x)==127 for x in name),'Unsafe archive path')
 return name
def download(role,pin):
 artifact=api(f'repos/{REPO}/actions/artifacts/{pin["artifact"]}',role+'-artifact.json')
 require(artifact['id']==pin['artifact'] and artifact['name']==pin['name'] and artifact['size_in_bytes']==pin['bytes'] and artifact['digest']=='sha256:'+pin['sha256'] and artifact['expired'] is False,'Artifact pin mismatch')
 require(artifact['workflow_run']['id']==pin['run'] and artifact['workflow_run']['head_sha']==pin['head'] and artifact['workflow_run']['repository_id']==1203919607 and artifact['workflow_run']['head_repository_id']==1203919607 and artifact['workflow_run']['head_branch']=='main','Artifact origin mismatch')
 require(parse_time(artifact['expires_at'])>time.time(),'Artifact expired')
 for suffix in ('','/attempts/1'):
  run=api(f'repos/{REPO}/actions/runs/{pin["run"]}'+suffix,role+('-current.json' if not suffix else '-attempt.json'))
  require(run['id']==pin['run'] and run['head_sha']==pin['head'] and run['run_attempt']==1 and run['head_branch']=='main' and run['status']=='completed' and run['conclusion']=='success' and run['repository']['id']==1203919607 and run['path']=='.github/workflows/static-site.yml' and run['event']=='workflow_run' and run['workflow_id']==294257497 and run['head_repository']['id']==1203919607,'Original run binding mismatch')
 reserve(pin['bytes']+CAP)
 path=ROOT/(role+'.zip')
 with path.open('xb') as out,tempfile.TemporaryFile() as errors:
  child=subprocess.Popen(['gh','api',f'repos/{REPO}/actions/artifacts/{pin["artifact"]}/zip'],stdout=subprocess.PIPE,stderr=errors)
  selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ)
  deadline=time.monotonic()+240;count=0
  try:
   while True:
    remaining=deadline-time.monotonic();require(remaining>0,'Archive download deadline')
    events=selector.select(min(remaining,2))
    if not events:continue
    block=os.read(child.stdout.fileno(),1024*1024)
    if not block:break
    count+=len(block);require(count<=pin['bytes'],'Archive download exceeded exact byte cap');out.write(block)
   require(child.wait(timeout=max(.1,deadline-time.monotonic()))==0,'Archive download failed')
  finally:
   selector.close();child.stdout.close()
   if child.poll() is None:
    child.kill();child.wait(timeout=2)
 require(path.stat().st_size==pin['bytes'] and sha(path)==pin['sha256'],'Archive bytes/hash mismatch')
 return path
def zip_files(path):
 z=zipfile.ZipFile(path);entries=z.infolist();seen=set();total=0
 require(len(entries)<=10000,'ZIP inventory too large')
 for item in entries:
  name=clean(item.filename);require(name not in seen,'Duplicate ZIP path');seen.add(name)
  mode=item.external_attr>>16
  require(not item.flag_bits&1 and not stat.S_ISLNK(mode),'Encrypted or linked ZIP entry')
  total+=item.file_size
 require(total<=CAP,'ZIP decoded cap exceeded')
 return z,entries

def unique(pairs):
 value={}
 for key,item in pairs:
  require(key not in value,'Duplicate JSON key');value[key]=item
 return value
def parse(raw):
 return json.loads(raw.decode('utf-8') if isinstance(raw,bytes) else raw,object_pairs_hook=unique)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def parse_time(value):
 require(isinstance(value,str) and value.endswith('Z'),'Missing UTC artifact/job clock')
 return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
def equal(left,right,message):require(left==right,message)
def current_and_attempt():
 values=[]
 for suffix in ('','/attempts/1'):
  run=api(f'repos/{REPO}/actions/runs/37796977804'+suffix,'producer'+('-current.json' if not suffix else '-attempt.json'))
  require(run['id']==37796977804 and run['run_attempt']==1 and run['head_sha']==HEAD and run['head_branch']=='main' and run['path']=='.github/workflows/static-site.yml' and run['workflow_id']==294257497 and run['event']=='workflow_run' and run['status']=='completed' and run['conclusion']=='success' and run['repository']['id']==1203919607 and run['head_repository']['id']==1203919607,'Historical A11 producer changed')
  values.append(run)
 equal([(r['id'],r['run_attempt'],r['head_sha'],r['status'],r['conclusion']) for r in values],[ (37796977804,1,HEAD,'completed','success')]*2,'Producer attempts differ')
 jobs=api(f'repos/{REPO}/actions/runs/37796977804/attempts/1/jobs?per_page=100','producer-jobs.json')
 require(jobs['total_count']==len(jobs['jobs']) and len(jobs['jobs'])<=100,'Incomplete producer jobs')
 selected=[j for j in jobs['jobs'] if j['name']=='combine-and-build' and j['conclusion']=='success']
 require(len(selected)==1,'Ambiguous historical producer job')
 job=selected[0]
 require(job['run_id']==37796977804 and job['run_attempt']==1 and job['head_sha']==HEAD and job['status']=='completed' and parse_time(job['started_at'])<=parse_time(job['completed_at'])<=time.time(),'Producer job identity/clock changed')
 for name in ('Build static frontend','Verify finite retained-price repair','Upload verified data export','Record exact export attempt and dated evidence','Preserve dated export provenance for release selection'):
  steps=[s for s in job['steps'] if s['name']==name]
  require(len(steps)==1 and steps[0]['conclusion']=='success','Missing successful historical producer step '+name)
 commit=api(f'repos/{REPO}/git/commits/{HEAD}','producer-commit.json')
 require(commit['sha']==HEAD and commit['tree']['sha']==SOURCE_TREE,'Historical producer tree changed')
 return job
def companion(path,job):
 z,entries=zip_files(path)
 require(len(entries)==1 and entries[0].filename=='source.json' and entries[0].file_size<=64*1024**2,'Expected exact bounded source.json wrapper')
 raw=z.read(entries[0]);z.close();value=parse(raw)
 require(value['run_id']==37796977804 and value['run_attempt']==1 and value['source_sha']==HEAD and value['artifact_name']==PINS['source']['name'],'Companion origin changed')
 require(digest(value['manifest_json'].encode())==value['manifest_sha256'],'Companion manifest hash changed')
 repair=value['retained_price_repair']
 equal(sorted(repair),sorted(['schema_version','request_sha256','producer_controller_tree','predecessor_identity','artifact','payload_json','payload_sha256','physical_inventory_json','physical_inventory_sha256']),'Unknown finite declaration fields')
 require(repair['schema_version']=='retained-price-source-declaration-v1' and repair['producer_controller_tree']==SOURCE_TREE,'Finite declaration identity changed')
 equal(repair['artifact'],{'id':11559992871,'name':PINS['source']['name'],'bytes':PINS['source']['bytes'],'sha256':PINS['source']['sha256']},'Declared source archive changed')
 for kind in ('payload','physical_inventory'):
  require(isinstance(repair[kind+'_json'],str) and len(repair[kind+'_json'].encode())<=64*1024**2 and digest(repair[kind+'_json'].encode())==repair[kind+'_sha256'],'Unbound producer declaration')
 require(len(repair['payload_json'].encode())+len(repair['physical_inventory_json'].encode())<=64*1024**2,'Combined declarations exceed existing cap')
 payload=parse(repair['payload_json']);physical=parse(repair['physical_inventory_json'])
 expected={'run_id':37796977804,'run_attempt':1,'head_sha':HEAD,'job':{'id':job['id'],'started_at':job['started_at']}}
 equal(payload['producer'],expected,'Payload producer differs')
 require(payload['schema_version']=='retained-price-source-payload-v1' and payload['request_sha256']==repair['request_sha256'] and parse_time(job['started_at'])<=parse_time(payload['evaluated_at'])<=parse_time(job['completed_at']),'Historical payload/job clock differs')
 equal(payload['approved_ui'],{'sha':'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac','tree':'1c0219a170dcbdeb1af539e4cf7a04018251ca02','frontend_tree':'0ba620a84264e1ff026898beed3fbc8ad5894618'},'Source compiler pin changed')
 request_response=api(f'repos/{REPO}/contents/.github/retained-price-oct6-source.json?ref={HEAD}','historical-request-metadata.json')
 require(request_response['type']=='file' and request_response['encoding']=='base64' and request_response['size']<=128*1024,'Missing historical request')
 request_raw=base64.b64decode(request_response['content']);request=parse(request_raw)
 require(len(request_raw)==request_response['size'] and hashlib.sha1(('blob '+str(len(request_raw))+'\0').encode()+request_raw).hexdigest()==request_response['sha'] and digest(request_raw)==repair['request_sha256'],'Historical request bytes changed')
 body={k:v for k,v in request.items() if k not in ('enabled','activation')}
 require(digest(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())=='516bfb60f2bc6114767840a9f5a1563343f74e2537ece362cc7b6ea88d446c1e','Unreviewed historical request body')
 require(request['enabled'] is True and repair['predecessor_identity']==request['predecessor']['identity'],'Historical predecessor declaration changed')
 inventory=physical['dist']
 require(isinstance(inventory,dict) and 0<len(inventory)<=50000,'Invalid declared physical inventory')
 for name,pin in inventory.items():
  clean(name);equal(sorted(pin),['bytes','sha256'],'Unknown physical inventory fields')
  require(isinstance(pin['bytes'],int) and 0<=pin['bytes']<=CAP and isinstance(pin['sha256'],str) and len(pin['sha256'])==64 and all(c in '0123456789abcdef' for c in pin['sha256']),'Invalid physical inventory pin')
 inputs=ROOT/'inputs';inputs.mkdir()
 (inputs/'source.json').write_bytes(raw)
 (inputs/'declared-dist-inventory.json').write_text(json.dumps(inventory,sort_keys=True,separators=(',',':')))
 return value,inventory,{'bytes':len(raw),'sha256':digest(raw)}
def extract_source(path,metadata,expected):
 z,entries=zip_files(path);require(len(entries)==1 and entries[0].filename=='artifact.tar','Expected exact artifact.tar wrapper')
 item=entries[0];reserve(item.file_size)
 archive=ROOT/'source.tar'
 with z.open(item) as src,archive.open('xb') as out:shutil.copyfileobj(src,out,1024*1024)
 z.close();require(archive.stat().st_size==item.file_size,'TAR wrapper size changed')
 destination=ROOT/'source';destination.mkdir()
 seen=set();actual={};count=0;total=0;selected={}
 with tarfile.open(archive,'r:') as handle:
  for member in handle:
   if member.name in ('.','./'):continue
   name=clean(member.name);require(name not in seen,'Duplicate TAR path');seen.add(name);count+=1
   require(count<=60000 and (member.isfile() or member.isdir()),'Linked/special/unbounded TAR member')
   if not member.isfile():continue
   require(name in expected and member.size==expected[name]['bytes'],'Unexpected TAR file/size')
   total+=member.size;require(total<=CAP,'TAR logical cap exceeded')
   keep=name.startswith('static-data/') or name in {'research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json'}
   target=destination/name if keep else None
   if target:reserve(member.size+4096);target.parent.mkdir(parents=True,exist_ok=True)
   h=hashlib.sha256()
   with handle.extractfile(member) as src:
    dst=target.open('xb') if target else None
    try:
     for block in iter(lambda:src.read(1024*1024),b''):
      h.update(block)
      if dst:dst.write(block)
    finally:
     if dst:dst.close()
   actual[name]={'bytes':member.size,'sha256':h.hexdigest()}
   equal(actual[name],expected[name],'TAR byte hash differs from producer inventory')
   if target:selected[name]=actual[name]
 equal(actual,expected,'Complete physical file inventory changed')
 manifest=destination/'static-data/manifest.json';manifest_raw=manifest.read_bytes()
 require(digest(manifest_raw)==metadata['manifest_sha256'] and manifest_raw==metadata['manifest_json'].encode(),'Literal source manifest differs from companion')
 actual_raw=json.dumps(actual,sort_keys=True,separators=(',',':')).encode()
 (ROOT/'inputs/verified-dist-inventory.json').write_bytes(actual_raw)
 result={'complete_physical_inventory_verified':True,'physical_files':len(actual),'logical_bytes':total,'inventory_sha256':digest(actual_raw),'tar_bytes':archive.stat().st_size,'tar_sha256':sha(archive),'source_manifest_sha256':digest(manifest_raw),'selected_data_files':len(selected),'free_bytes':shutil.disk_usage(ROOT).free}
 archive.unlink();path.unlink();reserve();return result
try:
 require(len(sys.argv)==1,'Acquisition accepts no caller overrides')
 require(os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GITHUB_REF')=='refs/heads/'+BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Unexpected isolated diagnostic caller')
 parents=subprocess.check_output(['git','rev-list','--parents','-n','1','HEAD'],text=True).strip().split()
 require(parents==[os.environ['GITHUB_SHA'],PARENT],'Unexpected diagnostic parent')
 caller=api(f'repos/{REPO}/actions/runs/{os.environ["GITHUB_RUN_ID"]}','caller.json')
 require(caller['head_sha']==os.environ['GITHUB_SHA'] and caller['run_attempt']==1 and caller['event']=='push' and caller['path']==WORKFLOW,'Diagnostic caller changed')
 save('pins.json',PINS);job=current_and_attempt()
 companion_zip=download('companion',PINS['companion']);metadata,expected,companion_json=companion(companion_zip,job);companion_zip.unlink()
 source_zip=download('source',PINS['source']);result=extract_source(source_zip,metadata,expected)
 for role,pin in PINS.items():
  fresh=api(f'repos/{REPO}/actions/artifacts/{pin["artifact"]}',role+'-artifact-final.json')
  require(fresh['id']==pin['artifact'] and fresh['digest']=='sha256:'+pin['sha256'] and fresh['expired'] is False and parse_time(fresh['expires_at'])>time.time() and parse_time(job['started_at'])<=parse_time(fresh['created_at'])<=parse_time(job['completed_at']),'Artifact identity/timing changed during acquisition')
 current_and_attempt()
 save('acquisition-result.json',{'schema_version':'oct6-actual-futu-capture-inputs-v1','status':'passed','publication_authority':'none','source_authority':'historical authenticated A11 inputs only; no current admission or replay authority','scope':'capture-only; no carried financial, UI, CSV, full-quality or publication acceptance','source':PINS['source'],'companion':PINS['companion'],'companion_json':companion_json,'result':result,'finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'reserve_bytes':RESERVE})
except BaseException as error:
 save('acquisition-result.json',{'status':'failed','publication_authority':'none','error_type':type(error).__name__,'message':str(error)[:500]})
 raise
