// Short paraphrases and bibliographic locators only. These are the supplied PDF
// editions, not print folios or current provider rules. The order of files is
// distinct from the application's historic minervini/minervini2 mode names.
export const BOOK_SOURCES = Object.freeze([
  Object.freeze({ id:'champion', title:'株式トレード 基本と原則', englishTitle:'Think & Trade Like a Champion', author:'Mark Minervini', pdfFile:'book1.pdf', printedPage:null }),
  Object.freeze({ id:'wizard', title:'ミネルヴィニの成長株投資法', englishTitle:'Trade Like a Stock Market Wizard', author:'Mark Minervini', pdfFile:'book2.pdf', printedPage:null }),
  Object.freeze({ id:'masters', title:'成長株投資の神', englishTitle:'Momentum Masters', author:'Mark Minervini / David Ryan / Dan Zanger / Mark Ritchie II', pdfFile:'book3.pdf', printedPage:null }),
  Object.freeze({ id:'oneil', title:'オニールの相場師養成講座', englishTitle:'The Successful Investor', author:'William J. O’Neil', pdfFile:'book4.pdf', printedPage:null }),
]);
export const SOURCE_CONTEXT_VERSION = 'four-book-source-comparison-v1';
export const sourceBook = id => BOOK_SOURCES.find(book => book.id === id);
export const sourceForMethod = method => method === 'minervini' ? sourceBook('wizard') : method === 'minervini2' ? sourceBook('champion') : null;

export function entrySourceContext(method, modelZone, distance) {
  const model = `アプリの買い位置設定：ピボットから0〜${modelZone}%。`;
  const book = sourceForMethod(method);
  if (!book) return { state:'unverified', warning:false, model,
    detail:'この方式の許容幅はアプリ設定です。ミネルヴィニの目安を他方式へ一律に適用していません。オニールの5%は元の適切なピボットが基準で、この画面の検出値がその条件を満たすかは別途確認します（『オニールの相場師養成講座』PDF 147・212）。' };
  const measured = typeof distance === 'number' && Number.isFinite(distance);
  const state = !measured ? 'unknown' : distance < 0 ? 'waiting' : distance > 3 + 1e-9 ? 'beyond' : distance > 2 + 1e-9 ? 'edge' : 'near';
  const citation = book.id === 'champion' ? 'PDF 245' : 'PDF 372–383';
  return { state, warning:state === 'beyond', model, bookId:book.id, bookTitle:book.title, citation, strength:'preference',
    label: state === 'beyond' ? '書籍の追随目安外' : state === 'edge' ? '書籍目安の上限付近' : state === 'near' ? '書籍の近接目安内' : state === 'waiting' ? 'ピボット到達待ち' : '書籍目安との比較は未確認',
    detail:`『${book.title}』はピボット近くでの購入を重視し、約2〜3%を超える追随を避ける目安です（${citation}）。2〜3%は目安で、3%を比較境界に使うのはアプリの解釈です。5%をこの書籍の追随許容幅とは扱いません。`,
  };
}

export function trendTemplateSourceContext(method) {
  const book = sourceForMethod(method);
  if (!book) return null;
  const threshold = book.id === 'champion' ? 25 : 30;
  const citation = book.id === 'champion' ? 'PDF 221–222' : 'PDF 151–152';
  return `『${book.title}』の8条件を確認（${citation}）。この版は52週安値より${threshold}%以上、52週高値から25%以内、RS順位70以上を含む一次選定で、購入判断とは別です。この画面の9件は近似判定8件と独自の日足品質確認1件です。200日線は1か月以上上向きが条件、4〜5か月やRS90台は好ましい特徴です。SMAの採用、1か月上向きを21営業日前との比較で判定すること、52週を252営業日とする窓、独自RSの計算・母集団はアプリの近似です。原典のRSとの同等性は未検証です。`;
}
