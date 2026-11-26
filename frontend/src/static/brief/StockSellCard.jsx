import { formatPrice, money, signed } from '../positionGeometry';
import { Expander } from './briefPrimitives';
import { KeepDistance } from './BriefParts';
import { SELL_RULES, STOP_ROW_LABEL } from './briefSell';
import { shortDate } from './briefShared';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
// The desktop (1024px and wider) keeps this qualifier in place in full; a phone keeps a short one.
// The sources' closing sentences, shared by the desktop qualifier and the phone's 注記.
const SOURCES = '複合警告は『株式トレード 基本と原則』の観点（出来高1.4倍はアプリの代理閾値）、それ以外のしきい値はこのアプリ独自（独自判定）です。売買の推奨ではありません。';
const SELL_INLINE = `保有中の判断材料です。${SOURCES}`;
/** The sell card's sources, in the stock screen's 注記 below 1024px. */
export const SELL_NOTE = `売りのサインは保有中の判断材料です。上昇の加速は、ピボット比 +${SELL_RULES.climaxFromPivotPercent}%以上の買いゾーン超過でピボット上抜けから${SELL_RULES.climaxSessions}営業日以上の銘柄か、終値が50日線から +${SELL_RULES.climaxFrom50dPercent}%以上の銘柄でのみ判定し、50日線は割れた日の出来高で、ブレイク失敗は出来高${SELL_RULES.breakVolumeRatio}倍以上の上抜けから${SELL_RULES.failedBreakoutSessions}営業日以内のピボット割れで判定します。${SOURCES}`;

// A check that is not judged for this stock (its reason says why: 「…のため判定しません」) reads 判定なし (D9: one word for the
// state, in the rows, the fold's summary and the status sentence), never 対象外, which the brief keeps for SEC, funds and
// unlisted watch symbols (CONTEXT.md).
const SELL_STATE = { hit: ['!', 'サインあり'], caution: ['△', '注意'], clear: ['·', 'サインなし'], unknown: ['?', '未確認'], na: ['–', '判定なし'] };

function SellChecks({ title, checks }) {
  return <>
    <h3 className="brief-subhead">{title}</h3>
    <ul className="brief-checks brief-sellchecks">{checks.map(check => <li key={check.key}>
      <span className={`brief-check is-sell-${check.state}`} aria-hidden="true">{SELL_STATE[check.state][0]}</span>
      <span>{check.label}<span className="sr-only">（{SELL_STATE[check.state][1]}）</span><em><KeepDistance text={check.detail} /></em></span>
    </li>)}</ul>
  </>;
}

/** Where the strength checks start, or why they are not judged (the gate's own reason, in short). */
function strengthNote(sells) {
  const run = sells.run;
  if (run?.basis === 'ma50') return `上昇の加速は、50日線の上に出た ${shortDate(run.startDate, sells.asOf)} 以降（${run.sessions}営業日）で判定（50日線から ${signed(run.fromSma50)}・判定は +${SELL_RULES.climaxFrom50dPercent}%以上、独自判定）。`;
  if (run) return `上昇の加速は、ピボット ${money(run.pivot)} を上抜けた ${shortDate(run.startDate, sells.asOf)} 以降（${run.sessions}営業日）で判定（ピボット比 ${signed(run.distance)}・判定は +${SELL_RULES.climaxFromPivotPercent}%以上かつ上抜けから${SELL_RULES.climaxSessions}営業日以上、独自判定）。`;
  // One line on a phone: the gate's reason with the close against its 50-day line; the 注記 gives both bars.
  const why = sells.runShort, parts = [why?.reason, Number.isFinite(why?.fromSma50) ? `50日線から ${signed(why.fromSma50)}` : null].filter(Boolean);
  return parts.length ? `上昇の加速は判定なし（${parts.join('・')}）。` : `上昇の加速はピボット比 +${SELL_RULES.climaxFromPivotPercent}%以上でのみ判定します。`;
}

/**
 * The card's status after the notes: the hits, else a caution on the 50-day line, else unknown checks, else
 * the checks not judged (判定なし: never 「いま出ているサインはありません」 while one is not judged), else none. The counts are
 * the two sides' only. The stop row (BEH-1) is never contradicted: at 該当 or 未確認 its clause follows the sentence, and it
 * takes the place of 「いま出ているサインはありません。」 (USR-B3).
 */
function statusLine(sells) {
  if (!sells) return '';
  const all = [...sells.strength, ...sells.weakness];
  const na = all.filter(c => c.state === 'na').length;
  const line = sells.hits ? ` ${sells.hits}件のサインが出ています。`
    : all.some(c => c.state === 'caution') ? ' 50日線の下にあります（大商いの割れは未確認）。'
      : all.some(c => c.state === 'unknown') ? ' 出ているサインはありませんが、未確認の項目があります。'
        : na ? ` 判定なしの項目 ${na}件。` : ' いま出ているサインはありません。';
  const clause = STOP_CLAUSE[sells.stop?.state];
  if (!clause) return line;
  return line === ' いま出ているサインはありません。' ? ` ${clause}` : `${line}${clause}`;
}

// The stop row (BEH-1): its state in words, 該当 in bold --neg ink on one line and no ▲ (minors B4, A4); never one of the signs.
const STOP_WORD = { hit: '該当', clear: '該当なし', na: '判定なし', unknown: '未確認' };
const STOP_GLYPH = { hit: '!', clear: '·', na: '–', unknown: '?' };
const STOP_CLAUSE = { hit: '損切りの行：仮の損切りに到達しています（サインの件数には含めていません）。', unknown: '損切りの行は未確認です。' };
/** The sell card's stop row when its checks cannot be judged (no sells): 未確認, never 該当なし; the card's note says why. */
const STOP_UNKNOWN = { key: 'stop', label: STOP_ROW_LABEL, state: 'unknown', cause: 'noSells', detail: null, parts: null };

/**
 * The plan's own stop beside the provisional one when their printed strings differ (D8: another stop setting, the structural
 * stop, a four-digit pivot whose float product rounds the other way), each under its own name; null when they read the same.
 */
function planStopText(stop, plan) {
  if (stop.cause !== 'judged' || !plan || plan.blocked || !Number.isFinite(plan.stop) || formatPrice(plan.stop) === formatPrice(stop.level)) return null;
  return `計画の損切り ${money(plan.stop)}（${plan.stopSource === 'structural' ? '構造' : '設定'} −${plan.stopPercent.toFixed(1)}%）`;
}

function StopRow({ stop, plan }) {
  const own = planStopText(stop, plan);
  const detail = stop.parts ? [own ? `${stop.parts[0]}／${own}` : stop.parts[0], ...stop.parts.slice(1)].join('・') : stop.detail ? `（${stop.detail}）` : null;
  return <ul className="brief-checks brief-sellchecks brief-stoprow" data-testid="brief-sell-stop" data-state={stop.state}><li>
    <span className={`brief-check is-stop-${stop.state}`} aria-hidden="true">{STOP_GLYPH[stop.state]}</span>
    <span>{stop.label} <b className={`brief-stop-state${stop.state === 'hit' ? ' is-hit' : ''}`}>{STOP_WORD[stop.state]}</b>{detail ? <em>{detail}</em> : null}</span>
  </li></ul>;
}

/** The sell card: fired, cautioned and unknown checks listed, the quiet ones folded on a phone. */
export default function SellCard({ sells, reason, wide, plan = null }) {
  const groups = sells ? [['上昇の加速（強気での売り）', sells.strength], ['崩れ（弱気での売り）', sells.weakness]] : [];
  const loud = check => check.state === 'hit' || check.state === 'caution' || check.state === 'unknown';
  const shown = groups.map(([title, checks]) => [title, wide ? checks : checks.filter(loud)]).filter(([, checks]) => checks.length);
  const quiet = wide ? [] : groups.map(([title, checks]) => [title, checks.filter(check => !loud(check))]).filter(([, checks]) => checks.length);
  const count = state => quiet.flatMap(([, checks]) => checks).filter(check => check.state === state).length;
  const status = statusLine(sells);
  // The stop row: at >= 1024 always in place; on a phone a quiet one (判定なし, 該当なし) is the fold's first line, with a summary
  // segment of its own kept apart from the two counts (USR-m5), and a hit or an 未確認 stays outside the fold. The segment is the
  // short form 「損切り判定なし」 / 「損切り該当なし」: 「損切りの行 判定なし」 takes two lines at 375px (311px against 285px).
  const stop = sells ? sells.stop : STOP_UNKNOWN;
  const stopQuiet = Boolean(stop) && !wide && !loud(stop);
  const summary = [[count('clear') ? `サインなし ${count('clear')}件` : null, count('na') ? `判定なし ${count('na')}件` : null].filter(Boolean).join('・'),
    stopQuiet ? `損切り${STOP_WORD[stop.state]}` : null].filter(Boolean).join('／');
  return <section className="brief-card in" style={{ '--i': 8 }} aria-labelledby="brief-sell-title" data-testid="brief-sell">
    {/* The qualifier stays on the card at every width, next to any fired check; the 注記 keeps only the sources. */}
    <h2 id="brief-sell-title">売りのサイン<small>（独自判定）</small></h2>
    {sells ? <>
      <p className="brief-note">{sells.advance ? `起点（直近1年の安値）${shortDate(sells.advance.startDate, sells.asOf)} の ${price(sells.advance.low)} から ${signed(sells.advance.gainPct)}・${sells.advance.sessions}営業日。` : `起点（直近1年の安値）から +${SELL_RULES.advanceMinPercent}%以上・${SELL_RULES.advanceMinSessions}営業日以上の上昇局面ではないため、起点以来の下落は判定しません。`}<KeepDistance text={strengthNote(sells)} />{status}</p>
      {/* A failed breakout past its window (failedBreakoutContext, round 3 R5): neutral context outside the fold, never a check. */}
      {sells.failedContext ? <p className="brief-note" data-testid="brief-failed-context"><KeepDistance text={sells.failedContext.text} /></p> : null}
      {shown.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      {stop && !stopQuiet ? <StopRow stop={stop} plan={plan} /> : null}
      {(quiet.length > 0 || stopQuiet) && <Expander id="stock-sell-quiet" summary={summary}>
        {stopQuiet ? <StopRow stop={stop} plan={plan} /> : null}
        {quiet.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      </Expander>}
    </> : <>
      <p className="brief-note">{reason ? `日足を分析基準日の値として検証できないため、売りのサインは未確認です（${reason}）。` : '日足が60本未満のため、売りのサインは未確認です。'}</p>
      <StopRow stop={stop} plan={plan} />
    </>}
    <p className="brief-note" data-testid="brief-sell-qualifier">{wide ? SELL_INLINE : '保有中の判断材料です（保有未登録・独自判定）。売買の推奨ではありません。'}</p>
  </section>;
}
