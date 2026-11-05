// Workflow text and behaviour contracts for market-study-archive.yml, which
// copies the diagnostic market-regime study output of one Design Acceptance
// run to the release market-regime-study-v2-run-<run_id>. The two inline
// programs run exactly as written in the workflow, against a fake `gh` on
// PATH: no network, no GitHub API and no release is touched.
// CI runs this file through design-carry-workflow.test.mjs, which imports it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {STUDY_VERSION,YAHOO} from '../../frontend/tools/market-regime-study.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const workflow=read('../workflows/market-study-archive.yml');
const REPO='kusennjp1-ai/screener',RUN=41844557380,ARTIFACT=13331791935,AS_OF='2026-11-03',TAG=`market-regime-study-v2-run-${RUN}`;
const CONTROLLER='c'.repeat(40),HEAD='af8648592988875513f9e3d9b6e2add7eddef04f';
const ASSETS=['results.json','results.md','indices.json'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const steps=()=>workflow.split(/\n(?=      - )/).slice(1).map(block=>block.split(/\n(?=  [a-zA-Z])/)[0]);
const step=name=>{const found=steps().filter(block=>block.startsWith(`      - name: ${name}\n`));assert.equal(found.length,1,name);return found[0];};
const DOWNLOAD='Download and verify only the study files',PUBLISH='Publish to the study release without overwriting different bytes';
const program=name=>{const match=/        run: \|\n          python3 -I - <<'PY'\n([^]*?)\n          PY\n?$/.exec(step(name));assert.ok(match,name);return match[1].replace(/^ {10}/gm,'');};
// Every `run:` script body, for the expression-injection check.
const runScripts=text=>{const lines=text.split('\n'),out=[];for(let i=0;i<lines.length;i++){const m=/^( *)(- )?run:(.*)$/.exec(lines[i]);if(!m)continue;const indent=m[1].length+(m[2]?2:0);if(!/^\s*[|>]/.test(m[3])){out.push(m[3]);continue;}const body=[];for(let j=i+1;j<lines.length&&(lines[j].trim()===''||lines[j].search(/\S/)>indent);j++)body.push(lines[j]);out.push(body.join('\n'));}return out;};

test('dispatch only, from main, with the run, artifact and as-of defaults of the 11-04 study',()=>{
  assert.match(workflow,/^on:\n  workflow_dispatch:\n    inputs:\n/m);
  assert.doesNotMatch(workflow,/^  (?:push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch|release|issue_comment):/m);
  const input=(name,value,required)=>assert.match(workflow,new RegExp(`\\n      ${name}:\\n        description: '[^'\\n]+'\\n        required: ${required}\\n        default: '${value}'\\n        type: string\\n`),name);
  input('run_id',String(RUN),true);input('artifact_id',String(ARTIFACT),false);input('as_of_date',AS_OF,true);
  assert.match(workflow,/\njobs:\n  archive:\n    name: Archive the market-regime study output\n    if: github\.repository == 'kusennjp1-ai\/screener' && github\.ref == 'refs\/heads\/main'\n/);
  assert.match(workflow,/^concurrency:\n  group: market-study-archive\n  cancel-in-progress: false\n/m);
});
test('least permissions: actions read and contents write, nowhere else and no secrets',()=>{
  assert.match(workflow,/\npermissions:\n  actions: read\n  contents: write\n\n/);
  assert.equal((workflow.match(/^\s*permissions:/gm)||[]).length,1,'no job-level permissions');
  assert.equal((workflow.match(/contents: write/g)||[]).length,1);
  assert.doesNotMatch(workflow,/(?:actions|pages|id-token|packages|deployments|issues|pull-requests|statuses|checks|attestations):\s*write|write-all|secrets\.|GITHUB_TOKEN:|persist-credentials/);
  // No checkout and no third-party action: only the runner's gh and python3 run.
  assert.doesNotMatch(workflow,/uses:/);
  assert.equal(steps().length,2);
  for(const name of [DOWNLOAD,PUBLISH])assert.match(step(name),/^        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}\n/m,name);
  assert.equal((workflow.match(/github\.token/g)||[]).length,2);
});
test('inputs reach the programs through env only, never interpolated into a script',()=>{
  const scripts=runScripts(workflow);assert.equal(scripts.length,2);
  for(const script of scripts)assert.doesNotMatch(script,/\$\{\{/);
  assert.match(step(DOWNLOAD),/          RUN_ID: \$\{\{ inputs\.run_id \}\}\n          ARTIFACT_ID: \$\{\{ inputs\.artifact_id \}\}\n          EXPECTED_AS_OF: \$\{\{ inputs\.as_of_date \}\}\n/);
  assert.match(step(PUBLISH),/          RUN_ID: \$\{\{ inputs\.run_id \}\}\n        run:/);
});
test('the release is only ever created, appended to or re-described: no clobber, no delete, never Latest',()=>{
  const publish=program(PUBLISH);
  assert.doesNotMatch(workflow,/--clobber|delete-asset|release", "delete"|release delete|DELETE|"-X"|--method/);
  assert.equal((publish.match(/"gh", "release", "create"/g)||[]).length,1);
  assert.equal((publish.match(/"--latest=false"/g)||[]).length,2,'create and edit both keep the repository Latest release');
  assert.match(publish,/"--target", TARGET/);
  for(const text of [program(DOWNLOAD),publish])assert.equal((text.match(/TAG_PREFIX = "market-regime-study-v2-run-"/g)||[]).length,1);
  // release-asset-cleanup.yml never prunes this prefix.
  assert.match(read('../workflows/release-asset-cleanup.yml'),/RESERVED_RELEASE_PREFIXES = \("financial-audit-", "market-regime-study-"\)/);
});
test('the checked names are the study tool\'s own output fields',()=>{
  const download=program(DOWNLOAD),tool=read('../../frontend/tools/market-regime-study.mjs');
  assert.ok(download.includes(`STUDY_SCHEMA = "${STUDY_VERSION}"`));
  assert.equal(STUDY_VERSION,'market-regime-study-v2');
  assert.ok(download.includes(`INDEX_SYMBOLS = ${JSON.stringify(YAHOO.symbols).replace(/,/g,', ')}`));
  assert.match(tool,/return \{ schema_version: STUDY_VERSION, label: runLabel, generated_at: new Date\(\)\.toISOString\(\), as_of_date: asOfDate,/);
  assert.match(tool,/return \{ schema_version: 'market-regime-indices-v1', as_of_date: asOfDate, start, indices \};/);
  assert.ok(download.includes('INDICES_SCHEMA = "market-regime-indices-v1"'));
  assert.ok(tool.includes('`${STUDY_VERSION} (pre-registered in frontend/tools/market-regime-study.mjs, with its deviations from v1) · as of ${study.as_of_date ?? \'n/a\'} · '));
  assert.ok(download.includes('f"{STUDY_SCHEMA} (pre-registered" not in markdown or f"· as of {EXPECTED_AS_OF} ·" not in markdown'));
  // Design Acceptance writes the files this workflow reads.
  const design=read('../workflows/design-acceptance.yml');
  for(const flag of ['--save-indices "$STUDY_OUT/indices.json"','--out "$STUDY_OUT/results.json"','--markdown "$STUDY_OUT/results.md"'])assert.ok(design.includes(flag),flag);
  assert.ok(design.includes('name: market-regime-study-${{ github.run_id }}-${{ github.run_attempt }}'));
});
test('CI runs this file: ci.yml runs design-carry-workflow.test.mjs, which imports it',()=>{
  assert.match(read('../workflows/ci.yml'),/node --test [^\n]*\.github\/scripts\/design-carry-workflow\.test\.mjs/);
  assert.match(read('./design-carry-workflow.test.mjs'),/^import '\.\/market-study-archive-workflow\.test\.mjs';$/m);
});

// ---- behaviour, against a fake gh ---------------------------------------------------------------------------------
const FAKE_GH=String.raw`#!/usr/bin/env python3
import hashlib, json, os, shutil, sys
from pathlib import Path
args = sys.argv[1:]
state_path = Path(os.environ["FAKE_GH_STATE"])
state = json.loads(state_path.read_text())
with open(os.environ["FAKE_GH_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")
store = Path(os.environ["FAKE_GH_STORE"])
def save():
    state_path.write_text(json.dumps(state))
def option(name):
    return args[args.index(name) + 1]
def add_asset(release, path):
    name = Path(path).name
    if any(asset["name"] == name for asset in release["assets"]):
        sys.exit(f"asset under the same name already exists: {name}")
    data = Path(path).read_bytes() + (b"corrupted" if state.get("corrupt") == name else b"")
    stored = store / f"{len(os.listdir(store))}-{name}"
    stored.write_bytes(data)
    release["assets"].append({"name": name, "state": "uploaded", "size": len(data), "digest": "sha256:" + hashlib.sha256(data).hexdigest(), "path": str(stored)})
if args[0] == "api":
    path = args[1]
    prefix = "repos/" + os.environ["GITHUB_REPOSITORY"] + "/"
    assert path.startswith(prefix), path
    path = path[len(prefix):]
    if path.startswith("releases/tags/"):
        release = state["releases"].get(path[len("releases/tags/"):])
        if release is None:
            sys.stderr.write("gh: Not Found (HTTP 404)\n")
            sys.exit(1)
        print(json.dumps(release))
    elif path.endswith("/zip"):
        sys.stdout.buffer.write(Path(state["zip"]).read_bytes())
    elif path in state["api"]:
        print(json.dumps(state["api"][path]))
    else:
        sys.stderr.write("gh: Not Found (HTTP 404)\n")
        sys.exit(1)
elif args[:2] == ["release", "create"]:
    tag = args[2]
    assert tag not in state["releases"], tag
    files = [value for value in args[3:args.index("--repo")]]
    release = {"tag_name": tag, "draft": False, "html_url": "https://github.com/x/releases/tag/" + tag, "assets": [], "target": option("--target"), "title": option("--title"), "body": Path(option("--notes-file")).read_text()}
    for file in files:
        add_asset(release, file)
    state["releases"][tag] = release
    save()
elif args[:2] == ["release", "upload"]:
    release = state["releases"][args[2]]
    for file in args[3:args.index("--repo")]:
        add_asset(release, file)
    save()
elif args[:2] == ["release", "edit"]:
    release = state["releases"][args[2]]
    release["title"] = option("--title")
    release["body"] = Path(option("--notes-file")).read_text()
    save()
elif args[:2] == ["release", "download"]:
    release = state["releases"][args[2]]
    [asset] = [asset for asset in release["assets"] if asset["name"] == option("--pattern")]
    shutil.copy(asset["path"], Path(option("--dir")) / asset["name"])
else:
    sys.exit(f"unexpected fake gh call {args}")
`;
const results=(edit={})=>JSON.stringify({schema_version:'market-regime-study-v2',label:'CI: fixture',generated_at:'2026-11-04T14:10:00.000Z',as_of_date:AS_OF,method:{windows:[21]},tests:{tests:1},indicators:[{key:'ma.quadrant'}],...edit})+'\n';
const indices=(edit={})=>JSON.stringify({schema_version:'market-regime-indices-v1',as_of_date:AS_OF,start:'1990-01-01',indices:[{symbol:'^GSPC',bars:[]},{symbol:'^IXIC',bars:[]}],...edit})+'\n';
const markdown=(asOf=AS_OF)=>`# Market-regime study — CI: fixture\n\nmarket-regime-study-v2 (pre-registered in frontend/tools/market-regime-study.mjs, with its deviations from v1) · as of ${asOf} · rotation placebo\n`;
const designFiles=(edit={})=>({'_temp/market-regime-study/results.json':results(),'_temp/market-regime-study/results.md':markdown(),'_temp/market-regime-study/indices.json':indices(),'_temp/market-regime-study/nyse-sessions.json':'["2026-11-03"]',
  'screener/screener/frontend/test-results/design-review/report.json':'{}','screener/screener/frontend/test-results/design-review/results.json':'{"decoy":true}',...edit});

function fixture({files=designFiles(),name='design-acceptance-2b19fbe10b859f4217819809e1bc1cb29fbd382f',run={},artifact={},releases={},listing=null,corrupt=null}={}){
  const dir=mkdtempSync(join(tmpdir(),'market-study-archive-')),bin=join(dir,'bin'),store=join(dir,'store'),runner=join(dir,'runner');
  for(const path of [bin,store,runner])mkdirSync(path);
  writeFileSync(join(bin,'gh'),FAKE_GH,{mode:0o755});
  const zip=join(dir,'artifact.zip'),members=join(dir,'members.json');writeFileSync(members,JSON.stringify(files));
  execFileSync('python3',['-I','-c','import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:\n    [z.writestr(k,v) for k,v in json.load(open(sys.argv[2])).items()]',zip,members]);
  const runInfo={id:RUN,path:'.github/workflows/design-acceptance.yml',status:'completed',conclusion:'success',event:'pull_request',head_sha:HEAD,repository:{full_name:REPO},head_repository:{full_name:REPO},...run};
  const artifactInfo={id:ARTIFACT,name,size_in_bytes:readFileSync(zip).length,expired:false,digest:`sha256:${sha(readFileSync(zip))}`,workflow_run:{id:RUN},...artifact};
  const api={[`actions/runs/${RUN}`]:runInfo,[`actions/artifacts/${artifactInfo.id}`]:artifactInfo,[`actions/runs/${RUN}/artifacts?per_page=100`]:listing??{artifacts:[artifactInfo]}};
  writeFileSync(join(dir,'state.json'),JSON.stringify({zip,api,releases,corrupt}));writeFileSync(join(dir,'gh.log'),'');
  const run_=(name,inputs={})=>{const summary=join(dir,'summary.md');if(!existsSync(summary))writeFileSync(summary,'');
    const result=spawnSync('python3',['-I','-'],{input:program(name),encoding:'utf8',env:{PATH:`${bin}:${process.env.PATH}`,GITHUB_REPOSITORY:REPO,GITHUB_SHA:CONTROLLER,GITHUB_RUN_ID:'99',RUNNER_TEMP:runner,GITHUB_STEP_SUMMARY:summary,
      FAKE_GH_STATE:join(dir,'state.json'),FAKE_GH_LOG:join(dir,'gh.log'),FAKE_GH_STORE:store,RUN_ID:String(RUN),ARTIFACT_ID:String(ARTIFACT),EXPECTED_AS_OF:AS_OF,...inputs}});
    return {...result,output:result.stdout+result.stderr};};
  return {dir,runner,
    download:inputs=>run_(DOWNLOAD,inputs),publish:inputs=>run_(PUBLISH,inputs),
    calls:()=>readFileSync(join(dir,'gh.log'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)),
    state:()=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8')),
    summary:()=>readFileSync(join(dir,'summary.md'),'utf8'),
    study:file=>join(runner,'market-study-archive','study',file),
    cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const writes=calls=>calls.filter(call=>call[0]==='release');
const expected={'results.json':sha(results()),'results.md':sha(markdown()),'indices.json':sha(indices())};

test('a Design artifact becomes one release holding its exact study bytes, with the sha256 in notes and summary',()=>{
  const f=fixture();
  try{
    const downloaded=f.download();assert.equal(downloaded.status,0,downloaded.output);
    assert.deepEqual(writes(f.calls()),[],'verification writes nothing');
    for(const file of ASSETS)assert.equal(sha(readFileSync(f.study(file))),expected[file],file);
    assert.equal(readFileSync(f.study('results.json'),'utf8'),results(),'the study copy, not the decoy results.json');
    const published=f.publish();assert.equal(published.status,0,published.output);
    const release=f.state().releases[TAG];
    assert.deepEqual(release.assets.map(asset=>asset.name),ASSETS,'nyse-sessions.json is recorded, not uploaded');
    for(const asset of release.assets){assert.equal(asset.digest,`sha256:${expected[asset.name]}`);assert.ok(release.body.includes(`${expected[asset.name]}  ${asset.name}`));assert.ok(f.summary().includes(`${expected[asset.name]}  ${asset.name}`));}
    assert.ok(release.body.includes(`${sha('["2026-11-03"]')}  nyse-sessions.json`));
    for(const text of ['schema_version: market-regime-study-v2',`as_of_date: ${AS_OF}`,`run ${RUN} (head ${HEAD}`,`id ${ARTIFACT}`,'not a forecast'])assert.ok(release.body.includes(text),text);
    assert.equal(release.target,CONTROLLER);assert.equal(release.title,`Market-regime study v2, Design Acceptance run ${RUN} (as of ${AS_OF})`);
    const create=writes(f.calls());assert.equal(create.length,1);assert.equal(create[0][1],'create');assert.ok(create[0].includes('--latest=false'));
    // A second dispatch finds the same bytes: no upload, only the notes are re-written.
    assert.equal(f.download().status,0);const again=f.publish();assert.equal(again.status,0,again.output);
    assert.deepEqual(writes(f.calls()).map(call=>call[1]),['create','edit']);
    assert.equal(f.state().releases[TAG].assets.length,3);
  }finally{f.cleanup();}
});
test('an existing asset with different bytes is refused before any write, by digest or by download',()=>{
  for(const digest of [`sha256:${'0'.repeat(64)}`,null]){
    const f=fixture();
    try{
      const other=join(f.dir,'store','other');writeFileSync(other,'{"other":true}\n');
      const state=f.state();state.releases[TAG]={tag_name:TAG,draft:false,html_url:'u',assets:[{name:'results.json',state:'uploaded',size:15,digest,path:other}]};
      writeFileSync(join(f.dir,'state.json'),JSON.stringify(state));
      assert.equal(f.download().status,0);
      const refused=f.publish();
      assert.notEqual(refused.status,0);
      assert.match(refused.output,/::error title=Market-study archive::refusing to overwrite market-regime-study-v2-run-41844557380: results\.json: the release has sha256 /);
      assert.ok(refused.output.includes(expected['results.json']));
      assert.deepEqual(writes(f.calls()).map(call=>call[1]),digest?[]:['download'],'no create, upload or edit');
      assert.equal(f.state().releases[TAG].assets.length,1);
    }finally{f.cleanup();}
  }
});
test('a partial release gains only its missing assets, without clobber, then is verified',()=>{
  const f=fixture();
  try{
    const same=join(f.dir,'store','same');writeFileSync(same,results());
    const state=f.state();state.releases[TAG]={tag_name:TAG,draft:false,html_url:'u',assets:[{name:'results.json',state:'uploaded',size:1,digest:null,path:same}]};
    writeFileSync(join(f.dir,'state.json'),JSON.stringify(state));
    assert.equal(f.download().status,0);const published=f.publish();assert.equal(published.status,0,published.output);
    const calls=writes(f.calls());
    assert.deepEqual(calls.map(call=>call[1]),['download','upload','edit','download']);
    assert.deepEqual(calls[1].slice(3,5).map(path=>path.split('/').at(-1)),['results.md','indices.json']);
    assert.ok(!calls.flat().includes('--clobber'));
    assert.deepEqual(f.state().releases[TAG].assets.map(asset=>asset.name),['results.json','results.md','indices.json']);
  }finally{f.cleanup();}
});
test('an incomplete or duplicated asset is a conflict, never replaced',()=>{
  const f=fixture();
  try{
    const state=f.state();state.releases[TAG]={tag_name:TAG,draft:false,html_url:'u',assets:[{name:'indices.json',state:'starter',size:0,digest:null,path:'x'}]};
    writeFileSync(join(f.dir,'state.json'),JSON.stringify(state));
    assert.equal(f.download().status,0);const refused=f.publish();
    assert.notEqual(refused.status,0);assert.match(refused.output,/indices\.json: not one complete asset/);assert.deepEqual(writes(f.calls()),[]);
  }finally{f.cleanup();}
});
test('the release is read back: bytes that did not land as verified fail the run',()=>{
  const f=fixture({corrupt:'indices.json'});
  try{
    assert.equal(f.download().status,0);const published=f.publish();
    assert.notEqual(published.status,0);
    assert.match(published.output,/release market-regime-study-v2-run-41844557380 does not hold the verified study: indices\.json: the release has sha256 /);
    assert.doesNotMatch(f.summary(),/## Published/);
  }finally{f.cleanup();}
});
test('schema, as-of date, completeness and the other study files are checked before anything is published',()=>{
  const cases=[
    [{'_temp/market-regime-study/results.json':results({schema_version:'market-regime-study-v1'})},/results\.json schema_version is 'market-regime-study-v1', not 'market-regime-study-v2'/],
    [{'_temp/market-regime-study/results.json':results({as_of_date:'2026-11-04'})},/results\.json as_of_date is '2026-11-04', not '2026-11-03'/],
    [{'_temp/market-regime-study/results.json':results({indicators:[]})},/not a complete study/],
    [{'_temp/market-regime-study/results.json':'{"schema_version":"market-regime-study-v2","as_of_date":"2026-11-03","x":NaN}'},/results\.json is not strict JSON/],
    [{'_temp/market-regime-study/indices.json':indices({as_of_date:'2026-11-02'})},/indices\.json is not market-regime-indices-v1 as of 2026-11-03/],
    [{'_temp/market-regime-study/indices.json':indices({indices:[{symbol:'^GSPC'}]})},/indices\.json does not hold exactly/],
    [{'_temp/market-regime-study/results.md':markdown('2026-11-04')},/results\.md is not the market-regime-study-v2 report as of 2026-11-03/],
    [{'_temp/market-regime-study/results.md':undefined},/must hold exactly one market-regime-study\/results\.md/],
    [{'_temp/other/market-regime-study/results.json':results()},/must hold exactly one market-regime-study\/results\.json/],
  ];
  for(const [edit,message]of cases){
    const files=designFiles(edit);for(const key of Object.keys(files))if(files[key]===undefined)delete files[key];
    const f=fixture({files});
    try{
      const refused=f.download();
      assert.notEqual(refused.status,0,String(message));assert.match(refused.output,message);
      assert.deepEqual(writes(f.calls()),[]);
      assert.ok(!existsSync(join(f.runner,'market-study-archive','archive.json')),'no plan for the publish step');
      assert.notEqual(f.publish().status,0,'publishing needs a verified plan');assert.deepEqual(writes(f.calls()),[]);
    }finally{f.cleanup();}
  }
  // The dispatch may name another as-of date, which the files must then carry.
  const f=fixture();
  try{const refused=f.download({EXPECTED_AS_OF:'2026-11-04'});assert.notEqual(refused.status,0);assert.match(refused.output,/as_of_date is '2026-11-03', not '2026-11-04'/);}finally{f.cleanup();}
});
test('only a completed same-repository Design run and its own unexpired, digest-matching artifact are read',()=>{
  const cases=[
    [{run:{path:'.github/workflows/ci.yml'}},/is not a \.github\/workflows\/design-acceptance\.yml run/],
    [{run:{head_repository:{full_name:'someone/fork'}}},/did not run on kusennjp1-ai\/screener code/],
    [{run:{status:'in_progress'}},/has not completed/],
    [{artifact:{workflow_run:{id:RUN+1}}},/artifact 13331791935 does not belong to run 41844557380/],
    [{artifact:{expired:true}},/has expired/],
    [{artifact:{digest:`sha256:${'1'.repeat(64)}`}},/differ from the artifact digest/],
    [{name:'something-else'},/neither a Design artifact nor a study upload/],
  ];
  for(const [options,message]of cases){
    const f=fixture(options);
    try{
      const refused=f.download();assert.notEqual(refused.status,0,String(message));assert.match(refused.output,message);
      assert.deepEqual(writes(f.calls()),[]);
      if(!/digest/.test(String(message)))assert.ok(!f.calls().some(call=>call[1].endsWith('/zip')),'refused before the download');
    }finally{f.cleanup();}
  }
  for(const inputs of [{RUN_ID:'4184; rm -rf /'},{RUN_ID:''},{ARTIFACT_ID:'x'},{EXPECTED_AS_OF:'11/03/2026'}]){
    const f=fixture();
    try{const refused=f.download(inputs);assert.notEqual(refused.status,0);assert.deepEqual(f.calls(),[],'invalid inputs reach no gh call');}finally{f.cleanup();}
  }
});
test('a blank artifact_id picks the run\'s single study-only upload, whose files sit at its root',()=>{
  const files={'results.json':results(),'results.md':markdown(),'indices.json':indices(),'nyse-sessions.json':'[]'};
  const f=fixture({files,name:`market-regime-study-${RUN}-1`});
  try{
    const downloaded=f.download({ARTIFACT_ID:''});assert.equal(downloaded.status,0,downloaded.output);
    assert.ok(f.calls().some(call=>call[1]===`repos/${REPO}/actions/runs/${RUN}/artifacts?per_page=100`));
    assert.equal(f.publish().status,0);
    assert.deepEqual(f.state().releases[TAG].assets.map(asset=>asset.digest),ASSETS.map(file=>`sha256:${expected[file]}`));
  }finally{f.cleanup();}
  // A study-only artifact never takes nested files, and two study uploads are ambiguous.
  const nested=fixture({files:designFiles(),name:`market-regime-study-${RUN}-1`});
  try{assert.match(nested.download().output,/must hold exactly one market-regime-study\/results\.json/);}finally{nested.cleanup();}
  const two=fixture({listing:{artifacts:[{id:1,name:`market-regime-study-${RUN}-1`},{id:2,name:`market-regime-study-${RUN}-2`}]}});
  try{const refused=two.download({ARTIFACT_ID:''});assert.notEqual(refused.status,0);assert.match(refused.output,/has 2 market-regime-study-\* artifacts; pass artifact_id/);}finally{two.cleanup();}
});
