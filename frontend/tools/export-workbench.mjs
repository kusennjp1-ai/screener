import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync,gunzipSync } from 'node:zlib';
import { selectionSnapshot, compareSnapshots } from '../src/static/candidateHistory.js';
import { sectorStrength } from '../src/static/sectorStrength.js';
import { HISTORY_RETENTION_SESSIONS } from '../src/static/candidatePerformance.js';
import { exportCandidatePerformance } from './export-candidate-performance.mjs';
import { summarizeWorkbench } from '../src/static/workbenchSummary.js';
const hash = value => createHash('sha256').update(value).digest('hex');
export async function exportWorkbench({root, rows, manifest, entry, researchContent,now = Date.parse(manifest.generated_at)}) {
  const engineFiles=['researchEngine.js','qualificationAudit.js','financialHistory.js','financialCurrent.js','evidenceTime.js','institutionalEvidence.js','candidateHistory.js'];
  const ruleVersion=hash((await Promise.all([...engineFiles.map(f=>readFile(new URL(`../src/static/${f}`,import.meta.url),'utf8')),readFile(new URL('../contracts/static_financial_current_v1.json',import.meta.url),'utf8')])).map(s=>s.replace(/\r\n/g,'\n')).join('\n'));
  const meta={financial_evaluated_at:now,financial_semantics:'current_at_evaluation_not_historical_publication',as_of:entry.as_of_date,generated_at:manifest.generated_at,published_at:null,rule_version:ruleVersion,source_research_sha256:hash(researchContent),universe_members_sha256:hash(rows.map(r=>r.symbol).sort().join('\n'))};
  const snapshot=selectionSnapshot(rows,meta,now);
  const content=JSON.stringify(snapshot), snapshotId=hash(content);
  const directory=resolve(root,'candidate-history');await mkdir(directory,{recursive:true});
  const currentPath=`candidate-history/${entry.as_of_date}-${snapshotId.slice(0,16)}.json.gz`;
  const compressed=gzipSync(content);
  await writeFile(resolve(root,currentPath),compressed);
  let catalog={snapshots:[]};
  try {catalog=JSON.parse(await readFile(resolve(directory,'index.json'),'utf8'));} catch(e){if(e.code!=='ENOENT')throw e;}
  const history=[], published=[];
  const refs=catalog.snapshots.filter(s=>s.as_of<=entry.as_of_date).sort((a,b)=>a.as_of.localeCompare(b.as_of));
  if(new Set(refs.map(ref=>ref.as_of)).size!==refs.length)throw Error('Duplicate published candidate session');
  const previousDate=refs.filter(ref=>ref.as_of<entry.as_of_date).at(-1)?.as_of;
  for (const ref of refs) {
    if(!/^candidate-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?$/.test(ref.path)) throw Error('Invalid history path');
    const raw=await readFile(resolve(root,ref.path));
    if(hash(raw)!==ref.sha256) throw Error('Candidate history integrity failure');
    const value=JSON.parse(ref.path.endsWith('.gz')?gunzipSync(raw).toString('utf8'):raw.toString('utf8'));
    if(value.as_of!==ref.as_of) throw Error('Candidate history date mismatch');
    // Older comparisons need pass states, not every rule explanation. Keep the
    // full preceding snapshot only; a 126-session archive must not retain 126
    // copies of all detailed rule evidence in build memory.
    const retained=value.as_of===previousDate ? value : {...value,records:value.records.map(record=>({...record,methods:Object.fromEntries(Object.entries(record.methods).map(([method,result])=>[method,{state:result.state}]))}))};
    published.push({...retained,published_ref:ref});
    if(value.as_of<entry.as_of_date)history.push(retained);
  }
  history.sort((a,b)=>a.as_of.localeCompare(b.as_of));
  const previous=history.at(-1)||null;
  let prices=null;try{prices=JSON.parse(await readFile(resolve(root,'sector-prices.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  await exportCandidatePerformance({root,snapshots:published,rows,prices,entry,manifest,now});
  const result={schema_version:1,snapshot_id:snapshotId,...meta,universe_version:snapshot.universe_version,
    coverage:{total:rows.length,verified:rows.filter(r=>r.technical_audit?.valid).length},
    history:{previous_as_of:previous?.as_of||null,retained_sessions:history.length,limit:HISTORY_RETENTION_SESSIONS,reason:previous?null:'公開時に保存した判定履歴がまだありません。今回から記録します。'},
    changes:compareSnapshots(snapshot,previous,history),sectors:sectorStrength(rows,prices,entry.as_of_date,now),
    current_snapshot:{path:currentPath,sha256:hash(compressed),as_of:entry.as_of_date}};
  const serialized=JSON.stringify(result), digest=hash(serialized),path=`workbench-${digest.slice(0,16)}.json`;
  await writeFile(resolve(root,path),serialized);
  entry.assets.workbench={path,sha256:digest,as_of_date:entry.as_of_date,snapshot_id:snapshotId};
  // Keep the full workbench and its F3 observation references unchanged. The
  // overview only needs counts and sector evidence; details are read on demand.
  const summary=JSON.stringify(summarizeWorkbench(result,entry.assets.workbench));
  const summaryDigest=hash(summary),summaryPath=`workbench-summary-${summaryDigest.slice(0,16)}.json`;
  await writeFile(resolve(root,summaryPath),summary);
  entry.assets.workbench_summary={path:summaryPath,sha256:summaryDigest,as_of_date:entry.as_of_date,snapshot_id:snapshotId,source_research_sha256:meta.source_research_sha256};
  return result;
}
