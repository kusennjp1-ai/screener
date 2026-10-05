import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import GlossaryLabel from '../components/common/GlossaryLabel';

describe('model indicator explanations', () => {
  it.each([
    ['pressure', '対象足の価格変化と出来高', '決算予定・財務条件・データ鮮度は別に確認'],
    ['buy_risk', '対象足の移動平均線からのATR乖離', '購入条件の通過を示すものではありません'],
    ['triple_barrel', '3つのテクニカル条件の組合せ', '購入条件は別に確認'],
    ['tpr', '文字評価と色は別に計算', 'Researchの8条件＋価格整合性や購入条件とは別'],
    ['exposure', '条件付きの資金配分上限', '実際の保有率や投入目標ではありません'],
    ['follow_through', '市場データの更新日ではありません', '自動増額や購入許可ではありません'],
  ])('keeps %s tooltip scoped to the observed model', async (term, meaning, boundary) => {
    renderWithProviders(<GlossaryLabel term={term}>{term}</GlossaryLabel>);
    fireEvent.mouseOver(screen.getByText(term));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(meaning);
    expect(tooltip).toHaveTextContent(boundary);
    expect(tooltip).not.toHaveTextContent(/買って良い位置|緑の期間のみ新規買い|最強の買いシグナル|段階的に投入|「買い再開」|A\/Bのみ買い候補|ステージ2の上昇トレンドにない/);
  });
});
