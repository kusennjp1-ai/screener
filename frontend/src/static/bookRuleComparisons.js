import { bookAnnualEpsEvidence, bookAnnualEvidenceText, BOOK_ANNUAL_EPS_NOTE } from './bookAnnualEpsEvidence.js';
import { auditValues, verifiedVolumeRatio } from './qualificationAudit.js';
import { projectFinancialRow } from './financialCurrent.js';
import { instrumentApplicability, instrumentApplicabilityLabel } from './instrumentApplicability.js';
import { snapshotFreshness, threeStateAnd } from './researchEngine.js';
import { SOURCE_CONTEXT_VERSION, sourceBook, sourceForMethod } from './bookSourceContext.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const show = (value, unit = '%') => finite(value) ? `${value.toFixed(2)}${unit}` : '未確認';
const state = result => result === null ? 'unknown' : result ? 'pass' : 'fail';
const compare = (value, predicate) => finite(value) ? state(predicate(value)) : 'unknown';
const cite = (bookId, pages, question) => `${sourceBook(bookId).title} · PDF ${pages}${question ? ` · 問${question}` : ''}`;

// Read-only, bounded source comparisons. No object returned here can qualify a
// candidate or clear an entry/risk gate. All numeric passes concern the named
// comparison, never the whole source method or a completed/approved trade.
export function bookRuleComparisons(input, { date, now = Date.now(), method = 'minervini' } = {}) {
  const row = input || {};
  const identityKnown = typeof row.symbol === 'string' && row.symbol.trim().length > 0 && typeof row.market === 'string' && row.market.trim().length > 0;
  const applicability = instrumentApplicability(row);
  const age = snapshotFreshness(date, now);
  const dateBound = row.technical_audit?.as_of_date === date && (!Object.hasOwn(row, 'as_of_date') || row.as_of_date === date);
  const technicalReady = identityKnown && applicability.status === 'unverified' && dateBound && age.state === 'recent' && Number.isInteger(row.technical_audit?.bars) && row.technical_audit.bars >= 252;
  const values = technicalReady ? auditValues(row) : {};
  const low = finite(values.aboveLow) ? values.aboveLow : null;
  const ratio = technicalReady ? verifiedVolumeRatio(row, date) : null;
  const scope = row.financial_identity?.observed_scope;
  const scopeMatches = !scope || [['symbol',row.symbol],['market',row.market],['as_of_date',date]].every(([key,value]) => !Object.hasOwn(scope,key) || scope[key] === value);
  const financialContext = identityKnown && scopeMatches && age.state === 'recent' && (row.as_of_date ?? row.technical_audit?.as_of_date) === date && (!row.technical_audit?.as_of_date || row.technical_audit.as_of_date === date);
  const current = projectFinancialRow(row, { now, asOfDate:date });
  const salesProof = current.financial_current_state?.fields?.sales_growth_yy;
  const sales = financialContext && salesProof?.availability === 'current' && finite(current.sales_growth_yy) ? current.sales_growth_yy : null;
  const annualEvidence = bookAnnualEpsEvidence(row, { date, now });
  const annualState = annualEvidence.comparisonState, cagr = annualEvidence.cagr;
  const annualApp = annualEvidence.points.length === 4 && annualEvidence.points.every(point => finite(point.eps) && point.eps > 0) ? state(annualEvidence.comparisons.every(item => item.growth >= 25)) : 'unknown';
  const technicalReason = !identityKnown ? '銘柄・市場の識別情報が未確認' : applicability.status !== 'unverified' ? instrumentApplicabilityLabel(applicability) : !dateBound ? '銘柄・基準日の対応が未確認' : age.state !== 'recent' ? '日足の鮮度が未確認（未来・4暦日以上前・現在時刻不明など）' : !Object.keys(values).length ? '252本以上の同一銘柄・整合済み日足が未確認' : '日足監査済み。最新取引日の証明は購入条件で別途確認';
  const lowEvidence = `終値 / 直近252営業日の日中安値 − 1：${show(low)}。252営業日は52週のアプリ近似。${technicalReason}。`;
  const volumeEvidence = `当日出来高 / 当日を除く直前50営業日の平均：${show(ratio,'倍')}。当日除外はアプリの比較方式。${technicalReason}。出来高の数値比較だけで、実際の上放れや場中の確認完了を認定しません。`;
  const card = (id, bookId, title, strength, pages, details = {}) => ({ id, bookId, title, strength, author:sourceBook(bookId)?.author || 'アプリ',
    citation:bookId ? cite(bookId, pages, details.question) : null, state:'review', value:null, scope:'single_condition_comparison', ...details });
  const cards = [
    card('champion-low','champion','52週安値から25%以上','required','221–222',{state:compare(low, value=>value>=25),value:low,evidence:lowEvidence,
      explanation:'この版のトレンドテンプレートの1条件。高値から25%以内・RS70以上など残りの条件と、セットアップ・購入条件は別途必要。'}),
    card('champion-power-play','champion','パワープレーの限定例外','exception','294–295',{scope:'exception_not_evaluated',
      explanation:'8週間以内に100%以上上昇し、強い出来高と狭い保ち合いなどを確認する別経路。業績確認の例外を全銘柄へ広げない。10%以内の浅いベースでは段階的収縮の例外もある。現在の検出フラグだけでは認定しません。'}),
    card('wizard-low','wizard','52週安値から30%以上','required','151–152',{state:compare(low,value=>value>=30),value:low,evidence:lowEvidence,
      explanation:'『基本と原則』の25%とは版が異なる条件。200日線は1か月上向きが必要、4〜5か月やRS80〜90台は好みを強める特徴。独自RSを公式順位と同一視しません。'}),
    card('wizard-code33','wizard','コード33は加点材料','preference','277–279',{scope:'bonus_not_evaluated',
      explanation:'4四半期で3回連続改善。EPS・売上は前年比成長率、純利益率は水準を比較します。まれな強さの特徴で、全銘柄の必須条件ではありません。欠損を合格にしません。既存の業績連続性欄で測定項目を確認します。'}),
    card('masters-minervini-volume','masters','出来高：50日平均超','preference','145',{author:'Mark Minervini',question:'4.17',state:compare(ratio,value=>value>1),value:ratio,evidence:volumeEvidence,
      explanation:'本人は50日平均を上回る出来高を重視。50%増を全員共通の最低条件とはしていません。価格を先に確認して入る例外にも、別の条件があります。'}),
    card('masters-ryan-volume','masters','出来高：25%以上増加','personal_minimum','145',{author:'David Ryan',question:'4.17',state:compare(ratio,value=>value>=1.25),value:ratio,scope:'application_window_comparison',
      evidence:`${volumeEvidence}この回答では平均期間の指定がなく、50日窓はアプリの選択です。`,
      explanation:'最低1.25倍と、より好ましい2〜3倍を区別。50日窓での数値比較が通っても、原典の手法全体の充足ではありません。'}),
    card('masters-zanger-volume','masters','出来高：20日平均の1.5倍以上','personal_minimum','145–144',{author:'Dan Zanger',question:'4.17',state:'unknown',scope:'missing_required_window',
      explanation:'20日または30日を挙げ、本人は20日を使用。監査済みの20日比較値が未配信のため未確認です。50日比を代入しません。'}),
    card('masters-ritchie-volume','masters','出来高に一律の必須閾値を置かない','discretionary','144',{author:'Mark Ritchie II',question:'4.17',scope:'discretionary_review',
      explanation:'平均以上が望ましいものの、厳密な数値条件を設けない回答。閾値がないことや例外は、自動合格・購入可の意味ではありません。'}),
    card('oneil-sales','oneil','売上25%以上、または3四半期の成長加速','alternative','66',{state:finite(sales)&&sales>=25?'pass':'unknown',value:sales,scope:'latest_quarter_branch_only',
      evidence:finite(sales)?`最新の証明付き売上前年比：${show(sales)}。比較期 ${salesProof.comparable_period_end} → ${salesProof.period_end}。提供元 ${salesProof.source}。取得 ${salesProof.observed_at}。有効期限 ${salesProof.valid_until}。直近3四半期の成長加速の経路は未評価。`:'現在有効な売上前年比の証明が未確認。単期値や過去の表示値から3四半期の加速を推定しません。',
      explanation:'本書は最近の1期以上が25%以上、または直近3四半期の前年比成長率が加速する選択肢。ここでは最新1期の枝だけを比較。25%未満でも、代替経路が未確認なら書籍全体の不合格とはしません。付録AのAAIIによる機械的な単期25%条件は、本編より狭い実装です。現行アプリもこの単期条件を維持。'}),
    card('oneil-annual','oneil','毎年増益 ＋ 3年間の複利成長25%以上','required','197・202–203',{state:annualState,value:finite(cagr)?cagr:null,strictThresholdState:annualApp,
      evidence:bookAnnualEvidenceText(annualEvidence),
      explanation:`付録Aの年次2条件の比較です。各年の増益も必要で、CAGRだけでは途中の減益を隠せません。直近12か月EPSと最新年度EPSの比較は未評価。現行オニール方式の「各年25%以上」はこれより厳しいアプリ条件。実際の選定結果は「判定根拠」タブで確認します。研究画面では追加のAND条件として任意に選べます。${BOOK_ANNUAL_EPS_NOTE}`}),
    card('oneil-pivot','oneil','買い増しも元の適切なピボットが基準','required','147・162・212',{scope:'original_pivot_not_verified',state:'unknown',
      explanation:'初回・追加購入とも元の適切なピボットから5%以内。買い増しは上昇後に少額で行い、追加のたびに基準を上へずらしません。10週線への押し目は別セットアップ。アプリの現在の検出ピボットだけでは元の基準を証明できません。'}),
    card('app-volume',null,'上昇日かつ直前50日平均の1.4倍以上','app_policy',null,{state:state(threeStateAnd([finite(ratio)?ratio>=1.4:null,finite(values.change)?values.change>0:null])),value:finite(ratio)?ratio:null,
      evidence:`${volumeEvidence}終値の前日比：${show(values.change)}。`,explanation:'現行の購入条件で使う共通の代理閾値です。4人の一致した原典条件ではありません。'}),
  ];
  if (applicability.status !== 'unverified') for (const item of cards) {
    if (item.state !== 'review') { item.state = applicability.status === 'not_applicable' ? 'not_applicable' : 'unknown'; item.value = null; }
    if ('strictThresholdState' in item) item.strictThresholdState = item.state;
  }
  return { version:SOURCE_CONTEXT_VERSION, symbol:row.symbol, date, method, activeBookId:sourceForMethod(method)?.id || (method==='oneil'?'oneil':null), cards,
    technical:{state:Object.keys(values).length?'observed':'unknown',reason:technicalReason,ageDays:age.days},
    policy:'これらは条件ごとの書籍比較で、基本手法の全条件通過数・順位・購入可否を変更しません。研究画面の年次EPS追加条件を有効にした場合だけ、その数値比較の充足銘柄へ絞り込みます。未確認・例外・好みを合格に置き換えません。口座リスク0.25%／0.5%などの保守的なアプリ設定も維持し、書籍中の大きなリスク例へ引き上げません。損切り価格での約定は保証されません。',
    citationNote:'ページは提供PDFの1始まりの位置です。印刷ページは未確認。Momentum Mastersは元PDFのページ番号を使用。オニール本は2004年版の歴史的記述で、現在のIBD仕様を認定するものではありません。',
  };
}
