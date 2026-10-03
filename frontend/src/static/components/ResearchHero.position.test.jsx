import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ResearchHero from './ResearchHero';
import { entryPlan } from '../researchEngine';
import fixture from '../../../tools/fixtures/radar-207-2026-09-29.json';
vi.mock('./PortfolioDecision',()=>({default:()=>null}));
vi.mock('./SetupRadar',()=>({default:()=>null}));
vi.mock('../useWorkbench',()=>({useWorkbenchDetails:()=>({isLoading:true})}));
afterEach(cleanup);
it('keeps qualified and zone counts identical to full plans for real data and exclusions',()=>{
 const edges=[{current_price:104},{current_price:99},{current_price:106},{current_price:102,corporate_action:{cash_acquisition:true}},{current_price:102,price_activity:{lowRange:true}},{current_price:130},{current_price:102,unqualified:true}]
  .map((row,index)=>({row:{symbol:`EDGE${index}`,se_pivot_price:100,...row},assessment:{qualified:!row.unqualified}}));
 for(const ranked of [fixture.ranked,edges]) {
  const zone=ranked.filter(item=>item.assessment.qualified&&entryPlan(item.row,null,'minervini').state==='買いゾーン内').length;
  const qualified=ranked.filter(item=>item.assessment.qualified).length;
  const {container,unmount}=render(<ResearchHero rows={[]} ranked={ranked} date="2026-09-29" plan={{allocationCap:0,market:{label:'市場未確認'}}} workbench={{}} method="oneil"/>);
  expect(container.querySelector('h1')).toHaveTextContent(`選定候補は ${qualified.toLocaleString()} 銘柄。`);
  expect(container.querySelector('.zone-text')).toHaveTextContent(`${zone.toLocaleString()} 銘柄`);
  unmount();
 }
});
