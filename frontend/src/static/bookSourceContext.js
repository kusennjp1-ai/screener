// Paraphrases of the confirmed passages supplied for this review. Keep private
// source URLs, document IDs and original PDF content out of public assets.
export const BOOK_SOURCE_PAGE_NOTE = 'PDF頁はPDFの先頭を1と数えた頁番号で、紙面頁とは異なります。';
export const BOOK_SOURCE_SCOPE_NOTE = 'ここで示すのは確認済みの該当頁の要旨です。全文精読や全230規則の実装を意味しません。';
export const PIVOT_FOLLOW_SOURCE_TITLE = '株式トレード 基本と原則';

const growthTitle = 'ミネルヴィニの成長株投資法';
const oneilTitle = 'オニールの相場師養成講座';
const pivotSource = `『${PIVOT_FOLLOW_SOURCE_TITLE}』PDF 245頁`;

export function entryUseSourceContext() {
  return `${pivotSource}の約2〜3%はピボットからの追随幅です。『成長株投資の神』（Zanger）PDF 181頁の2〜3%は価格の損切り幅、『${oneilTitle}』PDF 147・212頁の2〜3%は買増しの間隔です。用途が異なるため、全冊共通の売買基準、口座資金に対するリスク率、VCPの収縮深度には置き換えません。`;
}

export function entrySourceContext(method, modelZone, distance) {
  const model = `アプリの買い位置設定：ピボットから0〜${modelZone}%。`;
  // Preserve the existing comparison states and warnings. A source correction
  // does not change the selected method's price gate or add a new comparison.
  if (method !== 'minervini') return { state:'unverified', warning:false, model,
    detail: method === 'minervini2' ? `${pivotSource}ではピボット追随幅の目安として約2〜3%を扱います。現在の3%上限はアプリ設定で、書籍の裁量判断と同一ではありません。` : `この方式の許容幅はアプリ設定です。${pivotSource}の約2〜3%という追随目安を、全方式共通の購入条件にはしていません。` };
  const measured = typeof distance === 'number' && Number.isFinite(distance);
  const state = !measured ? 'unknown' : distance < 0 ? 'waiting' : distance > 3 + 1e-9 ? 'beyond' : distance > 2 + 1e-9 ? 'edge' : 'near';
  return { state, warning:state === 'beyond', model,
    label: state === 'beyond' ? '書籍の追随目安外' : state === 'edge' ? '書籍目安の上限付近' : state === 'near' ? '書籍の近接目安内' : state === 'waiting' ? 'ピボット到達待ち' : '書籍目安との比較は未確認',
    detail: `比較参照は${pivotSource}のピボット追随幅、約2〜3%です。『${growthTitle}』方式の5%上限はアプリ設定で、この出典の指定値ではありません。3%を比較境界に使うこともアプリの解釈であり、他書の条件との同一性を認定しません。`,
  };
}

export function trendTemplateSourceContext(method) {
  const approximation = 'SMAの採用、1か月上向きを21営業日前との比較で判定すること、独自RSの計算・母集団はアプリの近似です。52週高値・安値は分析基準日から52暦週の範囲で計算し、別途252本以上の日足と取引所営業日との一致を確認します。原典の傾き・RSとの同等性は未検証です。';
  const current = 'この画面の9件は近似判定8件と独自の日足品質確認1件です。';
  if (method === 'minervini') return `『${growthTitle}』のトレンドテンプレート8条件を確認（PDF 151–152頁）。原典は52週安値より30%以上、52週高値から25%以内、RS順位70以上を含む一次選定で、購入判断とは別です。${current}${approximation}`;
  if (method === 'minervini2') return `『${PIVOT_FOLLOW_SOURCE_TITLE}』のトレンドテンプレート8条件を確認（PDF 221–222頁）。原典は52週安値より25%以上、52週高値から25%以内、RS順位70以上を含む一次選定で、購入判断とは別です。${current}${approximation}`;
  return null;
}

export function financialSourceContext(method) {
  if (method !== 'oneil') return null;
  return `『${oneilTitle}』PDF 197頁の年次利益条件は、年率複利25%以上と過去3年の各年増益です。現行アプリの「各年EPS成長率25%以上」はより厳しい独自条件で、原典と同一ではありません。PDF 66・197・202頁の売上条件は、前年同期比25%以上、または直近3四半期の前年同期比成長率の加速です。現行アプリは直近の前年同期比25%以上だけを判定する、より狭い独自条件です。年率複利や加速とのOR条件へ判定を切り替えたものではありません。`;
}
