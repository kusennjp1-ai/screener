// Synthetic filed-quarter history. Never a production SEC observation.
export function syntheticBookFinancials() {
  const ends=['2024-03-31','2024-06-30','2024-09-30','2024-12-31','2025-03-31','2025-06-30','2025-09-30','2025-12-31'];
  const series=values=>ends.map((end,i)=>({end,start:`${end.slice(0,4)}-${['01','04','07','10'][i%4]}-01`,filed:new Date(Date.parse(end)+30*86400000).toISOString().slice(0,10),value:values[i],derived:false}));
  return {symbol:'TEST',as_of_date:'2026-02-01',status:'available',source:'https://data.sec.gov/synthetic-fixture',quarterly:{
    eps:series([1,1,1,1,1.1,1.2,1.4,1.8]),revenue:series([100,100,100,100,110,130,160,200]),netIncome:series([10,10,10,10,11,14.3,19.2,26]),
  },annualEps:[]};
}
