import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promotionInputs} from './export-source-promotion-inputs.mjs';
import {encodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'promotion-inputs-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const row={symbol:'AAA',market:'US',exchange:'XNYS',current_price:12.5,adv_usd:30000000,chart_path:'charts/AAA.json'};
  const index={as_of_date:'2026-10-05',rows:[row]};
  const writeIndex=()=>writeFileSync(join(root,'research.json'),JSON.stringify(encodeResearchIndex(index)));
  const manifest={markets:{US:{as_of_date:'2026-10-05',assets:{research:{path:'research.json'}}}}};
  writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest));
  mkdirSync(join(root,'charts'));writeFileSync(join(root,'charts/AAA.json'),JSON.stringify({symbol:'AAA',as_of_date:'2026-10-05',bars:[{date:'2026-10-05',close:12.5}]}));
  writeIndex();return {root,row,index,writeIndex};
}
test('binds actual final research and chart close, not a freshness badge',t=>{
  const f=fixture(t),result=promotionInputs(f.root);
  assert.equal(result.rows[0].chart_close,12.5);assert.equal(result.rows[0].chart_last_date,'2026-10-05');assert.equal(result.manifest_sha256.length,64);
});
test('missing chart remains explicit and cannot shrink rows',t=>{
  const f=fixture(t);delete f.row.chart_path;f.writeIndex();const result=promotionInputs(f.root);
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].chart_close,null);
});
test('mismatching dates and chart identity fail',t=>{
  const f=fixture(t);f.index.as_of_date='2026-10-02';f.writeIndex();assert.throws(()=>promotionInputs(f.root),/session mismatch/);
  f.index.as_of_date='2026-10-05';f.writeIndex();writeFileSync(join(f.root,'charts/AAA.json'),JSON.stringify({symbol:'BBB'}));assert.throws(()=>promotionInputs(f.root),/identity/);
});
test('path traversal and links cannot become downstream proof',t=>{
  const f=fixture(t);f.row.chart_path='../secret';f.writeIndex();assert.throws(()=>promotionInputs(f.root),/Unsafe/);
  f.row.chart_path='linked.json';f.writeIndex();symlinkSync(join(f.root,'charts/AAA.json'),join(f.root,'linked.json'));assert.throws(()=>promotionInputs(f.root),/Linked/);
});
