import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const frontend=resolve(process.env.SCREENER_FRONTEND||'../screener-schedule-fixture-fix/frontend');
const {withAuditFixture}=await import(pathToFileURL(resolve(frontend,'src/static/testAuditFixture.js')));
const {withFinancialProof}=await import(pathToFileURL(resolve(frontend,'src/static/testFinancialFixture.js')));
export const start=Date.parse('2026-10-03T12:00:00Z'),date='2026-10-02',deadline=start+60000;
const history=(symbol,retrieved_at,eps)=>({symbol,as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic diagnostic only',retrieved_at:new Date(retrieved_at).toISOString(),annual:eps.map((eps,index)=>({end:`${2022+index}-12-31`,eps}))});
export const makeRows=()=>[
  withFinancialProof(withAuditFixture({symbol:'AVT',company_name:'Synthetic AVT-like diagnostic only',market:'US',current_price:100,adv_usd:50000000,rs_rating:95,eps_growth_yy:30,sales_growth_yy:30,institutional_sponsors_increasing:true,institutional_evidence:{symbol:'AVT',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:'2026-08-31',observations:[{period:'2026-03-31',manager_count:100,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},{period:'2026-06-30',manager_count:110,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'}]},market_above_50dma:true,market_above_200dma:true,financial_history:history('AVT',start,[5,4,3,null])},date),start,date),
  withFinancialProof(withAuditFixture({symbol:'MRVI',company_name:'Synthetic unselected expiring history only',market:'US',current_price:100,adv_usd:50000000,financial_history:history('MRVI',deadline-72*3600000,[1,2,4,8])},date),start,date),
];
