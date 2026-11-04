import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {ARCHIVE_POLICY,ARCHIVE_SCHEMA,ARCHIVE_TAG_PREFIX,RESERVED_RELEASE_PREFIX,archiveDigest,archiveLocation,assertFinancialAuditPreserved,parsePublicationReceipt,validateFinancialAuditArchive} from './financial-audit-history.mjs';
import {ADMISSION_SCHEMA,ArchiveHttpError,admitAuditArchive,admissionCovers,applyArchivedDrops,archivePins,assertArchiveBinding,assertReleaseMetadata,collectArchive,composeFinancialAuditArchive,
  fetchArchivedAsset,finalizeDrops,listArchiveReleases,pruneMode,releaseClient,rotatingPaths,selectArchiveCandidates,uploadArchive,uploadEntry,verifyArchiveAvailability,verifyArchivedBytes,verifyHistory,verifyPlan,verifyPublic,selfEncoding} from './financial-audit-archive.mjs';
import {bootstrap,inventoryDigest,validateReceipt} from './publication-state.mjs';
import {AUDIT_TRANSPORT_PREFIX} from './financial-audit-transport.mjs';
import {pack} from '../../frontend/tools/static-transport/pack.mjs';
import {FAKE_WRITE_TOKEN,releasesFake} from './fixtures/github-releases-fake.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const H=n=>String(n).repeat(64).slice(0,64);
const repo=bootstrap.repository,site=new URL(bootstrap.site_url);
const fc=(kind,hash)=>`static-data/financial-corrections/${kind}-${hash}.json`;
const identity=`40/1/${H('c')}/${H('d')}`;
const quiet=()=>{};
function temp(t,prefix='audit-archive-'){const dir=mkdtempSync(join(tmpdir(),prefix));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function write(path,bytes){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}

function entryFor(path,{receipts,bytes=100,encoding={kind:'gzip',sha256:H('e'),bytes:50}}={}){
  return {kind:'carry-projection',sha256:archiveLocation(path).sha256,bytes,financial_generation:H('f'),receipts,encoding,url:archiveLocation(path).url,
    archived_at:'2026-11-03T05:00:00Z',verified_at:'2026-11-03T06:00:00.000Z',removed_by:{run_id:41,run_attempt:1,previous_publication_identity:identity}};
}
function publicationWithIndex(){
  const release=fc('release',H('1')),older=fc('release',H('2')),carry=fc('carry-projection',H('3'));
  const publication={schema:1,financial_release:{schema_version:'financial-release-receipt-v1',path:release,sha256:H('1')},financial_audit_files:{[release]:H('1'),[older]:H('2'),[fc('source-base',H('4'))]:H('4')}};
  publication.financial_audit_archive={schema_version:ARCHIVE_SCHEMA,repository:repo,files:{[carry]:entryFor(carry,{receipts:[older]})}};
  return {publication,release,older,carry};
}

test('archive index schema is closed, content addressed and bound to hosted receipts',()=>{
  const {publication,release,older,carry}=publicationWithIndex(),index=publication.financial_audit_archive;
  assert.equal(validateFinancialAuditArchive(index,publication),index);
  assert.equal(archiveLocation(carry).url,`https://github.com/${repo}/releases/download/${ARCHIVE_TAG_PREFIX}carry-projection-${H('3')}/carry-projection-${H('3')}.json.gz`);
  assert.ok(archiveLocation(carry).tag.startsWith(RESERVED_RELEASE_PREFIX));
  for(const kind of ['source-projection','source-base','release','renewal'])assert.throws(()=>archiveLocation(fc(kind,H('5'))),/Only carry projections/);
  const mutations=[
    ['extra top key',v=>{v.extra=1;}],['schema',v=>{v.schema_version='v2';}],['repository',v=>{v.repository='other/repo';}],['empty files',v=>{v.files={};}],
    ['prototype',v=>{v.files=Object.assign(Object.create({x:1}),v.files);}],
    ['non-carry key',v=>{v.files[fc('source-projection',H('5'))]=entryFor(carry,{receipts:[older]});}],
    ['hash mismatch',v=>{v.files[carry].sha256=H('6');}],['kind',v=>{v.files[carry].kind='source-projection';}],['extra entry key',v=>{v.files[carry].note='x';}],
    ['zero bytes',v=>{v.files[carry].bytes=0;}],['oversize',v=>{v.files[carry].bytes=128*1024*1024+1;}],['encoding kind',v=>{v.files[carry].encoding.kind='identity';}],
    ['encoding bytes',v=>{v.files[carry].encoding.bytes=0;}],['encoding hash',v=>{v.files[carry].encoding.sha256='x';}],
    ['url',v=>{v.files[carry].url=v.files[carry].url.replace('github.com','evil.example');}],['url host path',v=>{v.files[carry].url+='?x';}],
    ['no receipts',v=>{v.files[carry].receipts=[];}],['receipt not hosted',v=>{v.files[carry].receipts=[fc('release',H('9'))];}],
    ['receipt kind',v=>{v.files[carry].receipts=[fc('source-base',H('4'))];}],['unsorted receipts',v=>{v.files[carry].receipts=[older,release];}],
    ['duplicate receipts',v=>{v.files[carry].receipts=[older,older];}],['archived_at',v=>{v.files[carry].archived_at='yesterday';}],['verified_at',v=>{v.files[carry].verified_at='2026-13-40T00:00:00Z';}],
    ['run id',v=>{v.files[carry].removed_by.run_id=0;}],['identity',v=>{v.files[carry].removed_by.previous_publication_identity='bad';}],['generation',v=>{v.files[carry].financial_generation='g';}],
  ];
  for(const [name,change]of mutations){const value=structuredClone(index);if(name==='prototype'){change(value);}else change(value);assert.throws(()=>validateFinancialAuditArchive(value,publication),undefined,name);}
  assert.doesNotThrow(()=>validateFinancialAuditArchive({...structuredClone(index),files:{[carry]:{...entryFor(carry,{receipts:[older,release].sort()})}}},publication));
  const size=structuredClone(index);size.files[carry].receipts=[older];size.files[carry].financial_generation=H('f');
  for(let i=0;i<1300;i++){const hash=sha(String(i)),path=fc('carry-projection',hash);size.files[path]=entryFor(path,{receipts:[older]});}
  assert.throws(()=>validateFinancialAuditArchive(size,publication),/bounded/);
  // The receipt hook validates the field wherever a publication is read.
  const ui={'index.html':H('1'),'sw.js':H('2')},observed={'["US","chart","A"]':'2026-11-02'};
  const base={schema:1,run_id:40,run_attempt:1,artifact_name:'github-pages-40-1',ui_sha:'c'.repeat(40),ui_files:ui,ui_digest:inventoryDigest(ui),data_manifest_sha256:H('3'),
    price_observations:observed,known_price_dates:observed,verification_universe:{as_of_date:'2026-11-02',required_symbols:['A'],minimum_target:0.9,total:1,verified:1},
    financial_generation:H('4'),financial_lineage_sha256:H('5'),data_inventory_sha256:H('6')};
  assert.doesNotThrow(()=>validateReceipt({...base,...structuredClone(publication)}));
  assert.throws(()=>validateReceipt({...base,...structuredClone(publication),financial_audit_archive:{...structuredClone(index),repository:'x/y'}}),/archive index/);
  const unhosted=structuredClone(publication);delete unhosted.financial_audit_files[older];
  assert.throws(()=>validateReceipt({...base,...unhosted}),/receipts must be sorted hosted/);
  // Preview publications carry no financial release and can never hold an index.
  assert.throws(()=>validateFinancialAuditArchive(index,{schema:'static-json-transport-preview-v1',publication_authority:'none',financial_audit_files:publication.financial_audit_files}),/requires a financial release/);
  const raw=JSON.stringify(publication).replace(`"${carry}":`,`"${carry}":{},"${carry}":`);
  assert.throws(()=>parsePublicationReceipt(Buffer.from(raw)),/Duplicate/);
});

test('archive-aware preservation enforces rules (a) to (d) and equals the old check without archives',()=>{
  const r=fc('release',H('1')),c1=fc('carry-projection',H('2')),c2=fc('carry-projection',H('3')),s=fc('source-base',H('4'));
  const before={[r]:H('1'),[c1]:H('2'),[c2]:H('3'),[s]:H('4')},archived={[c1]:entryFor(c1,{receipts:[r]})};
  // (c)+(d): a previously hosted, unpinned file may move to the archive.
  assert.doesNotThrow(()=>assertFinancialAuditPreserved(before,{[r]:H('1'),[c2]:H('3'),[s]:H('4')},{archivedAfter:archived,pinned:new Set([c2,s,r])}));
  // (b) dropped without an archive entry.
  assert.throws(()=>assertFinancialAuditPreserved(before,{[r]:H('1'),[s]:H('4')},{archivedAfter:archived}),/removed or changed/);
  // (a) an archived entry can never disappear or change.
  assert.throws(()=>assertFinancialAuditPreserved(before,before,{archivedBefore:archived}),/Archived financial audit entry/);
  assert.throws(()=>assertFinancialAuditPreserved(before,before,{archivedBefore:archived,archivedAfter:{[c1]:{...archived[c1],bytes:7}}}),/Archived financial audit entry/);
  // (c) only previously hosted files with the same hash.
  const foreign=fc('carry-projection',H('5'));
  assert.throws(()=>assertFinancialAuditPreserved(before,before,{archivedAfter:{[foreign]:entryFor(foreign,{receipts:[r]})}}),/previously hosted/);
  // (d) never pinned and never hosted in the same publication.
  assert.throws(()=>assertFinancialAuditPreserved(before,{[r]:H('1'),[c2]:H('3'),[s]:H('4')},{archivedAfter:archived,pinned:new Set([c1])}),/cannot be newly archived/);
  assert.throws(()=>assertFinancialAuditPreserved(before,before,{archivedAfter:archived}),/cannot be newly archived/);
  // Re-hosting an already archived entry is allowed (overlap).
  assert.doesNotThrow(()=>assertFinancialAuditPreserved(before,before,{archivedBefore:archived,archivedAfter:archived}));
  // Property: with empty archives the result equals the original two-argument check.
  const original=(a,b)=>{for(const [path,hash]of Object.entries(a))if(b[path]!==hash)throw Error('Previous financial audit bytes were removed or changed');};
  const pool=[r,c1,c2,s,foreign];
  for(let seed=0;seed<400;seed++){
    const rnd=k=>((seed*2654435761+k*40503)>>>0)%1000;
    const pick=offset=>Object.fromEntries(pool.filter((_,i)=>rnd(i+offset)%3!==0).map((path,i)=>[path,rnd(i+offset+7)%5===0?H('9'):/-([a-f0-9]{64})\.json$/.exec(path)[1]]));
    const a=pick(0),b=pick(11);
    if(!Object.keys(a).length||!Object.keys(b).length)continue;
    let expected=null,actual=null;
    try{original(a,b);}catch(error){expected=error.message;}
    try{assertFinancialAuditPreserved(a,b,{});}catch(error){actual=/content-addressed|bounded/.test(error.message)?'invalid':error.message;}
    try{assertFinancialAuditPreserved(a,b);}catch(error){assert.equal(/content-addressed|bounded/.test(error.message)?'invalid':error.message,actual);}
    if(actual!=='invalid')assert.equal(actual,expected,`seed ${seed}`);
  }
});

// A real nested audit transport built with the publisher's own packer.
async function nestedSite(t,count=3,{prefix='carry'}={}){
  const root=temp(t,'audit-site-'),scratch=join(root,'scratch'),pages=join(root,'pages');
  const carries=[];
  for(let i=0;i<count;i++){
    const bytes=Buffer.from(JSON.stringify({schema_version:'carry',i,rows:Array.from({length:400},(_,k)=>({k,symbol:`${prefix}${i}-${k%37}`,value:(k*7919+i)%1013}))}));
    const hash=sha(bytes),path=fc('carry-projection',hash);carries.push({path,sha256:hash,bytes});
    write(join(scratch,`static-data/research-details/carry-projection-${hash}.json`),bytes);
  }
  const sp=Buffer.from('{"source":"projection"}'),sb=Buffer.from('{"source":"base"}');
  write(join(scratch,`static-data/research-details/source-projection-${sha(sp)}.json`),sp);write(join(scratch,`static-data/research-details/source-base-${sha(sb)}.json`),sb);
  const manifest=Buffer.from('{"markets":{}}');write(join(scratch,'static-data/manifest.json'),manifest);
  const packed=await pack({source:scratch,output:join(pages,AUDIT_TRANSPORT_PREFIX),bindings:{manifestSha256:sha(manifest),uiInventorySha256:H('a'),financialGeneration:H('b'),financialLineageSha256:H('c'),sourceCommit:'b'.repeat(40),appCommit:'c'.repeat(40),candidateId:H('d')}});
  const receipts=carries.map((carry,i)=>{const bytes=Buffer.from(JSON.stringify({mode:'carry',financial_generation:sha(`generation ${i}`),evaluation_projection:{path:carry.path,sha256:carry.sha256},source_projection:{path:fc('source-projection',sha(sp)),sha256:sha(sp)},source_base:{path:fc('source-base',sha(sb)),sha256:sha(sb)}}));return {path:fc('release',sha(bytes)),sha256:sha(bytes),bytes};});
  const files={[fc('source-projection',sha(sp))]:sha(sp),[fc('source-base',sha(sb))]:sha(sb)};
  for(const item of [...carries,...receipts])files[item.path]=item.sha256;
  const active=receipts.at(-1);
  const receipt={schema:1,run_id:40,run_attempt:1,financial_release:{schema_version:'financial-release-receipt-v1',path:active.path,sha256:active.sha256},financial_audit_files:files,
    financial_audit_transport:{schema_version:'financial-audit-transport-v1',root:packed.expectedRoot,storage_data_inventory_sha256:H('e')}};
  const live={identity,receipt,receiptBytes:JSON.stringify(receipt),financialRelease:{source_projection:{path:fc('source-projection',sha(sp))},source_base:{path:fc('source-base',sha(sb))},renewal:null}};
  const bin=carry=>{const internal=`static-data/research-details/carry-projection-${carry.sha256}.json`,entry=Object.entries(packed.logicalInventory).find(([path])=>path===internal);assert.ok(entry);
    const physical=Object.keys(packed.physicalInventory).filter(path=>path.startsWith('static-data/_transport/gzip/'));
    for(const path of physical){const bytes=readFileSync(join(pages,AUDIT_TRANSPORT_PREFIX,path));try{if(sha(gunzipCanonical(bytes))===carry.sha256)return bytes;}catch{/* other member */}}
    throw Error('missing bin');};
  const pagesFetch=async(input,options={})=>{
    const url=new URL(input);if(url.origin!==site.origin||!url.pathname.startsWith(site.pathname))return null;
    if(options.redirect!=='error')throw Error('Pages reads must refuse redirects');
    const file=join(pages,url.pathname.slice(site.pathname.length));return existsSync(file)?new Response(readFileSync(file)):new Response('missing',{status:404});
  };
  return {root,pages,carries,receipts,live,bin,pagesFetch,sp,sb};
}
const gunzipCanonical=bytes=>gunzipSync(bytes);
function world(t,site){
  const fake=releasesFake(temp(t,'releases-fake-'));
  const fetcher=async(input,options)=>(site&&await site.pagesFetch(input,options))||fake.fetch(input,options);
  const api=endpoint=>{const entries=fake.apiEntries();if(Object.hasOwn(entries,endpoint))return entries[endpoint];
    const tag=/^repos\/[^/]+\/[^/]+\/releases\/tags\/(.+)$/.exec(endpoint)?.[1];if(tag){const found=fake.state().releases.find(r=>r.tag_name===tag&&!r.draft);if(found)return JSON.parse(JSON.stringify(found));const error=Error('gh: Not Found (HTTP 404)');error.stderr='gh: Not Found (HTTP 404)';throw error;}
    if(/releases\?per_page=100&page=\d+$/.test(endpoint))return [];throw Error('unexpected api '+endpoint);};
  const archive=(carry,bytes)=>{const location=archiveLocation(carry.path);return fake.seed({tag:location.tag,name:location.asset,bytes});};
  return {fake,fetcher,api,archive};
}
const carryState=live=>({live,carry:{},source:{artifact:{id:1}},decision:{mode:'data'}});

test('verifyArchivedBytes requires exact encoding then a canonical one-member decode',async()=>{
  const logical=Buffer.from('x'.repeat(5000)+'audit'),good=gzipSync(logical,{level:6}),entry={sha256:sha(logical),bytes:logical.length,encoding:selfEncoding(good)};
  assert.equal(await verifyArchivedBytes(good,entry),true);
  const cases={
    noncanonical:gzipSync(logical,{level:9}),trailing:Buffer.concat([good,Buffer.from([0])]),second:Buffer.concat([good,gzipSync(Buffer.from('x'),{level:6})]),
    isize:Buffer.concat([good.subarray(0,-4),Buffer.from([1,0,0,0])]),truncated:good.subarray(0,good.length-9),
  };
  for(const [name,bytes]of Object.entries(cases))await assert.rejects(verifyArchivedBytes(bytes,{...entry,encoding:selfEncoding(bytes)}),undefined,name);
  await assert.rejects(verifyArchivedBytes(good,{...entry,encoding:{...entry.encoding,sha256:H('0')}}),/encoded bytes/);
  await assert.rejects(verifyArchivedBytes(good,{...entry,sha256:H('0')}),/SHA-256/);
  await assert.rejects(verifyArchivedBytes(good,{...entry,bytes:entry.bytes+1}),/length/);
  await assert.rejects(verifyArchivedBytes(good,{...entry,bytes:128*1024*1024+1}),/out of bounds/);
});

test('fetchArchivedAsset is anonymous, bounded, https-only and host-allowlisted',async t=>{
  const {fake,fetcher}=world(t),bytes=gzipSync(Buffer.from('y'.repeat(300)),{level:6}),path=fc('carry-projection',H('7')),location=archiveLocation(path);
  fake.seed({tag:location.tag,name:location.asset,bytes});
  assert.deepEqual(await fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length}),bytes);
  assert.deepEqual(await fetchArchivedAsset(location.url,{fetcher,cap:1024}),bytes);
  assert.deepEqual(await fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length,mode:'probe'}),{status:206,bytes:bytes.length});
  fake.fault(location.tag,location.asset,{ignoreRange:true});
  assert.deepEqual(await fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length,mode:'probe'}),{status:200,bytes:bytes.length},'200 with exact length is accepted');
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length+1,mode:'probe'}),/probe size mismatch/);
  fake.clearFaults();
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length+1,mode:'probe'}),/probe size mismatch/,'206 total mismatch');
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length-1}),/length mismatch|expected size/);
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,cap:10}),/length mismatch|expected size/);
  assert.ok(fake.calls().every(call=>!call.auth&&call.redirect==='manual'&&call.acceptEncoding==='identity'),'downloads never carry credentials');
  for(const target of ['https://evil.example/x','http://release-assets.githubusercontent.com/x','https://user:pw@github.com/x'])await assert.rejects(fetchArchivedAsset(target,{fetcher,expectedBytes:4}),/allowed public download hosts/);
  fake.fault(location.tag,location.asset,{redirectTo:'https://evil.example/stolen'});
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length}),/allowed public download hosts/);
  fake.fault(location.tag,location.asset,{redirectTo:location.url});
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length}),/more than three/);
  fake.clearFaults();fake.fault(location.tag,location.asset,{contentEncoding:'gzip'});
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,expectedBytes:bytes.length}),/transfer encoding/);
  fake.clearFaults();fake.fault(location.tag,location.asset,{replaceBytes:Buffer.from('plain text').toString('base64'),ignoreRange:true});
  await assert.rejects(fetchArchivedAsset(location.url,{fetcher,expectedBytes:10,mode:'probe'}),/not gzip/);
  const missing=fc('carry-projection',H('8'));
  await assert.rejects(fetchArchivedAsset(archiveLocation(missing).url,{fetcher,expectedBytes:4}),error=>error instanceof ArchiveHttpError&&error.status===404);
});

test('release listing is one paginated pass with a bounded per-tag fallback',()=>{
  const calls=[],releases=Array.from({length:230},(_,i)=>({tag_name:i%2?`${ARCHIVE_TAG_PREFIX}carry-projection-${sha(String(i))}`:`daily-price-${i}`,draft:i===3,assets:[]}));
  const api=endpoint=>{calls.push(endpoint);const page=Number(/page=(\d+)$/.exec(endpoint)?.[1]);if(page)return releases.slice((page-1)*100,page*100);
    const tag=/releases\/tags\/(.+)$/.exec(endpoint)[1];if(tag.endsWith(H('a')))return {tag_name:tag,draft:false,assets:[]};const error=Error('HTTP 404');error.stderr='gh: Not Found (HTTP 404)';throw error;};
  const map=listArchiveReleases(api,{required:[`${ARCHIVE_TAG_PREFIX}carry-projection-${H('a')}`,`${ARCHIVE_TAG_PREFIX}carry-projection-${H('b')}`]});
  assert.deepEqual(calls.slice(0,3),[1,2,3].map(page=>`repos/${repo}/releases?per_page=100&page=${page}`));
  assert.equal(calls.length,5);
  assert.equal(map.size,115-1+1,'drafts and non-archive releases are ignored; one fallback hit');
  assert.ok(map.has(`${ARCHIVE_TAG_PREFIX}carry-projection-${H('a')}`));
  assert.throws(()=>listArchiveReleases(api,{required:Array.from({length:51},(_,i)=>`${ARCHIVE_TAG_PREFIX}carry-projection-${sha(`missing ${i}`)}`)}),/omits 51/);
  assert.throws(()=>listArchiveReleases(endpoint=>{if(endpoint.includes('page='))return [];throw Error('HTTP 500 boom');},{required:[`${ARCHIVE_TAG_PREFIX}x`]}),/500/);
  const duplicate=[{tag_name:`${ARCHIVE_TAG_PREFIX}carry-projection-${H('a')}`,draft:false},{tag_name:`${ARCHIVE_TAG_PREFIX}carry-projection-${H('a')}`,draft:false}];
  assert.throws(()=>listArchiveReleases(()=>duplicate),/Ambiguous/);
});

test('release metadata requires one uploaded, named, sized asset with the recorded digest',()=>{
  const path=fc('carry-projection',H('3')),location=archiveLocation(path),encoding={kind:'gzip',sha256:H('e'),bytes:50};
  const release=()=>({tag_name:location.tag,draft:false,assets:[{name:location.asset,state:'uploaded',size:50,digest:`sha256:${H('e')}`,browser_download_url:location.url}]});
  assert.equal(assertReleaseMetadata(release(),{path,encoding}).needsFull,false);
  const nullDigest=release();nullDigest.assets[0].digest=null;assert.equal(assertReleaseMetadata(nullDigest,{path,encoding}).needsFull,true);
  for(const change of [r=>{r.draft=true;},r=>{r.tag_name+='x';},r=>{r.assets.push(r.assets[0]);},r=>{r.assets=[];},r=>{r.assets[0].state='starter';},r=>{r.assets[0].name='x.gz';},
    r=>{r.assets[0].size=51;},r=>{r.assets[0].digest=`sha256:${H('f')}`;},r=>{r.assets[0].browser_download_url='https://github.com/x';},r=>{r.assets[0].digest='md5:1';}]){
    const value=release();change(value);assert.throws(()=>assertReleaseMetadata(value,{path,encoding}));
  }
  assert.throws(()=>assertReleaseMetadata(undefined,{path,encoding}),/missing/);
});

test('pruning is limited to plain carries and pauses for renewals, repairs and the kill switch',t=>{
  const dir=temp(t),base={live:{identity,financialRelease:{renewal:null},receipt:{financial_audit_files:{}}},carry:{},source:{artifact:{id:1}}};
  assert.equal(pruneMode(base,{root:dir}),true);
  for(const change of [s=>{delete s.carry;},s=>{s.limited={};},s=>{s.activation={};},s=>{s.renewal={};},s=>{s.correction={};},s=>{s.source.repair={};},s=>{s.publisherTooling={};},
    s=>{s.ordinaryCarryAdmission={};},s=>{s.live.financialRelease.renewal={origin:{}};},s=>{s.live.receipt.financial_audit_files={[fc('renewal',H('1'))]:H('1')};},s=>{s.live.financialRelease=null;}]){
    const state=structuredClone(base);change(state);assert.equal(pruneMode(state,{root:dir}),false);
  }
  write(join(dir,'.github/financial-source-renewal-request.json'),'{}');
  assert.equal(pruneMode(base,{root:dir}),false,'a committed renewal request pauses pruning');
  assert.equal(ARCHIVE_POLICY.pruning_enabled,true);assert.ok(Object.isFrozen(ARCHIVE_POLICY));
  assert.match(readFileSync(new URL('./financial-audit-archive.mjs',import.meta.url),'utf8'),/ARCHIVE_POLICY\.pruning_enabled&&state\?\.carry/,'the kill switch gates every removal');
});

test('candidate selection skips indexed, source and non-carry files, sorted and capped',()=>{
  const files={};for(let i=0;i<40;i++){const hash=sha(`c${i}`);files[fc('carry-projection',hash)]=hash;}
  files[fc('source-projection',H('1'))]=H('1');files[fc('release',H('2'))]=H('2');
  const indexed=Object.keys(files).sort()[0];
  const live={receipt:{financial_audit_files:files,financial_audit_archive:{files:{[indexed]:{}}}},financialRelease:{source_projection:{path:fc('source-projection',H('1'))}}};
  const picked=selectArchiveCandidates(live);
  assert.equal(picked.length,ARCHIVE_POLICY.max_new_entries_per_publication);
  assert.ok(picked.every(item=>/carry-projection/.test(item.path)&&item.path!==indexed));
  assert.deepEqual(picked.map(item=>item.path),[...picked.map(item=>item.path)].sort());
  assert.deepEqual(rotatingPaths(['c','a','b'],2,4),['b','c']);assert.deepEqual(rotatingPaths(['a'],2,0),['a']);assert.deepEqual(rotatingPaths([],2,0),[]);
});

test('admission drops only same-run verified copies and keeps every unverified carry hosted',async t=>{
  const site=await nestedSite(t,6),{fake,fetcher,api,archive}=world(t,site),[c0,c1,c2,c3,c4,c5]=site.carries;
  archive(c0,site.bin(c0));                                              // good copy
  archive(c1,gzipSync(c1.bytes,{level:4})); // different but valid encoding (F1)
  archive(c2,gzipSync(Buffer.from('tampered'),{level:6}));                 // decode mismatch
  const draft=archiveLocation(c3.path);fake.seed({tag:draft.tag,name:draft.asset,bytes:site.bin(c3),draft:true}); // draft only
  archive(c4,site.bin(c4));fake.fault(archiveLocation(c4.path).tag,archiveLocation(c4.path).asset,{digest:`sha256:${H('0')}`}); // digest mismatch
  // c5 has no release (404).
  const warnings=[];
  const record=await admitAuditArchive({state:carryState(site.live),api,fetcher,root:temp(t),warn:message=>warnings.push(message),now:()=>'2026-11-03T07:00:00.000Z'});
  assert.equal(record.schema_version,ADMISSION_SCHEMA);assert.equal(record.mode,'prune');assert.equal(record.live_identity,identity);
  assert.deepEqual(Object.keys(record.drops).sort(),[c0.path,c1.path].sort());
  assert.equal(record.drops[c1.path].encoding.sha256,sha(gzipSync(c1.bytes,{level:4})));
  assert.equal(record.drops[c0.path].bytes,c0.bytes.length);
  assert.equal(warnings.length,4);for(const carry of [c2,c3,c4,c5])assert.ok(warnings.some(message=>message.includes(carry.path)));
  assert.ok(fake.calls().filter(call=>call.url.includes('githubusercontent')||call.url.startsWith('https://github.com/')).every(call=>!call.auth));
  // Verify-only routes never drop and need no listing without a prior index.
  const quietState={...carryState(site.live),limited:{}};
  const none=await admitAuditArchive({state:quietState,api:()=>{throw Error('no API call expected');},fetcher,root:temp(t)});
  assert.equal(none.mode,'verify');assert.deepEqual(none.drops,{});
  // API failures keep everything hosted (degrade) while there is no index yet.
  const outage=[],degraded=await admitAuditArchive({state:carryState(site.live),api:()=>{throw Error('HTTP 502');},fetcher,root:temp(t),warn:message=>outage.push(message)});
  assert.deepEqual(degraded.drops,{});assert.match(outage[0],/listing is unavailable/);
  const tagOutage=await admitAuditArchive({state:carryState(site.live),api:endpoint=>{if(endpoint.includes('page='))return [];throw Error('HTTP 502');},fetcher,root:temp(t),warn:quiet});
  assert.deepEqual(tagOutage.drops,{},'a failing fallback tag read keeps the candidate');
});

test('admission fails closed when an already indexed entry is missing, changed or undecodable',async t=>{
  const site=await nestedSite(t,3),{fake,fetcher,api,archive}=world(t,site),[c0,c1]=site.carries;
  archive(c0,site.bin(c0));
  const index={schema_version:ARCHIVE_SCHEMA,repository:repo,files:{[c0.path]:{...entryFor(c0.path,{receipts:[site.receipts[0].path],bytes:c0.bytes.length,encoding:selfEncoding(site.bin(c0))}),financial_generation:H('f')}}};
  const receipt={...site.live.receipt,financial_audit_files:Object.fromEntries(Object.entries(site.live.receipt.financial_audit_files).filter(([path])=>path!==c0.path)),financial_audit_archive:index};
  const live={...site.live,receipt,receiptBytes:JSON.stringify(receipt)};
  const ok=await admitAuditArchive({state:carryState(live),api,fetcher,root:temp(t),warn:quiet,seed:'0'});
  assert.deepEqual(ok.verified.full,[c0.path],'rotation fully re-downloads indexed entries');
  assert.ok(!Object.hasOwn(ok.drops,c0.path));
  const location=archiveLocation(c0.path);
  fake.fault(location.tag,location.asset,{noDigest:true});
  const nullDigest=await admitAuditArchive({state:{...carryState(live),limited:{}},api,fetcher,root:temp(t),seed:'1'});
  assert.deepEqual(nullDigest.verified.full,[c0.path],'a missing digest forces a full download');
  fake.clearFaults();
  fake.fault(location.tag,location.asset,{replaceBytes:gzipSync(Buffer.from('other'),{level:6}).toString('base64'),noDigest:true});
  await assert.rejects(admitAuditArchive({state:carryState(live),api,fetcher,root:temp(t),warn:quiet}),/SHA-256|length|encoded/);
  fake.clearFaults();fake.fault(location.tag,location.asset,{digest:`sha256:${H('1')}`});
  await assert.rejects(admitAuditArchive({state:carryState(live),api,fetcher,root:temp(t),warn:quiet}),/digest changed/);
  fake.clearFaults();fake.fault(location.tag,location.asset,{status:500});
  await assert.rejects(admitAuditArchive({state:{...carryState(live),limited:{}},api,fetcher,root:temp(t),seed:'5'}),/HTTP 500|probe/);
  fake.clearFaults();fake.removeRelease(location.tag);
  await assert.rejects(admitAuditArchive({state:carryState(live),api,fetcher,root:temp(t),warn:quiet}),/missing or still a draft/);
  await assert.rejects(verifyArchiveAvailability(index,{api,fetcher}),/missing or still a draft/);
  assert.deepEqual(await verifyArchiveAvailability(null,{api:()=>{throw Error('no calls');},fetcher}),{probe:[],full:[]});
  void c1;
});

test('admission stops adding entries before the index or publication caps',async t=>{
  const site=await nestedSite(t,3),{fetcher,api,archive}=world(t,site);
  for(const carry of site.carries)archive(carry,site.bin(carry));
  const padded={...site.live,receiptBytes:'x'.repeat(4*1024*1024-66*1024)};
  const warnings=[];
  const record=await admitAuditArchive({state:carryState(padded),api,fetcher,root:temp(t),warn:message=>warnings.push(message)});
  assert.ok(Object.keys(record.drops).length<3,'publication cap stops new entries');
  assert.ok(warnings.some(message=>/cap reached/.test(message)));
  const full=await admitAuditArchive({state:carryState(site.live),api,fetcher,root:temp(t),warn:quiet});
  assert.equal(Object.keys(full.drops).length,3);
});

test('finalized drops bind receipts offline, compose an index and verify by the same rules',async t=>{
  const site=await nestedSite(t,3),{fetcher,api,archive}=world(t,site),root=temp(t,'carry-source-');
  for(const item of [...site.carries,...site.receipts])write(join(root,item.path),item.bytes);
  write(join(root,fc('source-projection',sha(site.sp))),site.sp);write(join(root,fc('source-base',sha(site.sb))),site.sb);
  archive(site.carries[0],site.bin(site.carries[0]));archive(site.carries[1],site.bin(site.carries[1]));
  const state=carryState(site.live);
  state.auditArchive=await admitAuditArchive({state,api,fetcher,root:temp(t),warn:quiet});
  const cwd=temp(t),removal=finalizeDrops(state,root,{cwd,warn:quiet});
  assert.deepEqual(removal,[site.carries[0].path,site.carries[1].path].sort());
  assert.deepEqual(state.auditArchive.drops[site.carries[0].path].receipts,[site.receipts[0].path]);
  // The public tree loses exactly the verified drops; anything else is refused.
  const publicRoot=temp(t,'public-');for(const item of [...site.carries,...site.receipts])write(join(publicRoot,item.path),item.bytes);
  applyArchivedDrops(publicRoot,removal);
  for(const path of removal)assert.equal(existsSync(join(publicRoot,path)),false);
  assert.ok(existsSync(join(publicRoot,site.carries[2].path)));
  assert.throws(()=>applyArchivedDrops(publicRoot,[site.receipts[0].path]),/Only archived carry projections/);
  write(join(publicRoot,site.carries[1].path),'changed');assert.throws(()=>applyArchivedDrops(publicRoot,[site.carries[1].path]),/content-addressed/);rmSync(join(publicRoot,site.carries[1].path));
  // Compose: hosted map lacks the drops; a re-hosted drop is simply not indexed.
  const hosted=Object.fromEntries(Object.entries(site.live.receipt.financial_audit_files).filter(([path])=>!removal.includes(path)));
  const index=composeFinancialAuditArchive({state,dist:publicRoot,hosted,runId:50,runAttempt:1});
  assert.deepEqual(Object.keys(index.files).sort(),removal);
  assert.equal(index.files[site.carries[0].path].removed_by.previous_publication_identity,identity);
  assert.equal(state.auditArchive.composed_sha256,archiveDigest(index));
  const publication={...site.live.receipt,financial_audit_files:hosted,financial_audit_archive:index};
  assert.equal(validateFinancialAuditArchive(index,publication),index);
  assert.doesNotThrow(()=>assertFinancialAuditPreserved(site.live.receipt.financial_audit_files,hosted,{archivedAfter:index.files,pinned:archivePins({source_projection:{path:fc('source-projection',sha(site.sp))},evaluation_projection:{path:site.carries[2].path}},publication.financial_release)}));
  assertArchiveBinding(state,site.live,publication);
  assert.throws(()=>assertArchiveBinding(state,site.live,{...publication,financial_audit_archive:null}),/changed after composition/);
  assert.equal(admissionCovers(state,site.live),true);
  assert.throws(()=>assertArchiveBinding({},site.live,publication),/without a same-run admission/);
  const rehosted=composeFinancialAuditArchive({state,dist:publicRoot,hosted:{...hosted,[site.carries[1].path]:site.carries[1].sha256},runId:50,runAttempt:1});
  assert.deepEqual(Object.keys(rehosted.files),[site.carries[0].path]);
  assert.deepEqual(await verifyArchiveAvailability(index,{api,fetcher,probeAll:true}),{probe:removal,full:[]});
  // A drop no receipt references, or a changed predecessor, is kept.
  const orphanState=carryState(site.live);orphanState.auditArchive=structuredClone(state.auditArchive);orphanState.auditArchive.drops={[site.carries[0].path]:state.auditArchive.drops[site.carries[0].path]};
  rmSync(join(root,site.receipts[0].path));
  assert.throws(()=>finalizeDrops(orphanState,root,{cwd,warn:quiet}),/ENOENT|no such file/);
  write(join(root,site.receipts[0].path),site.receipts[0].bytes);
  const lonely=Buffer.from('{"unreferenced":true}'),lonelyPath=fc('carry-projection',sha(lonely));write(join(root,lonelyPath),lonely);
  const unbound=carryState({...site.live,receipt:{...site.live.receipt,financial_audit_files:{...site.live.receipt.financial_audit_files,[lonelyPath]:sha(lonely)}}});
  unbound.auditArchive={...structuredClone(state.auditArchive),drops:{[lonelyPath]:{...state.auditArchive.drops[site.carries[0].path],sha256:sha(lonely)}}};
  const unboundWarnings=[];
  assert.deepEqual(finalizeDrops(unbound,root,{cwd,warn:message=>unboundWarnings.push(message)}),[],'a drop no hosted receipt references stays hosted');
  assert.match(unboundWarnings[0],/no hosted receipt references it/);
  const moved=carryState({...site.live,identity:`41/1/${H('c')}/${H('d')}`});moved.auditArchive=structuredClone(state.auditArchive);
  assert.deepEqual(finalizeDrops(moved,root,{cwd,warn:quiet}),[],'a different predecessor removes nothing');
  const renewal=carryState(site.live);renewal.auditArchive=structuredClone(state.auditArchive);write(join(cwd,'.github/financial-source-renewal-request.json'),'{}');
  assert.deepEqual(finalizeDrops(renewal,root,{cwd,warn:quiet}),[],'a renewal request committed after admission removes nothing');
});

test('uploader creates immutable releases, is idempotent and never modifies a published release',async t=>{
  const site=await nestedSite(t,4),{fake,fetcher}=world(t,site),input=temp(t,'staged-');
  const sleep=async()=>{},client=releaseClient({token:FAKE_WRITE_TOKEN,fetcher,sleep});
  const plan={schema_version:'financial-audit-archive-plan-v1',publication:{},controller_sha:'b'.repeat(40),entries:[],conflicts:[]};
  for(const carry of site.carries){const bytes=site.bin(carry),location=archiveLocation(carry.path);write(join(input,'bins',location.asset),bytes);
    plan.entries.push({path:carry.path,sha256:carry.sha256,bytes:carry.bytes.length,encoding:selfEncoding(bytes),tag:location.tag,asset:location.asset,url:location.url});}
  write(join(input,'plan.json'),JSON.stringify(plan));
  await verifyPlan({input});
  const [e0,e1,e2,e3]=plan.entries;
  // e1: a valid published alternate encoding; e2: a published but invalid copy; e3: an incomplete draft.
  fake.seed({tag:e1.tag,name:e1.asset,bytes:gzipSync(site.carries[1].bytes,{level:4})});
  const invalid=fake.seed({tag:e2.tag,name:e2.asset,bytes:gzipSync(Buffer.from('bad'),{level:6})});
  fake.seed({tag:e3.tag,name:e3.asset,bytes:Buffer.from('partial'),draft:true,assetState:'starter'});
  const before=fake.calls().length;
  assert.equal(await uploadEntry(client,e0,readFileSync(join(input,'bins',e0.asset)),{fetcher,controllerSha:'b'.repeat(40),log:quiet}),'created');
  const created=fake.state().releases.find(release=>release.tag_name===e0.tag);
  assert.equal(created.draft,false);assert.equal(created.make_latest,'false');assert.equal(created.target_commitish,'b'.repeat(40));
  assert.equal(await uploadEntry(client,e0,readFileSync(join(input,'bins',e0.asset)),{fetcher,log:quiet}),'exists','idempotent re-run');
  assert.equal(await uploadEntry(client,e1,readFileSync(join(input,'bins',e1.asset)),{fetcher,log:quiet}),'alternate-encoding');
  const writesBefore=fake.calls().filter(call=>call.method!=='GET').length;
  await assert.rejects(uploadEntry(client,e2,readFileSync(join(input,'bins',e2.asset)),{fetcher,log:quiet}),/cannot be accepted/);
  assert.equal(fake.calls().filter(call=>call.method!=='GET').length,writesBefore,'an invalid published release receives zero write calls');
  assert.deepEqual(fake.state().releases.find(release=>release.id===invalid.id).assets.map(asset=>asset.id),invalid.assets.map(asset=>asset.id));
  assert.equal(await uploadEntry(client,e3,readFileSync(join(input,'bins',e3.asset)),{fetcher,log:quiet}),'repaired-draft');
  const repaired=fake.state().releases.find(release=>release.tag_name===e3.tag);
  assert.equal(repaired.draft,false);assert.equal(repaired.assets.length,1);assert.equal(repaired.assets[0].digest,`sha256:${e3.encoding.sha256}`);
  for(const call of fake.calls().slice(before))if(/api\.github\.com|uploads\.github\.com/.test(call.url))assert.ok(call.auth);else assert.ok(!call.auth,'downloads stay anonymous');
  assert.ok(fake.calls().every(call=>!(call.method==='DELETE'&&/\/releases\/\d+$/.test(call.url))),'no release is ever deleted');
  // More than one draft for a tag is a conflict; a non-draft is never repaired.
  const extra=fc('carry-projection',H('6')),location=archiveLocation(extra),bytes=gzipSync(Buffer.from('z'),{level:6});
  fake.seed({tag:location.tag,name:null,bytes,draft:true});fake.seed({tag:location.tag,name:null,bytes,draft:true});
  await assert.rejects(uploadEntry(client,{path:extra,sha256:location.sha256,bytes:1,encoding:selfEncoding(bytes),tag:location.tag,asset:location.asset,url:location.url},bytes,{fetcher,log:quiet}),/More than one draft/);
  // The whole command reports conflicts after uploading the rest.
  rmSync(join(input,'bins'),{recursive:true});plan.entries=[e0,e2];write(join(input,'bins',e0.asset),site.bin(site.carries[0]));
  write(join(input,'bins',e2.asset),site.bin(site.carries[2]));write(join(input,'plan.json'),JSON.stringify(plan));
  await assert.rejects(uploadArchive({input,token:FAKE_WRITE_TOKEN,fetcher,sleep,log:quiet}),/1 archive conflict/);
  await assert.rejects(uploadArchive({input,token:'',fetcher,sleep,log:quiet}),/GH_TOKEN/);
  const source=readFileSync(new URL('./financial-audit-archive.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/--clobber|gh release (?:delete|upload|edit)/);
  assert.match(source,/make_latest:'false'/);
  void e1;
});

test('draft repair re-reads the release and refuses to touch anything that is no longer a reserved draft',async t=>{
  const site=await nestedSite(t,1),{fake,fetcher}=world(t,site),carry=site.carries[0],bytes=site.bin(carry),location=archiveLocation(carry.path);
  const entry={path:carry.path,sha256:carry.sha256,bytes:carry.bytes.length,encoding:selfEncoding(bytes),tag:location.tag,asset:location.asset,url:location.url};
  const draft=fake.seed({tag:location.tag,name:location.asset,bytes:Buffer.from('partial'),draft:true,assetState:'starter'});
  const client=releaseClient({token:FAKE_WRITE_TOKEN,fetcher,sleep:async()=>{}});
  // The release is published by someone else between the listing and the repair.
  const racing={...client,get:async id=>({...(await client.get(id)),draft:false})};
  const before=fake.calls().length;
  await assert.rejects(uploadEntry(racing,entry,bytes,{fetcher,controllerSha:'b'.repeat(40),log:quiet}),/not a reserved draft/);
  assert.deepEqual(fake.calls().slice(before).filter(call=>call.method!=='GET'),[],'no write call reaches a release that is not a reserved draft');
  assert.deepEqual(fake.state().releases.find(release=>release.id===draft.id).assets.map(asset=>asset.id),draft.assets.map(asset=>asset.id));
  // A draft under another tag name is never adopted.
  const renamed={...client,get:async id=>({...(await client.get(id)),tag_name:'daily-price-data'})};
  await assert.rejects(uploadEntry(renamed,entry,bytes,{fetcher,controllerSha:'b'.repeat(40),log:quiet}),/not a reserved draft/);
  assert.deepEqual(fake.calls().slice(before).filter(call=>call.method!=='GET'),[]);
  // The unmodified client repairs the same draft.
  assert.equal(await uploadEntry(client,entry,bytes,{fetcher,controllerSha:'b'.repeat(40),log:quiet}),'repaired-draft');
  assert.ok(fake.calls().slice(before).filter(call=>call.method==='DELETE').every(call=>/\/releases\/assets\/\d+$/.test(call.url)),'only draft assets are deleted');
});

test('collect stages exact Pages bins anonymously and verify-public accepts alternate valid encodings',async t=>{
  const site=await nestedSite(t,3),{fake,fetcher}=world(t,site),output=join(temp(t),'staged');
  write(join(site.pages,'publication.json'),JSON.stringify(site.live.receipt));
  fake.seed({tag:archiveLocation(site.carries[0].path).tag,name:archiveLocation(site.carries[0].path).asset,bytes:gzipSync(site.carries[0].bytes,{level:4})});
  fake.seed({tag:archiveLocation(site.carries[1].path).tag,name:archiveLocation(site.carries[1].path).asset,bytes:gzipSync(Buffer.from('wrong'),{level:6})});
  const plan=await collectArchive({output,fetcher,sleep:async()=>{},cwd:temp(t),log:quiet,validate:value=>value});
  assert.deepEqual(plan.entries.map(entry=>entry.path),[site.carries[2].path]);
  assert.deepEqual(plan.conflicts.map(entry=>entry.path),[site.carries[1].path]);
  assert.deepEqual(readFileSync(join(output,'bins',plan.entries[0].asset)),site.bin(site.carries[2]));
  assert.ok(fake.calls().every(call=>!call.auth),'collect never authenticates');
  await verifyPlan({input:output});
  write(join(output,'bins','extra.gz'),'x');await assert.rejects(verifyPlan({input:output}),/unplanned/);rmSync(join(output,'bins','extra.gz'));
  await assert.rejects(verifyPublic({input:output,fetcher,sleep:async()=>{},budgetMs:0}),/did not verify/);
  await uploadArchive({input:output,token:FAKE_WRITE_TOKEN,fetcher,sleep:async()=>{},log:quiet,controllerSha:'b'.repeat(40)});
  assert.equal(await verifyPublic({input:output,fetcher,sleep:async()=>{}}),1);
  const cwd=temp(t);write(join(cwd,'.github/financial-source-renewal-request.json'),'{}');
  assert.equal((await collectArchive({output,fetcher,sleep:async()=>{},cwd,log:quiet,validate:value=>value})).entries.length,0,'a committed renewal request pauses archiving');
  // The real receipt validator runs by default and rejects a malformed live receipt.
  await assert.rejects(collectArchive({output,fetcher,sleep:async()=>{},cwd,log:quiet,attempts:1}),/Invalid|receipt|universe|ledger/);
});


test('independent history verification checks closure, probes or downloads, and reports orphans',async t=>{
  const site=await nestedSite(t,2),{fake,fetcher,api,archive}=world(t,site),[c0,c1]=site.carries;
  archive(c0,site.bin(c0));
  for(const item of site.receipts)write(join(site.pages,item.path),item.bytes);
  const hosted=Object.fromEntries(Object.entries(site.live.receipt.financial_audit_files).filter(([path])=>path!==c0.path));
  const index={schema_version:ARCHIVE_SCHEMA,repository:repo,files:{[c0.path]:{...entryFor(c0.path,{receipts:[site.receipts[0].path],bytes:c0.bytes.length,encoding:selfEncoding(site.bin(c0))})}}};
  write(join(site.pages,'publication.json'),JSON.stringify({...site.live.receipt,financial_audit_files:hosted,financial_audit_archive:index}));
  const light=value=>value;
  const probed=await verifyHistory({fetcher,api,log:quiet,validate:light});
  assert.deepEqual(probed.verified.probe,[c0.path]);assert.deepEqual(probed.gaps,[]);
  const full=await verifyHistory({full:true,orphans:true,fetcher,api,log:quiet,validate:light});
  assert.deepEqual(full.verified.full,[c0.path]);assert.deepEqual(full.orphaned,[]);
  archive({path:fc('carry-projection',H('9'))},gzipSync(Buffer.from('orphan'),{level:6}));
  await assert.rejects(verifyHistory({orphans:true,fetcher,api,log:quiet,validate:light}),/history check failed/);
  fake.removeRelease(archiveLocation(fc('carry-projection',H('9'))).tag);
  // A hosted receipt whose projection is neither hosted nor archived is a gap.
  write(join(site.pages,'publication.json'),JSON.stringify({...site.live.receipt,financial_audit_files:Object.fromEntries(Object.entries(hosted).filter(([path])=>path!==c1.path)),financial_audit_archive:index}));
  await assert.rejects(verifyHistory({fetcher,api,log:quiet,validate:light}),/history check failed/);
});

test('every new archive test is registered in exact-main CI',()=>{
  const ci=readFileSync(new URL('../workflows/ci.yml',import.meta.url),'utf8');
  for(const name of ['financial-audit-archive.test.mjs','financial-audit-archive-workflow.test.mjs'])assert.ok(ci.includes(`.github/scripts/${name}`),name);
  assert.ok(readdirSync(new URL('.',import.meta.url)).includes('financial-audit-archive.mjs'));
});

test('activation, renewal, limited and verify-only carries keep the index verbatim; corrections refuse it',t=>{
  const {publication}=publicationWithIndex(),live={identity,receipt:publication,financialRelease:{renewal:null}},dir=temp(t);
  for(const extra of [{activation:{}},{renewal:{}},{limited:{}},{carry:{},ordinaryCarryAdmission:{}},{carry:{},auditArchive:{schema_version:ADMISSION_SCHEMA,mode:'verify',live_identity:identity,prior_sha256:archiveDigest(publication.financial_audit_archive),drops:{},removal:[]}}]){
    const state={live,source:{artifact:{id:1}},...extra};
    if(!extra.auditArchive)assert.equal(pruneMode(state,{root:dir}),false,JSON.stringify(Object.keys(extra)));
    assert.deepEqual(composeFinancialAuditArchive({state,dist:join(dir,'unused'),hosted:publication.financial_audit_files,runId:1,runAttempt:1}),publication.financial_audit_archive);
    assert.doesNotThrow(()=>assertArchiveBinding(state,live,publication));
    assert.throws(()=>assertArchiveBinding(state,live,{...publication,financial_audit_archive:undefined}));
  }
  // No prior index and no admission: nothing is created.
  assert.equal(composeFinancialAuditArchive({state:{live:{identity,receipt:{financial_audit_files:{}}}},dist:dir,hosted:{}}),null);
  const selector=readFileSync(new URL('./select-release-source.mjs',import.meta.url),'utf8');
  assert.match(selector,/if \(state\.live\.receipt\?\.financial_audit_archive\) throw Error\('A financial correction cannot drop the public financial audit archive index'\)/);
  assert.match(selector,/else if\(archive\)throw Error\('A financial audit archive index requires a live financial release'\)/);
});

// The first transition from today's live shape: every carry projection is still
// hosted (24 nested bins plus the two sources) and there is no archive index.
test('first transition from 24 hosted carries and no index keeps today\'s publication until each copy verifies, then omits all 24',async t=>{
  const site=await nestedSite(t,24),{fake,fetcher,api}=world(t,site),active=site.carries.at(-1);
  assert.equal(site.live.receipt.financial_audit_archive,undefined);
  const live={...site.live,receiptBytes:site.live.receiptBytes.padEnd(781350,' ')}; // live publication.json size on 2026-11-04
  const root=temp(t,'carry-source-'),cwd=temp(t);
  for(const item of [...site.carries,...site.receipts])write(join(root,item.path),item.bytes);
  write(join(root,fc('source-projection',sha(site.sp))),site.sp);write(join(root,fc('source-base',sha(site.sb))),site.sb);
  // Before any archive run: no release exists, so nothing is dropped, nothing is
  // indexed and recheck makes no archive call. This is today's publication.
  const warnings=[],idle=carryState(live);
  idle.auditArchive=await admitAuditArchive({state:idle,api,fetcher,root:temp(t),warn:message=>warnings.push(message)});
  assert.equal(idle.auditArchive.mode,'prune');assert.deepEqual(idle.auditArchive.drops,{});
  assert.equal(warnings.length,24);assert.ok(warnings.every(message=>/^Keeping static-data\/financial-corrections\/carry-projection-/.test(message)));
  assert.deepEqual(finalizeDrops(idle,root,{cwd,warn:quiet}),[]);
  assert.equal(composeFinancialAuditArchive({state:idle,dist:root,hosted:live.receipt.financial_audit_files,runId:50,runAttempt:1}),null);
  assert.doesNotThrow(()=>assertArchiveBinding(idle,live,{...live.receipt}));
  assert.deepEqual(await verifyArchiveAvailability(null,{api:()=>{throw Error('no API call expected');},fetcher:()=>{throw Error('no download expected');}}),{probe:[],full:[]});
  // The archive workflow stages all 24 hosted bins, the active carry included.
  write(join(site.pages,'publication.json'),JSON.stringify(live.receipt));
  const staged=join(temp(t),'staged'),plan=await collectArchive({output:staged,fetcher,sleep:async()=>{},cwd:temp(t),log:quiet,validate:value=>value});
  assert.deepEqual(plan.entries.map(entry=>entry.path),site.carries.map(carry=>carry.path).sort());assert.deepEqual(plan.conflicts,[]);
  await uploadArchive({input:staged,token:FAKE_WRITE_TOKEN,fetcher,sleep:async()=>{},log:quiet,controllerSha:'b'.repeat(40)});
  assert.equal(await verifyPublic({input:staged,fetcher,sleep:async()=>{}}),24);
  assert.equal(fake.state().releases.filter(release=>release.tag_name.startsWith(ARCHIVE_TAG_PREFIX)&&!release.draft).length,24);
  // A copy that now redirects off the allowed hosts is the only carry kept.
  const odd=archiveLocation(site.carries[5].path);fake.fault(odd.tag,odd.asset,{redirectTo:'https://evil.example/carry.json.gz'});
  const partialWarnings=[],partial=await admitAuditArchive({state:carryState(live),api,fetcher,root:temp(t),warn:message=>partialWarnings.push(message)});
  assert.equal(Object.keys(partial.drops).length,23);assert.ok(!Object.hasOwn(partial.drops,site.carries[5].path));
  assert.equal(partialWarnings.length,1);assert.match(partialWarnings[0],/allowed public download hosts/);
  fake.clearFaults();
  // The next publication: every verified copy leaves Pages, including the live active carry.
  const state=carryState(live);
  state.auditArchive=await admitAuditArchive({state,api,fetcher,root:temp(t),warn:quiet});
  assert.equal(Object.keys(state.auditArchive.drops).length,24);assert.ok(Object.hasOwn(state.auditArchive.drops,active.path));
  const removal=finalizeDrops(state,root,{cwd,warn:quiet});
  assert.deepEqual(removal,site.carries.map(carry=>carry.path).sort());
  site.carries.forEach((carry,i)=>assert.deepEqual(state.auditArchive.drops[carry.path].receipts,[site.receipts[i].path]));
  // The new carry and its receipt are hosted; the 24 older bins are not.
  const dist=temp(t,'dist-'),next=Buffer.from(JSON.stringify({schema_version:'carry',next:true})),nextPath=fc('carry-projection',sha(next));
  const nextReceipt={mode:'carry',financial_generation:sha('next generation'),evaluation_projection:{path:nextPath,sha256:sha(next)},source_projection:{path:fc('source-projection',sha(site.sp)),sha256:sha(site.sp)},source_base:{path:fc('source-base',sha(site.sb)),sha256:sha(site.sb)}};
  const nextBytes=Buffer.from(JSON.stringify(nextReceipt)),nextRef={schema_version:'financial-release-receipt-v1',path:fc('release',sha(nextBytes)),sha256:sha(nextBytes)};
  for(const item of site.receipts)write(join(dist,item.path),item.bytes);
  write(join(dist,nextPath),next);write(join(dist,nextRef.path),nextBytes);write(join(dist,fc('source-projection',sha(site.sp))),site.sp);write(join(dist,fc('source-base',sha(site.sb))),site.sb);
  const hosted={...Object.fromEntries(Object.entries(live.receipt.financial_audit_files).filter(([path])=>!removal.includes(path))),[nextPath]:sha(next),[nextRef.path]:nextRef.sha256};
  const index=composeFinancialAuditArchive({state,dist,hosted,runId:50,runAttempt:1});
  assert.deepEqual(Object.keys(index.files),removal);
  const publication={...live.receipt,financial_release:nextRef,financial_audit_files:hosted,financial_audit_archive:index};
  assert.equal(validateFinancialAuditArchive(index,publication),index);
  assert.ok(Buffer.byteLength(JSON.stringify(index))<32*1024,'about 1.2 KB of index per archived carry');
  assert.doesNotThrow(()=>assertFinancialAuditPreserved(live.receipt.financial_audit_files,hosted,{archivedAfter:index.files,pinned:archivePins(nextReceipt,nextRef)}));
  assert.equal(Object.keys(hosted).filter(path=>/carry-projection-/.test(path)).length,1,'only the new active carry stays in the nested audit layer');
  // Recheck after a covering admission: metadata only, no further downloads.
  const calls=fake.calls().length;
  assert.equal(admissionCovers(state,live),true);assertArchiveBinding(state,live,publication);
  assert.deepEqual(await verifyArchiveAvailability(index,{api,fetcher,probeAll:!admissionCovers(state,live)}),{probe:[],full:[]});
  assert.equal(fake.calls().length,calls,'a covered recheck reads only release metadata');
});
