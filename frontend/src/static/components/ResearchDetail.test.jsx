import { render,screen,cleanup,within } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import ResearchDetail from './ResearchDetail';
vi.mock('./ResearchChart',()=>({default:()=> <div data-testid="research-chart"/>}));
afterEach(cleanup);
const props={method:'minervini',date:'2026-10-01',market:{cap:.5,label:'上昇'},now:Date.parse('2026-10-01T22:00:00Z'),watch:[],detail:{}};
const row={symbol:'MSM',company_name:'MSC Industrial Direct Co Inc',current_price:103.2,se_pivot_price:100};
it.each([103.2,112.7])('shows the first-book caution beside the company before the inline chart at %s',price=>{
 const {container}=render(<ResearchDetail {...props} selected={{...row,current_price:price}}/>);
 const header=container.querySelector('.research-symbol-head');
 const warning=within(header).getByRole('note',{name:/書籍の追随目安外/});
 expect(warning).toHaveTextContent('△ 書籍目安2〜3%超');
 expect(warning.closest('.symbol-context')).not.toBeNull();
 expect(within(header).getByText(row.company_name)).toHaveAttribute('title',row.company_name);
 expect(header.nextElementSibling).toBe(screen.getByTestId('research-chart'));
 // The full disclosure remains in the entry card after the chart.
 expect(screen.getByText('アプリ設定と書籍の確認範囲')).toBeInTheDocument();
 if(price>105)expect(warning).not.toHaveAttribute('aria-label',expect.stringContaining('アプリの範囲内'));
});
it.each([[103,'minervini'],[104,'minervini2'],[104,'oneil']])('does not add a first-book header warning at %s for %s',(price,method)=>{
 const {container}=render(<ResearchDetail {...props} method={method} selected={{...row,current_price:price}}/>);
 expect(within(container.querySelector('.research-symbol-head')).queryByRole('note')).not.toBeInTheDocument();
});
