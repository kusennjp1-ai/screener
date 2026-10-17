import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import EvidenceContext from './EvidenceContext';

it('compares supplied dates and versions without treating generation as a date', () => {
  render(<EvidenceContext date="2026-10-02" generation="g2" evidence={{as_of_date:'2026-10-01',generation:'g1'}} label="財務根拠" compareGeneration/>);
  const group = screen.getByRole('group', {name:'財務根拠の参照情報'});
  expect(group).toHaveTextContent('分析基準日 2026-10-02 ／ 画面の配信版 g2');
  expect(group).toHaveTextContent('財務根拠の対象日 2026-10-01 ／ 日付の対応 不一致');
  expect(group).toHaveTextContent('財務根拠の配信版 g1 ／ 配信版の対応 不一致');
});

it.each([undefined, {}, {as_of_date:'2026-02-30',generation:''}, {generated_at:'2026-10-02T12:00:00Z'}])('keeps absent or malformed observed metadata unknown: %j', evidence => {
  render(<EvidenceContext date="2026-10-02" generation="g2" evidence={evidence} label="財務根拠" compareGeneration/>);
  const group = screen.getByRole('group', {name:'財務根拠の参照情報'});
  expect(group).toHaveTextContent('財務根拠の対象日 未確認 ／ 日付の対応 未確認');
  expect(group).toHaveTextContent('財務根拠の配信版 未確認 ／ 配信版の対応 未確認');
  expect(group).not.toHaveTextContent('一致');
});

it('shows same-day version changes separately and does not infer a missing expected context', () => {
  const evidence = {as_of_date:'2026-10-02',generation:'g1'};
  const view = render(<EvidenceContext date="2026-10-02" generation="g2" evidence={evidence} label="財務根拠" compareGeneration/>);
  expect(screen.getByText(/財務根拠の対象日/)).toHaveTextContent('日付の対応 一致');
  expect(screen.getByText(/財務根拠の配信版/)).toHaveTextContent('配信版の対応 不一致');
  view.rerender(<EvidenceContext evidence={evidence} label="財務根拠" compareGeneration/>);
  expect(screen.getByText(/分析基準日/)).toHaveTextContent('分析基準日 未確認 ／ 画面の配信版 未確認');
  expect(screen.getByText(/財務根拠の対象日/)).toHaveTextContent('日付の対応 未確認');
});

it.each([
  [{as_of_date:'2026-10-02',generation:'b'.repeat(64)},'一致','不一致'],
  [{as_of_date:'2026-10-01',generation:'a'.repeat(64)},'不一致','一致'],
  [{},'未確認','未確認'],
])('collapses identifiers while keeping date and version correspondence visible: %j',(evidence,dateState,versionState)=>{
  const {container}=render(<EvidenceContext date="2026-10-02" generation={'a'.repeat(64)} evidence={evidence} label="財務根拠" compareGeneration compact/>);
  const context=screen.getByRole('group',{name:'財務根拠の参照情報'}),summary=screen.getByText('配信版・照合情報');
  const visible=context.querySelector(':scope > p'),disclosure=summary.closest('details');
  expect(visible).toHaveTextContent(`日付の対応 ${dateState}`);
  expect(visible).toHaveTextContent(`配信版の対応 ${versionState}`);
  expect(visible.closest('details')).toBeNull();
  expect(screen.getByText('配信版は画面と表示用データの対応を示します。提供元の版や取得日時とは別です。').closest('details')).toBeNull();
  expect(visible).not.toHaveTextContent('a'.repeat(64));
  expect(disclosure).not.toHaveAttribute('open');
  expect(disclosure).toHaveTextContent('a'.repeat(64));
  if(evidence.generation)expect(disclosure).toHaveTextContent(evidence.generation);
  for(let i=0;i<2;i++){
    fireEvent.click(summary);expect(disclosure).toHaveAttribute('open');
    fireEvent.click(summary);expect(disclosure).not.toHaveAttribute('open');
    expect(container.querySelector(':scope > div > p')).toBe(visible);
  }
});
