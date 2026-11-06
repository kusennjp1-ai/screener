import { money, signed } from '../positionGeometry';
import { Expander } from './briefPrimitives';
import { SELL_RULES } from './briefSell';
import { shortDate } from './briefShared';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
// The desktop (1024px and wider) keeps this qualifier in place in full; a phone keeps a short one.
// The sources' closing sentences, shared by the desktop qualifier and the phone's 注記.
const SOURCES = '複合警告は『株式トレード 基本と原則』の観点（出来高1.4倍はアプリの代理閾値）、それ以外のしきい値はこのアプリ独自（独自判定）です。売買の推奨ではありません。';
const SELL_INLINE = `保有中の判断材料です。${SOURCES}`;
/** The sell card's sources, in the stock screen's 注記 below 1024px. */
export const SELL_NOTE = `売りのサインは保有中の判断材料です。上昇の加速は、ピボット比 +${SELL_RULES.climaxFromPivotPercent}%以上の買いゾーン超過でピボット上抜けから${SELL_RULES.climaxSessions}営業日以上の銘柄か、終値が50日線から +${SELL_RULES.climaxFrom50dPercent}%以上の銘柄でのみ判定し、50日線は割れた日の出来高で、ブレイク失敗は出来高${SELL_RULES.breakVolumeRatio}倍以上の上抜けから${SELL_RULES.failedBreakoutSessions}営業日以内のピボット割れで判定します。${SOURCES}`;

// A check that is not judged for this stock (its reason says why: 「…のため判定しません」) reads 判定せず, never 対象外,
// which the brief keeps for SEC, funds and unlisted watch symbols (CONTEXT.md).
const SELL_STATE = { hit: ['!', 'サインあり'], caution: ['△', '注意'], clear: ['·', 'サインなし'], unknown: ['?', '未確認'], na: ['–', '判定せず'] };

function SellChecks({ title, checks }) {
  return <>
    <h3 className="brief-subhead">{title}</h3>
    <ul className="brief-checks brief-sellchecks">{checks.map(check => <li key={check.key}>
      <span className={`brief-check is-sell-${check.state}`} aria-hidden="true">{SELL_STATE[check.state][0]}</span>
      <span>{check.label}<span className="sr-only">（{SELL_STATE[check.state][1]}）</span><em>{check.detail}</em></span>
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
  return parts.length ? `上昇の加速は判定せず（${parts.join('・')}）。` : `上昇の加速はピボット比 +${SELL_RULES.climaxFromPivotPercent}%以上でのみ判定します。`;
}

/**
 * The card's status after the notes: the hits, else a caution on the 50-day line, else unknown checks, else
 * the checks not judged (判定せず: never 「いま出ているサインはありません」 while one is not judged), else none.
 */
function statusLine(sells) {
  if (!sells) return '';
  const all = [...sells.strength, ...sells.weakness];
  if (sells.hits) return ` ${sells.hits}件のサインが出ています。`;
  if (all.some(c => c.state === 'caution')) return ' 50日線の下にあります（大商いの割れは未確認）。';
  if (all.some(c => c.state === 'unknown')) return ' 出ているサインはありませんが、未確認の項目があります。';
  const na = all.filter(c => c.state === 'na').length;
  return na ? ` 判定していない項目 ${na}件。` : ' いま出ているサインはありません。';
}

/** The sell card: fired, cautioned and unknown checks listed, the quiet ones folded on a phone. */
export default function SellCard({ sells, reason, wide }) {
  const groups = sells ? [['上昇の加速（強気での売り）', sells.strength], ['崩れ（弱気での売り）', sells.weakness]] : [];
  const loud = check => check.state === 'hit' || check.state === 'caution' || check.state === 'unknown';
  const shown = groups.map(([title, checks]) => [title, wide ? checks : checks.filter(loud)]).filter(([, checks]) => checks.length);
  const quiet = wide ? [] : groups.map(([title, checks]) => [title, checks.filter(check => !loud(check))]).filter(([, checks]) => checks.length);
  const count = state => quiet.flatMap(([, checks]) => checks).filter(check => check.state === state).length;
  const status = statusLine(sells);
  return <section className="brief-card in" style={{ '--i': 8 }} aria-labelledby="brief-sell-title" data-testid="brief-sell">
    {/* The qualifier stays on the card at every width, next to any fired check; the 注記 keeps only the sources. */}
    <h2 id="brief-sell-title">売りのサイン<small>（独自判定）</small></h2>
    {sells ? <>
      <p className="brief-note">{sells.advance ? `起点（直近1年の安値）${shortDate(sells.advance.startDate, sells.asOf)} の ${price(sells.advance.low)} から ${signed(sells.advance.gainPct)}・${sells.advance.sessions}営業日。` : `起点（直近1年の安値）から +${SELL_RULES.advanceMinPercent}%以上・${SELL_RULES.advanceMinSessions}営業日以上の上昇局面ではないため、起点以来の下落は判定しません。`}{strengthNote(sells)}{status}</p>
      {shown.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      {quiet.length > 0 && <Expander id="stock-sell-quiet" summary={[count('clear') ? `サインなし ${count('clear')}件` : null, count('na') ? `判定せず ${count('na')}件` : null].filter(Boolean).join('・')}>
        {quiet.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      </Expander>}
    </> : <p className="brief-note">{reason ? `日足を分析基準日の値として検証できないため、売りのサインは未確認です（${reason}）。` : '日足が60本未満のため、売りのサインは未確認です。'}</p>}
    <p className="brief-note" data-testid="brief-sell-qualifier">{wide ? SELL_INLINE : '保有中の判断材料です（保有未登録・独自判定）。売買の推奨ではありません。'}</p>
  </section>;
}
