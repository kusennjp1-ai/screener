import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {makeRows,start,deadline,date} from './synthetic-fixture.mjs';
const dist=resolve(process.argv[2]),out=resolve(process.argv[3]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=async(dir,prefix='')=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(async entry=>entry.isDirectory()?files(join(dir,entry.name),`${prefix}${entry.name}/`):[{path:`${prefix}${entry.name}`,sha256:sha(await readFile(join(dir,entry.name)))}]))).flat();
const ui=(await files(dist)).filter(item=>!item.path.startsWith('static-data/')&&item.path!=='publication.json'),rows=makeRows();
const second=structuredClone(rows[1]);second.symbol='BWLP';second.company_name='Synthetic second unrelated expiry';second.financial_current.s='BWLP';second.technical_audit.symbol='BWLP';second.financial_history.symbol='BWLP';second.financial_history.retrieved_at=new Date(deadline+1000-72*3600000).toISOString();rows.push(second);
rows[0].research_detail_path='research-details/AVT.json';
const payloads={'manifest.json':{generated_at:new Date(start).toISOString(),research_generation:'synthetic-diagnostic-v1',default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research-synthetic.json'}}}}},'research-synthetic.json':{as_of_date:date,rows},'research-details/AVT.json':rows[0]};
const source=[];
for(const [path,value] of Object.entries(payloads)){const dest=join(dist,'static-data',path);await mkdir(resolve(dest,'..'),{recursive:true});const bytes=JSON.stringify(value);await writeFile(dest,bytes);source.push({path,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});}
for(const item of ui)if(sha(await readFile(join(dist,item.path)))!==item.sha256)throw Error(`Unexpected production UI change: ${item.path}`);
await mkdir(out,{recursive:true});
await writeFile(join(out,'fixture-provenance.json'),JSON.stringify({label:'SYNTHETIC THREE-ROW DIAGNOSTIC, NOT AVT/MRVI MARKET EVIDENCE',publication_authority:false,source_timestamps_fixed:true,clock_anchor:start,unselected_inclusive_deadline:deadline,unselected_first_invalid:deadline+1,second_unselected_first_invalid:deadline+1001,expected_selection:{symbol:'AVT',method:'oneil',passed:7,total:8,failed:1,unknown:0},ui_inventory_before_fixture:ui,fixture_sources:source},null,2)+'\n');
