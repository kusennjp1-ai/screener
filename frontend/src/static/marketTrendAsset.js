const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

export function readMarketTrends(value,entry){
 if(value?.schema_version!=='market-trends-v1'||value.market!=='US'||value.as_of_date!==entry.as_of_date)throw Error('市場推移の基準日が一致しません。');
 for(const points of [value.breadth?.points,value.put_call?.points,...(value.indices||[]).map(index=>index.points)]){
  if(!Array.isArray(points)||points.some((point,i)=>!validDay(point?.date)||point.date>entry.as_of_date||(i>0&&point.date<=points[i-1].date)))throw Error('市場推移の取引日を確認できません。');
 }
 if(value.indices?.length!==2||value.indices[0]?.symbol!=='^GSPC'||value.indices[1]?.symbol!=='^IXIC')throw Error('指数を識別できません。');
 return value;
}
