import { render, screen } from '@testing-library/react';
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
