import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import PortfolioDecision from './PortfolioDecision';
afterEach(cleanup);
const row = { symbol: 'LEAD', market: 'US', currency: 'USD', gics_sector: 'Technology', market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true, passes_template: true, rs_rating: 95, week_52_low_distance: 50, week_52_high_distance: 3, composite_rating: 95, eps_rating: 90, ibd_group_rank: 10, adv_usd: 50000000, current_price: 101, se_pivot_price: 100, se_pattern_confidence: 80 };
const now = Date.parse('2026-09-24T14:00:00Z');
const date = '2026-09-23';
// Synthetic supplied-plan presentation fixture, not a current allocation or
// evidence that uncertified financial ratings can qualify a stock.
const makePlan = () => ({
  date, capital:100000, market:{label:'合成テストの市場',cap:.5}, allocationCap:.25,
  decision:'候補あり・未達条件を確認', candidateCount:1, blockers:[],
  positions:[{symbol:'LEAD',sector:'Technology',dailyReady:false,buy:101,stop:93.93,target:121.2,pivot:100,shares:70,cost:7070,loss:494.9,weight:.0707}],
  readiness:[{symbol:'LEAD',ready:false,passed:1,total:3,rules:[
    {id:'position',label:'買い位置',state:'pass',detail:'合成テスト内の位置'},
    {id:'volume',label:'出来高',state:'fail',detail:'合成テスト内の未達'},
    {id:'financial',label:'選定条件',state:'unknown',detail:'現在の財務根拠は未確認'},
  ]}], dailyPositions:[], invested:7070,cash:92930,exposure:.0707,risk:494.9,executionExposure:0,executionCash:100000,
});

it('shows each failed and unknown condition alongside the conditional prices with no extra expansion', () => {
  const inspect = vi.fn(), plan = makePlan();
  render(<PortfolioDecision plan={plan} onInspect={inspect} />);
  expect(screen.getByRole('heading', { name: '候補あり・未達条件を確認' })).toBeInTheDocument();
  expect(screen.getByText(/現金100%/)).toBeInTheDocument();
  expect(screen.queryByText('条件成立時の目安')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /条件付きの配分/ }));
  const card = screen.getByRole('article', { name: 'LEAD' });
  expect(within(card).getByText('条件成立時の目安')).toBeVisible();
  expect(within(card).getByText('損切り例')).toBeVisible();
  for (const rule of plan.readiness[0].rules.filter(rule => rule.state !== 'pass')) {
    const condition = within(card).getByText(`${rule.state === 'fail' ? '×' : '?'} ${rule.label} · ${rule.state === 'fail' ? '未達' : '未確認'}`);
    expect(condition).toBeVisible();
    expect(condition.closest('details')).toBeNull();
  }
  expect(within(card).getByText(`購入条件 ${plan.readiness[0].passed}/${plan.readiness[0].total}`)).toBeVisible();
  fireEvent.click(within(card).getByRole('button', { name: 'LEAD の配分根拠を確認' }));
  expect(inspect).toHaveBeenCalledWith('LEAD');
});
it('does not read display-only amounts while the plan is closed and restores content on repeated opens', async () => {
  const plan=makePlan(), capital=vi.fn(()=>100000);
  Object.defineProperty(plan,'capital',{get:capital,enumerable:true});
  render(<PortfolioDecision plan={plan} compact/>);
  expect(capital).not.toHaveBeenCalled();
  const trigger=screen.getByRole('button',{name:/条件付きの配分/});
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog',{name:'配分の試算・未達条件'})).toBeVisible();
  expect(capital).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'配分の試算を閉じる'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const reads=capital.mock.calls.length;
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog',{name:'配分の試算・未達条件'})).toBeVisible();
  expect(screen.getByText(/新規資金\$100,000.00の未約定モデル/)).toBeVisible();
  expect(capital.mock.calls.length).toBeGreaterThan(reads);
});

it('separates all-pass amounts and risk from conditional rows without modifying allocation', () => {
  const plan = makePlan();
  const source = plan.positions[0];
  plan.positions = [{ ...source, symbol: 'READY', dailyReady: true }, { ...source, symbol: 'WAIT', dailyReady: false }];
  const names = ['選定条件', '市場環境', '最新の取引日', '買い位置', '出来高', 'ベース形状', '決算までの余裕', '将来追加する条件'];
  plan.readiness = [
    { symbol: 'READY', ready: true, total: names.length, rules: names.map((label, i) => ({ id: `r${i}`, label, state: 'pass', detail: '確認済み' })) },
    { symbol: 'WAIT', ready: false, total: names.length, rules: names.map((label, i) => ({ id: `r${i}`, label, state: i < 5 ? 'pass' : i === 5 ? 'fail' : 'unknown', detail: i === 5 ? 'nr7_inside_day' : '確認が必要' })) },
  ];
  plan.invested = source.cost * 2;
  plan.risk = source.loss * 2;
  const before = structuredClone(plan);
  render(<PortfolioDecision plan={plan} compact />);
  fireEvent.click(screen.getByRole('button', { name: /条件付きの配分/ }));
  const daily = screen.getByRole('region', { name: '日次条件をすべて通過' });
  expect(within(daily).getByRole('article', { name: 'READY' })).toBeVisible();
  expect(within(daily).queryByRole('article', { name: 'WAIT' })).toBeNull();
  const conditional = screen.getByRole('region', { name: '条件付き（未達あり）' });
  expect(within(conditional).getByText('購入条件 5/8')).toBeVisible();
  expect(within(conditional).getByText('未達 1 · 未確認 2')).toBeVisible();
  expect(within(conditional).getByText('× ベース形状 · 未達')).toBeVisible();
  expect(within(conditional).getByText('? 決算までの余裕 · 未確認')).toBeVisible();
  expect(within(conditional).getByText('? 将来追加する条件 · 未確認')).toBeVisible();
  expect(within(conditional).getByText('NR7・インサイドデイ')).toBeVisible();
  const totals = screen.getByRole('region', { name: '全条件成立時の試算' });
  const expectedCost = source.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const expectedRisk = source.loss.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  for (const name of ['日次条件通過', '条件付き']) {
    const totalRow = within(totals).getByRole('rowheader', { name, exact: true }).closest('tr');
    expect(within(totalRow).getByText(expectedCost)).toBeVisible();
    expect(within(totalRow).getByText(expectedRisk)).toBeVisible();
  }
  expect(plan).toEqual(before);
});

it('shows missing condition evidence instead of trusting an old all-pass flag', () => {
  const plan = makePlan();
  plan.positions[0].dailyReady = true;
  plan.readiness = [];
  render(<PortfolioDecision plan={plan} compact />);
  fireEvent.click(screen.getByRole('button', { name: /条件付きの配分/ }));
  const card = screen.getByRole('article', { name: 'LEAD' });
  expect(within(card).getByText('? 購入条件の内訳 · 未確認')).toBeVisible();
  expect(within(card).queryByText('✓ 日次条件通過')).toBeNull();
});

it('closes on Escape and returns focus to the opening button', async () => {
  const user = userEvent.setup();
  render(<PortfolioDecision plan={makePlan()} compact />);
  const trigger = screen.getByRole('button', { name: /条件付きの配分/ });
  await user.click(trigger);
  expect(screen.getByRole('dialog', { name: '配分の試算・未達条件' })).toBeVisible();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

it('supports a compact hero trigger without running a second universe scan', () => {
  const price = vi.fn(() => 101);
  render(<PortfolioDecision plan={makePlan()} rows={[{ ...row, get current_price() { return price(); } }]} compact renderTrigger={({ openPlan, label }) => <button onClick={openPlan}>{label}</button>} />);
  expect(price).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /条件付きの配分/ }));
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('does not fill cash with unqualified stocks when there are no candidates', () => {
  render(<PortfolioDecision rows={[{ ...row, passes_template: false }]} date={date} onInspect={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '配分の試算 0銘柄' }));
  expect(screen.getByText(/配分できる候補はありません/)).toBeVisible();
});

it('does not rescan the universe on a 15-second clock tick', () => {
  const price = vi.fn(() => 50);
  const rows = Array.from({ length: 1000 }, (_, i) => ({ symbol: `S${i}`, market: 'US', currency: 'USD', get current_price() { return price(); } }));
  const { rerender } = render(<PortfolioDecision rows={rows} date={date} now={now} />);
  price.mockClear();
  rerender(<PortfolioDecision rows={rows} date={date} now={now + 15000} />);
  expect(price).not.toHaveBeenCalled();
});
