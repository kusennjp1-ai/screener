// Independent re-evaluation of retained actual chart bytes through the existing
// published OHLCV validator. Input is JSONL from the bounded ZIP/TAR reader.
import {createInterface} from 'node:readline';
import {auditDailyBars} from '../../frontend/src/static/qualificationAudit.js';
const results=[];
for await(const line of createInterface({input:process.stdin})){
  const {row,chart,session}=JSON.parse(line),audit=auditDailyBars(row,chart,session);
  const last=chart?.bars?.at(-1);
  results.push({symbol:row.symbol,chart_present:!!chart,chart_as_of:chart?.as_of_date??null,
    last_date:last?.date??null,last_close:last?.close??null,scan_close:row.current_price,
    current_close:!!chart&&chart.symbol===row.symbol&&chart.as_of_date===session&&last?.date===session
      &&Number.isFinite(row.current_price)&&Number.isFinite(last?.close)
      &&Math.abs(row.current_price-last.close)<=Math.max(.02,row.current_price*.0001),
    technical_valid:audit.valid,bars:audit.bars,errors:audit.errors});
}
const reasons={};for(const row of results)for(const reason of row.errors)reasons[reason]=(reasons[reason]||0)+1;
console.log(JSON.stringify({required_count:results.length,current_close_count:results.filter(r=>r.current_close).length,
  technical_valid_count:results.filter(r=>r.technical_valid).length,reasons,results},null,2));
