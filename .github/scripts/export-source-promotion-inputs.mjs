// Run only after the complete downstream quality gate. This record does not
// authorize publication on its own; the controller revalidates the source and
// previous pointer/cohort before a conditional pointer update.
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function promotionInputs(root) {
  root=resolve(root);
  const read=path=>{
    if(typeof path!=='string'||isAbsolute(path)||path.split('/').some(x=>!x||x==='..'||x==='.'))throw Error('Unsafe downstream path');
    const full=resolve(root,path);if(relative(root,full).startsWith('..'))throw Error('Downstream path escaped root');
    let part=root;for(const name of path.split('/')){part=join(part,name);if(lstatSync(part).isSymbolicLink())throw Error('Linked downstream input');}
    return readFileSync(full);
  };
  const manifestBytes=read('manifest.json'),manifest=JSON.parse(manifestBytes),market=manifest.markets?.US;
  const indexBytes=read(market.assets.research.path),index=decodeResearchIndex(JSON.parse(indexBytes));
  if(index.as_of_date!==market.as_of_date)throw Error('Research/manifest session mismatch');
  const rows=index.rows.map(row=>{
    const chart=row.chart_path?JSON.parse(read(row.chart_path)):null;
    if(chart&&chart.symbol!==row.symbol)throw Error('Chart identity changed');
    const last=chart?.bars?.at(-1);
    return {symbol:row.symbol,market:row.market,exchange:row.exchange,as_of_date:row.as_of_date??index.as_of_date,
      current_price:row.current_price??null,adv_usd:row.adv_usd??null,
      chart_as_of:chart?.as_of_date??null,chart_last_date:last?.date??null,chart_close:last?.close??null};
  });
  return {schema_version:'daily-source-downstream-v1',as_of_date:index.as_of_date,
    manifest_sha256:hash(manifestBytes),research_sha256:hash(indexBytes),quality_passed:true,rows};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  if(process.argv.length!==4)throw Error('Expected static-data root and output path');
  writeFileSync(process.argv[3],JSON.stringify(promotionInputs(process.argv[2])));
}
