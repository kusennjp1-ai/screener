// Paraphrases from selected readable pages of the first book only. Kindle
// counters identify the reviewed edition; they are not print page numbers.
// Only bibliographic locators are included in published assets.
export const FIRST_BOOK_SOURCE = {
  title: 'ミネルヴィニの成長株投資法',
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
