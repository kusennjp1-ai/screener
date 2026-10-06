import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const workflow=readFileSync(new URL('../workflows/financial-release-lifecycle-diagnostic.yml',import.meta.url),'utf8');
const trusted={
  source:[11307162746,27524165,'c4b07d50e357fb556fda62c419f0d549a1a7e62fd62dccd3a501d4d563939dbb'],
  certificate:[11307009412,3152346,'fbe0e5e2a8a683596acaa6a133c8e642215fde0e4f332449cc635feec3a11958'],
  predecessor:[11294926674,306512046,'7bb431dc9c730c5dd1b290c68d5b6e738d8ffc808578162ba2fbd7f28aaa246d'],
};
function runStep(name){
  const lines=workflow.split('\n'),start=lines.indexOf(`      - name: ${name}`);
  assert.ok(start>=0,`missing workflow step ${name}`);
  let end=lines.findIndex((line,index)=>index>start&&line.startsWith('      - '));if(end<0)end=lines.length;
  const block=lines.slice(start,end),at=block.indexOf('        run: |');assert.ok(at>=0);
  return block.slice(at+1).map(line=>{assert.ok(!line||line.startsWith('          '));return line.slice(10);}).join('\n');
}
const download=runStep('Download exact retained review inputs');
const verification=runStep('Verify archives and restore the original predecessor').match(/python - <<'PY'\n([\s\S]*?)\nPY(?:\n|$)/)?.[1];
assert.ok(verification);

// Execute the actual archive-verification loop for the small diagnostic only.
// Keep and report the original expected dictionary so all three trusted archive
// identities remain independently asserted without retaining 322 MB in a unit test.
const verifyDiagnostic=`import ast,json,sys
tree=ast.parse(sys.stdin.read());body=[];found=False
for node in tree.body:
 body.append(node)
 if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='expected' for t in node.targets):
  body.extend(ast.parse("all_expected=expected.copy(); expected={'diagnostic':expected['diagnostic']}").body)
 if isinstance(node,ast.For):
  found=True;break
assert found
body.extend(ast.parse("print(json.dumps({'expected':all_expected,'manifest':manifest}))").body)
exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),'workflow-verification','exec'))`;

test('verified capture values reach the real download and archive verification workflow without legacy diagnostic pins',t=>{
  const root=mkdtempSync(join(tmpdir(),'lifecycle-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin'),config=join(root,'.github/scripts/fixtures/financial-release-archive-capture.json');
  mkdirSync(bin);mkdirSync(join(root,'.github/scripts/fixtures'),{recursive:true});
  const bytes=Buffer.from('small independently hashed diagnostic archive test payload\n'),zip=join(root,'fixture.zip');writeFileSync(zip,bytes);
  const hash=createHash('sha256').update(bytes).digest('hex'),trace=join(root,'requests.jsonl'),output=join(root,'capture-output');
  const stub=join(bin,'gh');
  writeFileSync(stub,`#!${process.execPath}\nconst fs=require('node:fs'),crypto=require('node:crypto'),args=process.argv.slice(2);if(args.length!==2||args[0]!=='api')throw Error('unexpected fixture command');const endpoint=args[1];fs.appendFileSync(process.env.WORKFLOW_REQUEST_TRACE,JSON.stringify(endpoint)+'\\n');const bytes=fs.readFileSync(process.env.WORKFLOW_ZIP);if(endpoint.endsWith('/zip'))process.stdout.write(bytes);else process.stdout.write(JSON.stringify({id:Number(endpoint.split('/').at(-1)),expired:false,size_in_bytes:bytes.length,digest:'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex')}));`);chmodSync(stub,0o755);
  const env={PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:root,GITHUB_REPOSITORY:'fixture/repository',GITHUB_OUTPUT:output,WORKFLOW_REQUEST_TRACE:trace,WORKFLOW_ZIP:zip};
  const invoke=(command,args,extra={})=>spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:5000,...extra});
  const save=capture=>writeFileSync(config,JSON.stringify({schema_version:'unapproved-financial-lifecycle-capture-v1',capture}));
  for(const id of [61001337,71001731]){
    const capture={artifact_id:id,archive_bytes:bytes.length,archive_sha256:hash,ui_sha:'b'.repeat(40),ui_tree:'c'.repeat(40)};
    save(capture);writeFileSync(output,'');writeFileSync(trace,'');
    const admitted=invoke('bash',['-c',runStep('Require a verified unapproved capture binding')]);assert.equal(admitted.status,0,admitted.stderr);
    const admittedFields=Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>line.split('=')));
    const result=invoke('bash',['-c',download],{env:{...env,DIAGNOSTIC_ARTIFACT_ID:admittedFields.artifact_id}});assert.equal(result.status,0,result.stderr);
    const requests=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(requests,Object.values(trusted).map(([artifact])=>artifact).concat(id).flatMap(artifact=>[
      `repos/fixture/repository/actions/artifacts/${artifact}`,`repos/fixture/repository/actions/artifacts/${artifact}/zip`,
    ]));
    const verified=invoke('python3',['-c',verifyDiagnostic],{input:verification});assert.equal(verified.status,0,verified.stderr);
    const checked=JSON.parse(verified.stdout);assert.deepEqual(checked.expected,{...trusted,diagnostic:[id,bytes.length,hash]});
    assert.equal(checked.manifest.diagnostic_sha256,hash);assert.deepEqual(checked.manifest.captured_ui,{sha:capture.ui_sha,tree:capture.ui_tree});
    for(const [key,value]of [['artifact_id',id+1],['archive_bytes',bytes.length+1],['archive_sha256','0'.repeat(64)]]){
      save({...capture,[key]:value});const rejected=invoke('python3',['-c',verifyDiagnostic],{input:verification});assert.notEqual(rejected.status,0,`${key} drift passed the actual verification loop`);
    }
  }
  assert.match(workflow,/^          git fetch --no-tags origin \"\$CAPTURED_SHA\"$/m);
  assert.equal(workflow.includes('credential.helper'),false);
  assert.match(workflow,/DIAGNOSTIC_ARTIFACT_ID: \$\{\{ steps\.capture\.outputs\.artifact_id \}\}/);
  for(const legacy of ['11333869601','361892204','2df75f7c8e8f0b43b4ea36ddc5c79531c97407d67593cdcb75e6127aa2dce0f9','11328759405'])assert.equal(workflow.includes(legacy),false,`legacy diagnostic pin remains: ${legacy}`);
});
