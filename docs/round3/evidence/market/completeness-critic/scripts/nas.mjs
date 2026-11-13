import { readFileSync, writeFileSync } from 'node:fs';
const W='/home/user/screener/.claude/worktrees/r3-market-audit/frontend/src/static/';
const { followThroughDay } = await import(W+'followThroughDay.js');
const d=JSON.parse(readFileSync(process.argv[2],'utf8'));
const out={};
const sma=(a,i,n)=>a.slice(i-n+1,i+1).reduce((s,b)=>s+b.close,0)/n;
for(const ix of d.indices){
  const all=ix.bars; const rows=[];
  for(let i=all.length-45;i<all.length;i++){
    const bars=all.slice(i-279,i+1), asOf=all[i].date;
    const ft=followThroughDay({symbol:ix.symbol,bars,asOfDate:asOf});
    const hi=Math.max(...all.slice(i-251,i+1).map(b=>b.close));
    rows.push({date:asOf,state:ft.available?ft.state:'NA:'+ft.reason,vs50:+((all[i].close/sma(all,i,50)-1)*100).toFixed(2),vs200:+((all[i].close/sma(all,i,200)-1)*100).toFixed(2),fromHigh:+((all[i].close/hi-1)*100).toFixed(2)});
  }
  out[ix.symbol]=rows;
}
writeFileSync(process.argv[3],JSON.stringify(out,null,1));
for(const s of Object.keys(out)) for(const r of out[s].slice(-22)) console.log(s,r.date,r.state,r.vs50,r.vs200,r.fromHigh);
