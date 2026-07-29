// 市場名の日本語表記 — 静的サイト全体で唯一の出どころ。
//
// マニフェストの display_name はバックエンド由来の英語（"United States"）。
// 日本語画面に英語の国名が出るのを避けるため、市場コードから日本語名に
// 置き換える。未知のコードのときだけ元の表記に戻す。
//
// 見出し・市場セレクター・空状態の説明文がそれぞれ別の変換を持っていると、
// 同じ画面で「米国」と "United States" が同時に出る。この 1 ファイルを
// 経由しない市場名の表示は作らないこと。
export const MARKET_NAMES_JA = {
  US: '米国',
  HK: '香港',
  IN: 'インド',
  JP: '日本',
  KR: '韓国',
  TW: '台湾',
  CN: '中国',
  DE: 'ドイツ',
  CA: 'カナダ',
  SG: 'シンガポール',
  MY: 'マレーシア',
  AU: 'オーストラリア',
};

// 市場コード（'US'）だけを受け取る版。マニフェストの entry が無い場所用。
export function marketNameJa(code, fallback = '') {
  const key = String(code || '').toUpperCase();
  return MARKET_NAMES_JA[key] || fallback || key || '';
}

// マニフェストの market entry（{market, display_name}）を受け取る版。
export function marketDisplayNameJa(marketEntry) {
  return marketNameJa(marketEntry?.market, marketEntry?.display_name);
}
