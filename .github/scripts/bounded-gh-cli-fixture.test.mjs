import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {boundedGhCliPrelude} from './fixtures/bounded-gh-cli.mjs';
const seed='https://api.github.com/repos/kusennjp1-ai/screener/actions/workflows/ci.yml/runs?branch=main&per_page=100';
const command=url=>['api',url,'--hostname','github.com','--include','--method','GET'];
function execute(args,body){
  return spawnSync(process.execPath,['-e','process.argv='+JSON.stringify(['node','fixture',...args])+';'+boundedGhCliPrelude+
    'process.stdout.write('+JSON.stringify(body)+');'],{encoding:'utf8',env:{NODE_NO_WARNINGS:'1'}});
}
test('bounded offline fixture exposes complete rows and exact next/last links',()=>{
  const rows=Array.from({length:101},(_,i)=>({id:i+1})),body=JSON.stringify([{workflow_runs:rows}]);
  const first=execute(command(seed),body);assert.equal(first.status,0,first.stderr);
  assert.match(first.stdout,/HTTP\/2 200 OK\r\nContent-Type: application\/json/);
  assert.match(first.stdout,/page=2>; rel="next"/);assert.equal(JSON.parse(first.stdout.split('\r\n\r\n')[1]).workflow_runs.length,100);
  const last=execute(command(seed+'&page=2'),body);assert.equal(last.status,0,last.stderr);
  assert.doesNotMatch(last.stdout,/Link:/);assert.deepEqual(JSON.parse(last.stdout.split('\r\n\r\n')[1]),{workflow_runs:[{id:101}],total_count:101});
});
test('bounded offline fixture rejects foreign routes, malformed commands, incomplete data and extra pages',()=>{
  for(const args of [command(seed.replace('api.github.com','evil.invalid')),command(seed.replace('kusennjp1-ai','foreign')),
    command(seed+'&page=0'),command(seed+'&page=2&page=3'),[...command(seed),'extra'],command(seed.replace('100','50'))])
    assert.notEqual(execute(args,JSON.stringify([{workflow_runs:[]}])).status,0);
  assert.notEqual(execute(command(seed),JSON.stringify([{total_count:3,workflow_runs:[{id:1}]}])).status,0);
  assert.notEqual(execute(command(seed+'&page=2'),JSON.stringify([{workflow_runs:[]}])).status,0);
});
test('bounded fixture leaves ordinary and pre-existing explicit quota transport literal',()=>{
  const ordinary=execute(['api','repos/kusennjp1-ai/screener'],JSON.stringify({id:1}));
  assert.equal(ordinary.status,0);assert.equal(ordinary.stdout,'{"id":1}');
  const quota=['api','--hostname','github.com','--method','GET','--include','rate_limit','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'];
  const raw='HTTP/2 403 Forbidden\r\nRetry-After: 15\r\n\r\n{}';
  const response=execute(quota,raw);assert.equal(response.status,0);assert.equal(response.stdout,raw);
});
