// Workflow text and behaviour contracts for market-study-archive.yml, which
// copies the diagnostic market-regime study output of one Design Acceptance
// run to the release market-regime-study-v2-run-<run_id>. The two inline
// programs (the verify job's and the publish job's) run exactly as written in
// the workflow, against a fake `gh` on PATH: no network, no GitHub API and no
// release is touched.
// CI runs this file through design-carry-workflow.test.mjs, which imports it;
// test_release_asset_cleanup.py (listed in ci.yml) fails if that import goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
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
const HANDOFF='Hand the verified study to the publish job',RECEIVE='Receive the verified study';
const jobs=()=>Object.fromEntries(workflow.slice(workflow.indexOf('\njobs:\n')+'\njobs:\n'.length).split(/\n(?=  [a-z])/).map(block=>[block.slice(2,block.indexOf(':')),block]));
const program=name=>{const match=/        run: \|\n          python3 -I - <<'PY'\n([^]*?)\n          PY\n?$/.exec(step(name));assert.ok(match,name);return match[1].replace(/^ {10}/gm,'');};
// Every `run:` script body, for the expression-injection check.
const runScripts=text=>{const lines=text.split('\n'),out=[];for(let i=0;i<lines.length;i++){const m=/^( *)(- )?run:(.*)$/.exec(lines[i]);if(!m)continue;const indent=m[1].length+(m[2]?2:0);if(!/^\s*[|>]/.test(m[3])){out.push(m[3]);continue;}const body=[];for(let j=i+1;j<lines.length&&(lines[j].trim()===''||lines[j].search(/\S/)>indent);j++)body.push(lines[j]);out.push(body.join('\n'));}return out;};

test('dispatch only, from main, with the run, artifact and as-of defaults of the 11-04 study',()=>{
  assert.match(workflow,/^on:\n  workflow_dispatch:\n    inputs:\n/m);
  assert.doesNotMatch(workflow,/^  (?:push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch|release|issue_comment):/m);
  const input=(name,value,required)=>assert.match(workflow,new RegExp(`\\n      ${name}:\\n        description: '[^'\\n]+'\\n        required: ${required}\\n        default: '${value}'\\n        type: string\\n`),name);
  input('run_id',String(RUN),true);input('artifact_id',String(ARTIFACT),false);input('as_of_date',AS_OF,true);
  const guard="    if: github\\.repository == 'kusennjp1-ai\\/screener' && github\\.ref == 'refs\\/heads\\/main'\\n";
  assert.match(workflow,new RegExp(`\\njobs:\\n  verify:\\n    name: Verify the market-regime study output\\n${guard}`));
  assert.match(workflow,new RegExp(`\\n  publish:\\n    name: Publish the verified study to its release\\n    needs: verify\\n${guard}`));
  assert.deepEqual(Object.keys(jobs()),['verify','publish']);
  assert.match(workflow,/^concurrency:\n  group: market-study-archive\n  cancel-in-progress: false\n/m);
});
test('least privilege: the job that parses the artifact holds no write token, the job that writes never reads it',()=>{
  assert.match(workflow,/\npermissions: \{\}\n\n/);
  const {verify,publish}=jobs();
  assert.match(verify,/\n    permissions:\n      actions: read\n    outputs:\n/);
  assert.match(publish,/\n    permissions:\n      contents: write\n    steps:\n/);
  assert.equal((workflow.match(/^\s*permissions:/gm)||[]).length,3,'the empty workflow default and one block per job');
  assert.equal((workflow.match(/^ *contents: write$/gm)||[]).length,1);assert.doesNotMatch(verify,/contents:/);assert.doesNotMatch(publish,/actions:/);
  assert.doesNotMatch(workflow,/(?:actions|pages|id-token|packages|deployments|issues|pull-requests|statuses|checks|attestations):\s*write|write-all|secrets\.|GITHUB_TOKEN:|persist-credentials/);
  // No checkout and no third-party action: the runner's gh and python3, and GitHub's artifact hand-off.
  assert.deepEqual(workflow.match(/uses: .*/g),['uses: actions/upload-artifact@v4','uses: actions/download-artifact@v4']);
  assert.deepEqual(steps().map(block=>block.split('\n')[0].slice('      - name: '.length)),[DOWNLOAD,HANDOFF,RECEIVE,PUBLISH]);
  assert.ok(verify.includes(`      - name: ${DOWNLOAD}\n`)&&verify.includes(`      - name: ${HANDOFF}\n`)&&publish.includes(`      - name: ${RECEIVE}\n`)&&publish.includes(`      - name: ${PUBLISH}\n`));
  for(const name of [DOWNLOAD,PUBLISH])assert.match(step(name),/^        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}\n/m,name);
  assert.equal((workflow.match(/github\.token/g)||[]).length,2);
});
test('the hand-off carries only the verified files, for one day, and its plan sha256 travels as a job output',()=>{
  const artifact='market-study-archive-${{ github.run_id }}-${{ github.run_attempt }}',path='${{ runner.temp }}/market-study-archive/';
  assert.equal(step(HANDOFF),[`      - name: ${HANDOFF}`,'        # Only the verified files (study/, notes.md, archive.json); the zip was removed.','        uses: actions/upload-artifact@v4','        with:',`          name: ${artifact}`,`          path: ${path}`,'          retention-days: 1','          if-no-files-found: error','          compression-level: 0'].join('\n'));
  assert.equal(step(RECEIVE),[`      - name: ${RECEIVE}`,'        uses: actions/download-artifact@v4','        with:',`          name: ${artifact}`,`          path: ${path}`].join('\n'));
  for(const name of [DOWNLOAD,PUBLISH])assert.ok(program(name).includes('WORK = Path(os.environ["RUNNER_TEMP"]) / "market-study-archive"'),name);
  assert.ok(program(DOWNLOAD).includes('archive_path.unlink()'),'the downloaded zip is not handed on');
  assert.match(jobs().verify,/\n    outputs:\n      plan_sha256: \$\{\{ steps\.verify\.outputs\.plan_sha256 \}\}\n/);
  assert.match(step(DOWNLOAD),/^        id: verify\n/m);
});
test('inputs reach the programs through env only, never interpolated into a script',()=>{
  const scripts=runScripts(workflow);assert.equal(scripts.length,2);
  for(const script of scripts)assert.doesNotMatch(script,/\$\{\{/);
  assert.match(step(DOWNLOAD),/          RUN_ID: \$\{\{ inputs\.run_id \}\}\n          ARTIFACT_ID: \$\{\{ inputs\.artifact_id \}\}\n          EXPECTED_AS_OF: \$\{\{ inputs\.as_of_date \}\}\n/);
  assert.match(step(PUBLISH),/          RUN_ID: \$\{\{ inputs\.run_id \}\}\n          PLAN_SHA256: \$\{\{ needs\.verify\.outputs\.plan_sha256 \}\}\n        run:/);
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
  // The report's first three lines, as markdownReport writes them.
  assert.ok(tool.includes("add(`# Market-regime study${study.label ? ` — ${study.label}` : ''}`, '',\n    `${STUDY_VERSION} (pre-registered in frontend/tools/market-regime-study.mjs, with its deviations from v1) · as of ${study.as_of_date ?? 'n/a'} · "));
  assert.ok(download.includes('title = "# Market-regime study" + (f" — {results[\'label\']}" if results.get("label") else "")'));
  assert.ok(download.includes('header = f"{STUDY_SCHEMA} (pre-registered in frontend/tools/market-regime-study.mjs, with its deviations from v1) · as of {EXPECTED_AS_OF} · "'));
  assert.ok(download.includes('if len(lines) < 3 or lines[0] != title or lines[1] != "" or not lines[2].startswith(header):'));
  // The calendar basis the study records for each index.
  assert.match(tool,/inputs\.indices\.push\(\{ symbol: item\.symbol, source: item\.source \?\? null, provenance: item\.provenance \?\? null, calendarBasis: aligned\.calendarBasis,/);
  assert.match(tool,/calendarBasis: calendar \? 'independent' : 'provider'/);
  // Design Acceptance writes the files this workflow reads, into its one 90-day Design artifact.
  const design=read('../workflows/design-acceptance.yml');
  for(const flag of ['--save-indices "$STUDY_OUT/indices.json"','--out "$STUDY_OUT/results.json"','--markdown "$STUDY_OUT/results.md"','"$STUDY_OUT/nyse-sessions.json"'])assert.ok(design.includes(flag),flag);
  const preserve=design.slice(design.indexOf('      - name: Preserve all results even when a budget fails\n'));
  assert.match(preserve,/^          name: design-acceptance-\$\{\{ github\.sha \}\}\n/m);
  assert.match(preserve,/^            \$\{\{ runner\.temp \}\}\/market-regime-study\/\n          retention-days: 90\n?$/m);
  assert.ok(download.includes('DESIGN_ARTIFACT = re.compile(r"design-acceptance-[0-9a-f]{40}")'));
  assert.doesNotMatch(design,/name: market-regime-study-/,'no separate study upload');
});
test('CI runs this file: ci.yml runs design-carry-workflow.test.mjs, which imports it',()=>{
  assert.match(read('../workflows/ci.yml'),/node --test [^\n]*\.github\/scripts\/design-carry-workflow\.test\.mjs/);
  assert.match(read('./design-carry-workflow.test.mjs'),/^import '\.\/market-study-archive-workflow\.test\.mjs';$/m);
  // The same import is also checked from a file ci.yml lists directly.
  assert.ok(read('./test_release_asset_cleanup.py').includes(`"import './market-study-archive-workflow.test.mjs';"`));
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
const basis=value=>({indices:[{symbol:'^GSPC',calendarBasis:value},{symbol:'^IXIC',calendarBasis:value}]});
const results=(edit={})=>JSON.stringify({schema_version:'market-regime-study-v2',label:'CI: fixture',generated_at:'2026-11-04T14:10:00.000Z',as_of_date:AS_OF,inputs:basis('independent'),method:{windows:[21]},tests:{tests:1},indicators:[{key:'ma.quadrant'}],...edit})+'\n';
const indices=(edit={})=>JSON.stringify({schema_version:'market-regime-indices-v1',as_of_date:AS_OF,start:'1990-01-01',indices:[{symbol:'^GSPC',bars:[]},{symbol:'^IXIC',bars:[]}],...edit})+'\n';
const markdown=(asOf=AS_OF,title='# Market-regime study — CI: fixture')=>`${title}\n\nmarket-regime-study-v2 (pre-registered in frontend/tools/market-regime-study.mjs, with its deviations from v1) · as of ${asOf} · rotation placebo\n`;
const designFiles=(edit={})=>({'_temp/market-regime-study/results.json':results(),'_temp/market-regime-study/results.md':markdown(),'_temp/market-regime-study/indices.json':indices(),'_temp/market-regime-study/nyse-sessions.json':'["2026-11-03"]',
  'screener/screener/frontend/test-results/design-review/report.json':'{}','screener/screener/frontend/test-results/design-review/results.json':'{"decoy":true}',...edit});

function fixture({files=designFiles(),name='design-acceptance-2b19fbe10b859f4217819809e1bc1cb29fbd382f',run={},artifact={},releases={},listing=null,corrupt=null}={}){
  const dir=mkdtempSync(join(tmpdir(),'market-study-archive-')),bin=join(dir,'bin'),store=join(dir,'store'),runner=join(dir,'runner');
  for(const path of [bin,store,runner])mkdirSync(path);
  writeFileSync(join(bin,'gh'),FAKE_GH,{mode:0o755});
  const zip=join(dir,'artifact.zip'),members=join(dir,'members.json');writeFileSync(members,JSON.stringify(files));
  execFileSync('python3',['-I','-c','import base64,json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:\n    [z.writestr(k,v if isinstance(v,str) else base64.b64decode(v["b64"])) for k,v in json.load(open(sys.argv[2])).items()]',zip,members]);
  const runInfo={id:RUN,path:'.github/workflows/design-acceptance.yml',status:'completed',conclusion:'success',event:'pull_request',head_sha:HEAD,repository:{full_name:REPO},head_repository:{full_name:REPO},...run};
  const artifactInfo={id:ARTIFACT,name,size_in_bytes:readFileSync(zip).length,expired:false,digest:`sha256:${sha(readFileSync(zip))}`,workflow_run:{id:RUN},...artifact};
  const api={[`actions/runs/${RUN}`]:runInfo,[`actions/artifacts/${artifactInfo.id}`]:artifactInfo,[`actions/runs/${RUN}/artifacts?per_page=100`]:listing??{artifacts:[artifactInfo]}};
  writeFileSync(join(dir,'state.json'),JSON.stringify({zip,api,releases,corrupt}));writeFileSync(join(dir,'gh.log'),'');
  // GITHUB_OUTPUT of the verify job; the publish job gets its plan_sha256 as PLAN_SHA256.
  const outputs=join(dir,'outputs.txt'),planSha=()=>existsSync(outputs)?(readFileSync(outputs,'utf8').match(/^plan_sha256=(.*)$/gm)||['plan_sha256=']).at(-1).slice('plan_sha256='.length):'';
  const run_=(name,inputs={})=>{const summary=join(dir,'summary.md');if(!existsSync(summary))writeFileSync(summary,'');
    const result=spawnSync('python3',['-I','-'],{input:program(name),encoding:'utf8',env:{PATH:`${bin}:${process.env.PATH}`,GITHUB_REPOSITORY:REPO,GITHUB_SHA:CONTROLLER,GITHUB_RUN_ID:'99',RUNNER_TEMP:runner,GITHUB_STEP_SUMMARY:summary,GITHUB_OUTPUT:outputs,
      FAKE_GH_STATE:join(dir,'state.json'),FAKE_GH_LOG:join(dir,'gh.log'),FAKE_GH_STORE:store,RUN_ID:String(RUN),ARTIFACT_ID:String(ARTIFACT),EXPECTED_AS_OF:AS_OF,...(name===PUBLISH?{PLAN_SHA256:planSha()}:{}),...inputs}});
    return {...result,output:result.stdout+result.stderr};};
  return {dir,runner,planSha,
    download:inputs=>run_(DOWNLOAD,inputs),publish:inputs=>run_(PUBLISH,inputs),
    calls:()=>readFileSync(join(dir,'gh.log'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)),
    state:()=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8')),
    summary:()=>readFileSync(join(dir,'summary.md'),'utf8'),
    study:file=>join(runner,'market-study-archive','study',file),work:file=>join(runner,'market-study-archive',file),
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
    assert.equal(f.planSha(),sha(readFileSync(f.work('archive.json'))),'the plan sha256 is the job output');
    assert.ok(!existsSync(f.work('artifact.zip')),'the zip is not handed on');
    // The publish job runs from the hand-off alone (download-artifact into its own runner temp).
    const handoff=join(f.dir,'publish-runner');cpSync(join(f.runner,'market-study-archive'),join(handoff,'market-study-archive'),{recursive:true});
    rmSync(join(f.runner,'market-study-archive'),{recursive:true});
    const published=f.publish({RUNNER_TEMP:handoff});assert.equal(published.status,0,published.output);
    const release=f.state().releases[TAG];
    assert.deepEqual(release.assets.map(asset=>asset.name),ASSETS,'nyse-sessions.json is recorded, not uploaded');
    for(const asset of release.assets){assert.equal(asset.digest,`sha256:${expected[asset.name]}`);assert.ok(release.body.includes(`${expected[asset.name]}  ${asset.name}`));assert.ok(f.summary().includes(`${expected[asset.name]}  ${asset.name}`));}
    assert.ok(release.body.includes(`Recorded, not uploaded (the NYSE calendar the run used, calendarBasis=independent):\n\n\`\`\`\n${sha('["2026-11-03"]')}  nyse-sessions.json\n`));
    for(const text of ['schema_version: market-regime-study-v2',`as_of_date: ${AS_OF}`,`run ${RUN} (head ${HEAD}`,`id ${ARTIFACT}`,'not a forecast',`Archived by market-study-archive.yml run 99 at ${CONTROLLER}.`])assert.ok(release.body.includes(text),text);
    assert.equal(release.target,CONTROLLER);assert.equal(release.title,`Market-regime study v2, Design Acceptance run ${RUN} (as of ${AS_OF})`);
    assert.match(f.summary(),/\n## Published market-regime-study-v2-run-41844557380\n/);
    const create=writes(f.calls());assert.equal(create.length,1);assert.equal(create[0][1],'create');assert.ok(create[0].includes('--latest=false'));
    // A later dispatch (another run, another commit) finds the same bytes: nothing is written,
    // so the title, notes and tag target of the first archival stay as they were.
    const later={GITHUB_RUN_ID:'100',GITHUB_SHA:'d'.repeat(40)};
    assert.equal(f.download(later).status,0);const again=f.publish(later);assert.equal(again.status,0,again.output);
    assert.deepEqual(writes(f.calls()).map(call=>call[1]),['create']);
    const kept=f.state().releases[TAG];
    assert.equal(kept.assets.length,3);assert.equal(kept.body,release.body);assert.equal(kept.title,release.title);assert.equal(kept.target,CONTROLLER);
    assert.match(f.summary(),new RegExp(`\\n## Already archived ${TAG}\\n\\n[^\\n]*\\n\\n\`\`\`\\n${ASSETS.map(file=>`${expected[file]}  ${file.replace('.','\\.')}`).join('\\n')}\\n\`\`\`\\n$`));
  }finally{f.cleanup();}
});
test('the publish job takes only the verify job\'s hand-off: plan, notes and study files are re-hashed',()=>{
  const tamper=[
    [f=>writeFileSync(f.study('results.json'),results({label:'other'})),/results\.json changed after verification/],
    [f=>writeFileSync(f.work('notes.md'),'other notes\n'),/notes\.md changed after verification/],
    [f=>writeFileSync(f.work('archive.json'),readFileSync(f.work('archive.json'),'utf8').replace('"tag"','"tag" ')),/archive\.json differs from the plan the verify job wrote/],
    [()=>{},/the verify job passed no plan sha256/,{PLAN_SHA256:''}],
    [()=>{},/archive\.json differs from the plan the verify job wrote/,{PLAN_SHA256:'e'.repeat(64)}],
  ];
  for(const [change,message,inputs={}]of tamper){
    const f=fixture();
    try{
      assert.equal(f.download().status,0);change(f);
      const refused=f.publish(inputs);assert.notEqual(refused.status,0,String(message));assert.match(refused.output,message);
      assert.deepEqual(writes(f.calls()),[],'no release call');assert.ok(!f.calls().some(call=>/releases\/tags/.test(call[1]??'')),'refused before any lookup');
    }finally{f.cleanup();}
  }
});
test('nyse-sessions.json is called the calendar the run used only when results.json says every index used it',()=>{
  const cases=[
    [basis('provider'),'nyse-sessions.json present but not used: the study used provider dates (calendarBasis=provider). Recorded, not uploaded:'],
    [{indices:[{symbol:'^GSPC',calendarBasis:'independent'},{symbol:'^IXIC',calendarBasis:'provider'}]},"nyse-sessions.json present; results.json does not show that the study used it (calendarBasis ['independent', 'provider']). Recorded, not uploaded:"],
    [undefined,'nyse-sessions.json present; results.json does not show that the study used it (calendarBasis []). Recorded, not uploaded:'],
  ];
  for(const [inputs,note]of cases){
    const f=fixture({files:designFiles({'_temp/market-regime-study/results.json':results({inputs}),'_temp/market-regime-study/nyse-sessions.json':'['})});
    try{
      assert.equal(f.download().status,0);const published=f.publish();assert.equal(published.status,0,published.output);
      const body=f.state().releases[TAG].body;
      assert.ok(body.includes(`\n${note}\n\n\`\`\`\n${sha('[')}  nyse-sessions.json\n`),body);
      assert.ok(!body.includes('the NYSE calendar the run used'),note);
    }finally{f.cleanup();}
  }
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
    [{'_temp/market-regime-study/results.md':markdown('2026-11-04')},/results\.md does not open as the market-regime-study-v2 report of this results\.json as of 2026-11-03/],
    // The right date further down does not stand in for the header's.
    [{'_temp/market-regime-study/results.md':markdown('2026-11-04')+'\n| x | y · as of 2026-11-03 · z |\n'},/results\.md does not open as the market-regime-study-v2 report of this results\.json/],
    [{'_temp/market-regime-study/results.md':markdown(AS_OF,'# Market-regime study — another run')},/results\.md does not open as the market-regime-study-v2 report of this results\.json/],
    [{'_temp/market-regime-study/results.md':'\n'+markdown()},/results\.md does not open as/],
    [{'_temp/market-regime-study/results.md':{b64:Buffer.concat([Buffer.from(markdown()),Buffer.from([0xff,0xfe])]).toString('base64')}},/::error title=Market-study archive::results\.md is not UTF-8: /],
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
    [{name:'something-else'},/'something-else' is not a design-acceptance-<sha> artifact/],
    [{name:`market-regime-study-${RUN}-1`},/is not a design-acceptance-<sha> artifact/],
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
test('a blank artifact_id picks the run\'s single design-acceptance-<sha> artifact',()=>{
  const name='design-acceptance-2b19fbe10b859f4217819809e1bc1cb29fbd382f';
  const others=[{id:7,name:`financial-release-candidate-${RUN}-1`},{id:8,name:`market-regime-study-${RUN}-1`},{id:9,name:`${name}-x`}];
  const f=fixture({listing:{artifacts:[...others,{id:ARTIFACT,name}]}});
  try{
    const downloaded=f.download({ARTIFACT_ID:''});assert.equal(downloaded.status,0,downloaded.output);
    const calls=f.calls().map(call=>call[1]);
    assert.ok(calls.includes(`repos/${REPO}/actions/runs/${RUN}/artifacts?per_page=100`));
    assert.ok(calls.includes(`repos/${REPO}/actions/artifacts/${ARTIFACT}`)&&!others.some(other=>calls.includes(`repos/${REPO}/actions/artifacts/${other.id}`)));
    assert.equal(f.publish().status,0);
    assert.deepEqual(f.state().releases[TAG].assets.map(asset=>asset.digest),ASSETS.map(file=>`sha256:${expected[file]}`));
  }finally{f.cleanup();}
  // Study files at a Design artifact's root are not the study directory, and two Design artifacts are ambiguous.
  const root=fixture({files:{'results.json':results(),'results.md':markdown(),'indices.json':indices()}});
  try{assert.match(root.download().output,/must hold exactly one market-regime-study\/results\.json/);}finally{root.cleanup();}
  const two=fixture({listing:{artifacts:[{id:1,name},{id:2,name:`design-acceptance-${'a'.repeat(40)}`}]}});
  try{const refused=two.download({ARTIFACT_ID:''});assert.notEqual(refused.status,0);assert.match(refused.output,/has 2 design-acceptance-<sha> artifacts; pass artifact_id/);}finally{two.cleanup();}
  const none=fixture({listing:{artifacts:others}});
  try{const refused=none.download({ARTIFACT_ID:''});assert.notEqual(refused.status,0);assert.match(refused.output,/has 0 design-acceptance-<sha> artifacts; pass artifact_id/);}finally{none.cleanup();}
});
