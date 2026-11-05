import { signed } from '../positionGeometry';
import { Expander } from './briefPrimitives';
import { SELL_RULES } from './briefSell';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
// The desktop (1024px and wider) keeps this qualifier in place in full; a phone keeps a short one.
const SELL_INLINE = '保有中の判断材料です。複合警告は『株式トレード 基本と原則』の観点（出来高1.4倍はアプリの代理閾値）、それ以外のしきい値はこのアプリ独自（独自判定）です。売買の推奨ではありません。';
/** The sell card's sources, in the stock screen's 注記 below 1024px. */
export const SELL_NOTE = '売りのサインは保有中の判断材料です。複合警告は『株式トレード 基本と原則』の観点（出来高1.4倍はアプリの代理閾値）、それ以外のしきい値はこのアプリ独自（独自判定）です。売買の推奨ではありません。';

const SELL_STATE = { hit: ['!', 'サインあり'], clear: ['·', 'サインなし'], unknown: ['?', '未確認'], na: ['–', '対象外'] };

function SellChecks({ title, checks }) {
  return <>
    <h3 className="brief-subhead">{title}</h3>
    <ul className="brief-checks brief-sellchecks">{checks.map(check => <li key={check.key}>
      <span className={`brief-check is-sell-${check.state}`} aria-hidden="true">{SELL_STATE[check.state][0]}</span>
      <span>{check.label}<span className="sr-only">（{SELL_STATE[check.state][1]}）</span><em>{check.detail}</em></span>
    </li>)}</ul>
  </>;
}

/** The sell card: fired and unknown checks listed, the quiet ones folded on a phone. */
export default function SellCard({ sells, reason, wide }) {
  const groups = sells ? [['上昇の加速（強気での売り）', sells.strength], ['崩れ（弱気での売り）', sells.weakness]] : [];
  const loud = check => check.state === 'hit' || check.state === 'unknown';
  const shown = groups.map(([title, checks]) => [title, wide ? checks : checks.filter(loud)]).filter(([, checks]) => checks.length);
  const quiet = wide ? [] : groups.map(([title, checks]) => [title, checks.filter(check => !loud(check))]).filter(([, checks]) => checks.length);
  const count = state => quiet.flatMap(([, checks]) => checks).filter(check => check.state === state).length;
  return <section className="brief-card in" style={{ '--i': 8 }} aria-labelledby="brief-sell-title" data-testid="brief-sell">
    {/* The qualifier stays on the card at every width, next to any fired check; the 注記 keeps only the sources. */}
    <h2 id="brief-sell-title">売りのサイン<small>（直近{SELL_RULES.recentSessions}営業日・独自判定）</small></h2>
    {sells ? <>
      <p className="brief-note">{sells.advance ? `起点（直近1年の安値）${sells.advance.startDate} の ${price(sells.advance.low)} から ${signed(sells.advance.gainPct)}・${sells.advance.sessions}営業日。` : `起点（直近1年の安値）から +${SELL_RULES.advanceMinPercent}%以上・${SELL_RULES.advanceMinSessions}営業日以上の上昇局面ではないため、上昇の加速と起点以来の下落は判定しません。`}{sells.hits ? ` ${sells.hits}件のサインが出ています。` : [...sells.strength, ...sells.weakness].some(c => c.state === 'unknown') ? ' 出ているサインはありませんが、未確認の項目があります。' : ' いま出ているサインはありません。'}</p>
      {shown.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      {quiet.length > 0 && <Expander id="stock-sell-quiet" summary={[count('clear') ? `サインなし ${count('clear')}件` : null, count('na') ? `対象外 ${count('na')}件` : null].filter(Boolean).join('・')}>
        {quiet.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      </Expander>}
    </> : <p className="brief-note">{reason ? `日足を分析基準日の値として検証できないため、売りのサインは未確認です（${reason}）。` : '日足が60本未満のため、売りのサインは未確認です。'}</p>}
    <p className="brief-note" data-testid="brief-sell-qualifier">{wide ? SELL_INLINE : '保有中の判断材料です（独自判定）。売買の推奨ではありません。'}</p>
  </section>;
}
