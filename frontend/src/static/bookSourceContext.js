// Paraphrases from selected readable pages of the first book only. Kindle
// counters identify the reviewed edition; they are not print page numbers.
// Only bibliographic locators are included in published assets.
export const FIRST_BOOK_SOURCE = {
  title: 'ミネルヴィニの成長株投資法',
  trendTemplate: 'Kindle表示115/421',
  pivot: 'Kindle表示292/421',
  dryUp: 'Kindle表示296/421',
  breakout: 'Kindle表示300/421',
  financial: 'Kindle表示183/421',
};

export function entrySourceContext(method, modelZone, distance) {
  const model = `アプリの買い位置設定：ピボットから0〜${modelZone}%。`;
  if (method !== 'minervini') return { state:'unverified', warning:false, model,
    detail: method === 'minervini2' ? '第2方式の3%は既存アプリ設定です。今回確認した第1冊の資料を、第2冊の数値指定の根拠にはしていません。' : 'この方式の許容幅はアプリ設定です。第1冊の目安を他方式へ一律に適用していません。' };
  const measured = typeof distance === 'number' && Number.isFinite(distance);
  const state = !measured ? 'unknown' : distance < 0 ? 'waiting' : distance > 3 + 1e-9 ? 'beyond' : distance > 2 + 1e-9 ? 'edge' : 'near';
  return { state, warning:state === 'beyond', model,
    label: state === 'beyond' ? '書籍の追随目安外' : state === 'edge' ? '書籍目安の上限付近' : state === 'near' ? '書籍の近接目安内' : state === 'waiting' ? 'ピボット到達待ち' : '書籍目安との比較は未確認',
    detail: `第1冊はピボット近くでの購入を重視し、約2〜3%を超える追随を避ける目安です。5%はこの資料で裏付けられた書籍指定ではありません。${FIRST_BOOK_SOURCE.pivot}。2〜3%は目安で、3%を比較境界に使うのはアプリの解釈です。`,
  };
}

// Confirmed first-book criteria do not establish equivalence of our data,
// exact slope test or local-universe RS estimate to the original method.
export function trendTemplateSourceContext(method) {
  const approximation = 'SMAの採用、1か月上向きを21営業日前との比較で判定すること、52週を252営業日とする窓、独自RSの計算・母集団はアプリの近似です。原典のRSとの同等性は未検証です。';
  if (method === 'minervini') return `『${FIRST_BOOK_SOURCE.title}』の8条件を確認（${FIRST_BOOK_SOURCE.trendTemplate}）。原典は52週安値より30%以上、52週高値から25%以内、RS順位70以上を含む一次選定で、購入判断とは別です。この画面の9件は近似判定8件と独自の日足品質確認1件です。${approximation}`;
  if (method === 'minervini2') return `第2方式の安値比25%は既存アプリ設定です。今回確認した第1冊の正式な8条件は30%以上で、第2冊の25%指定は未確認です。${approximation}`;
  return null;
}
