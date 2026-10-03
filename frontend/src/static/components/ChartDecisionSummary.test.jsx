import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import ChartDecisionSummary from './ChartDecisionSummary';
describe('chart decision summary',()=>{
  it('handles missing date and evidence without inventing a passed condition',()=>{
    render(<ChartDecisionSummary row={{symbol:'EMPTY'}} />);
    expect(screen.getByText(/未達・未確認/)).toBeInTheDocument();
    expect(screen.queryByText(/日次の購入条件を確認済み/)).not.toBeInTheDocument();
  });
  it('uses the same 3 percent method limit and canonical pivot as the order view',()=>{
    render(<ChartDecisionSummary row={{symbol:'TEST',current_price:102,se_pivot_price:100}} method="minervini2" date="2026-09-25" />);
    expect(screen.getByText('$103.00')).toBeInTheDocument();
    expect(screen.getByText(/（3%）/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-25 日次終値/)).toBeInTheDocument();
  });
  it('keeps price, missing conditions and the full warning visible with one 44px evidence disclosure',()=>{
    const {container}=render(<ChartDecisionSummary row={{symbol:'SOURCE',current_price:104,se_pivot_price:100,setup_recalculation:{status:'calculated'}}} date="2026-10-01" />);
    const disclosure=container.querySelector('details'),summary=disclosure.querySelector('summary');
    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(summary).toHaveStyle({minHeight:'44px'});
    expect(summary).toHaveTextContent('書籍・水準・未達条件');
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getByText(/未達・未確認：/).closest('details')).toBeNull();
    expect(screen.getByText(/2026-10-01 日次終値/).closest('details')).toBeNull();
    expect(screen.getByRole('note').closest('details')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('アプリの範囲内ですが、第1冊の約2〜3%目安を超えています');
    for(let i=0;i<2;i++){
      fireEvent.click(summary);
      expect(disclosure).toHaveAttribute('open');
      expect(disclosure).toHaveTextContent('アプリ設定と書籍の確認範囲');
      expect(disclosure).toHaveTextContent('ベースの成立・売買の適否・全書籍条件の認定ではありません');
      expect(disclosure).toHaveTextContent('参考：表示価格の−7% $96.72');
      expect(disclosure).toHaveTextContent('検証済み日足でセットアップを再計算済み');
      expect(disclosure.querySelectorAll('li')).toHaveLength(3);
      fireEvent.click(summary);
      expect(disclosure).not.toHaveAttribute('open');
    }
  });
});
