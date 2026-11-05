import { signed } from '../positionGeometry';
import { code33Explain, code33Parts, fundamentalTiles, fundamentalsSource, quarterReason, secStatus } from '../fundamentalsExplain.js';

const finite = Number.isFinite;
/** The EPS footnote: in place on the card at 1024px and wider, in the stock screen's 注記 below that. */
export const EPS_NOTE = 'EPS は報告値（希薄化）で調整後EPSとは異なります。Q4 の売上・純利益が年度値でしか報告されていない場合は、年度値から3四半期を差し引いて算出し「Q4算出」と表示します。';

const shortPeriod = row => row.end.slice(2, 7);
const monthIndex = end => Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
/** Quarters as YY-MM periods; calendar-consecutive ones read as a range (24-09〜25-03). */
function periodList(rows, indices) {
  const runs = [];
  for (const i of indices) {
    const run = runs.at(-1);
    if (run && run[1] === i - 1 && monthIndex(rows[i].end) - monthIndex(rows[i - 1].end) === 3) run[1] = i; else runs.push([i, i]);
  }
  return runs.map(([a, b]) => a === b ? shortPeriod(rows[a]) : `${shortPeriod(rows[a])}〜${shortPeriod(rows[b])}`).join('・');
}
/** Why each grey bar has no value, as text: one line per reason (EPS and 売上 share a line when their quarters match). */
function quarterGaps(rows) {
  const lines = [];
  for (const [metric, key, name] of [['eps', 'epsYoY', 'EPS'], ['sales', 'salesYoY', '売上']]) {
    const byReason = new Map();
    rows.forEach((row, i) => { if (finite(row[key])) return; const reason = quarterReason(row, metric) || '比較できません'; byReason.set(reason, [...(byReason.get(reason) || []), i]); });
    for (const [reason, indices] of byReason) {
      const twin = lines.find(line => line.reason === reason && line.indices.join() === indices.join());
      if (twin) twin.names.push(name); else lines.push({ names: [name], reason, indices });
    }
  }
  return lines.sort((a, b) => a.indices[0] - b.indices[0]).map(line => `${line.names.join('・')} 前年比：${periodList(rows, line.indices)}期は${line.reason}`);
}
// A margin in at most four characters so each quarter's column stays readable at 12px on a 320px phone.
const marginShort = value => !finite(value) ? '—' : value.toFixed(Math.abs(value) >= 10 ? 0 : 1).replace('-', '−');

function QuarterBars({ rows }) {
  const known = rows.flatMap(r => [r.epsYoY, r.salesYoY]).filter(finite);
  if (!known.length) return null;
  // Growth above and below the base line share one scale; a fall is never cut off at the bottom.
  const up = Math.max(0, ...known), down = Math.max(0, ...known.map(v => -v)), span = Math.max(10, up + down), H = 120;
  const unit = (H - 8) / span, base = 4 + up * unit, W = rows.length * 48;
  const gaps = quarterGaps(rows), derived = rows.some(r => r.derived);
  return <>
    <svg className="brief-quarters" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`四半期の前年同期比成長率。直近 ${rows.at(-1).end}: EPS ${finite(rows.at(-1).epsYoY) ? signed(rows.at(-1).epsYoY, 0) : quarterReason(rows.at(-1), 'eps')}、売上 ${finite(rows.at(-1).salesYoY) ? signed(rows.at(-1).salesYoY, 0) : quarterReason(rows.at(-1), 'sales')}`}>
      <line x1="0" x2={W} y1={base} y2={base} className="q-base" />
      {rows.map((r, i) => {
        const cx = i * 48 + 24, period = `${r.end.slice(0, 7)}期`;
        const bar = (v, side, cls, metric, name) => finite(v)
          ? <rect className={`${cls} grow-y`} style={{ '--i': i }} x={cx + (side < 0 ? -15 : 1)} width="14" y={v >= 0 ? base - v * unit : base} height={Math.max(1, Math.abs(v) * unit)} rx="2"><title>{`${period} ${name} ${signed(v, 0)}`}</title></rect>
          : <rect className="q-unknown" x={cx + (side < 0 ? -15 : 1)} width="14" y={base >= 28 ? base - 24 : base} height="24" rx="2"><title>{`${period} ${name}：${quarterReason(r, metric)}`}</title></rect>;
        return <g key={r.end}>{bar(r.epsYoY, -1, 'q-eps', 'eps', 'EPS 前年比')}{bar(r.salesYoY, 1, 'q-sales', 'sales', '売上 前年比')}</g>;
      })}
    </svg>
    {/* Each quarter's period, margin and Q4 derivation as HTML under its bars (12px at every width). */}
    <div className="brief-q-axis" aria-hidden="true" style={{ '--n': rows.length }}>
      {rows.map(r => <span key={r.end}><span>{r.end.slice(2, 4)}年</span><span>{Number(r.end.slice(5, 7))}月</span><b>{marginShort(r.margin)}</b>{derived && <i>{r.derived ? '算出' : ''}</i>}</span>)}
    </div>
    <p className="brief-q-legend"><span><i className="q-key-eps" />EPS 前年比</span><span><i className="q-key-sales" />売上 前年比</span><span>下段＝純利益率(%)</span>{derived && <span>算出＝Q4を10-K年度値−3四半期で算出</span>}<span><i className="q-key-unknown" />灰色＝値なし{gaps.length ? '（理由は下記）' : ''}</span></p>
    {gaps.length > 0 && <ul className="brief-q-gaps" aria-label="値なしの理由">{gaps.map(text => <li key={text}>{text}</li>)}</ul>}
  </>;
}

const usd = value => !finite(value) ? '—' : Math.abs(value) >= 1e9 ? `$${(value / 1e9).toFixed(2)}B` : Math.abs(value) >= 1e6 ? `$${(value / 1e6).toFixed(1)}M` : `$${Math.round(value).toLocaleString('en-US')}`;

/** The quarters themselves when no year-over-year comparison exists yet (few quarters or no comparable base). */
function QuarterTable({ rows }) {
  return <table className="brief-qtable">
    <thead><tr><th scope="col">期</th><th scope="col">EPS</th><th scope="col">売上</th><th scope="col">純利益率</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.end}><th scope="row">{r.end.slice(0, 7)}{r.derived ? '（Q4算出）' : ''}</th><td>{finite(r.eps) ? r.eps.toFixed(2) : '—'}</td><td>{usd(r.revenue)}</td><td>{finite(r.margin) ? `${r.margin.toFixed(1)}%` : '—'}</td></tr>)}</tbody>
  </table>;
}

const noBaseOnly = rows => rows.every(r => [r.epsYoYReason, r.salesYoYReason].every(reason => !reason || ['no_base', 'ambiguous_base', 'not_reported'].includes(reason)));
const noYoYText = rows => noBaseOnly(rows) ? `前年同期の値がないため成長率は表示できません（${rows.length}期分のみ）。` : '前年同期と比較できないため（前年同期が赤字・ゼロ、期間の不一致など）成長率は表示できません。';

// Why a Yahoo quarterly rate is unknown, from financialHistory()'s reason.
const YAHOO_REASON = { no_quarter: '四半期の値なし', no_base: '前年同期の値なし', ambiguous_base: '前年同期を特定できず', nonpositive_base: '前年同期が赤字・ゼロ', not_reported: '未報告' };
/** Reference tiles from the current Yahoo quarterly statements, only when they passed financialHistory(). */
function yahooTiles(history) {
  const latest = history.quarterly.at(-1);
  const marginRow = [...history.quarterly].reverse().find(q => finite(q.revenue) && q.revenue > 0 && finite(q.netIncome));
  const period = row => row ? `参考・Yahoo ${row.end.slice(0, 7)}期` : '参考・Yahoo 値なし';
  const why = reason => reason === 'stale_quarter' ? `${period(latest)}は190日超のため比較しません` : `参考・Yahoo ${YAHOO_REASON[reason] || '前年同期と比較不可'}`;
  return [
    { label: 'EPS 前年比', value: finite(history.epsYoY) ? signed(history.epsYoY, 0) : null, short: '—', note: finite(history.epsYoY) ? period(latest) : why(history.epsYoYReason) },
    { label: '売上 前年比', value: finite(history.salesYoY) ? signed(history.salesYoY, 0) : null, short: '—', note: finite(history.salesYoY) ? period(latest) : why(history.salesYoYReason) },
    { label: '純利益率', value: marginRow ? `${(marginRow.netIncome / marginRow.revenue * 100).toFixed(1)}%` : null, short: '—', note: period(marginRow) },
  ];
}
const utcStamp = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString().slice(5, 16).replace('T', ' ') : null; };

function Code33Parts({ report, explained }) {
  const value = code33Parts(report);
  if (!value) return null;
  const label = { pass: ['zone', '達成'], fail: ['ext', '未達'] };
  return <>
    <ul className="brief-code33-parts" aria-label="Code 33 の3条件">{value.parts.map(([name, state]) => <li key={name} className={`tone-${label[state]?.[0] || 'neutral'}`}><span>{name}</span><b>{label[state]?.[1] || '未確認'}</b></li>)}</ul>
    {value.q4Eps && !explained && <p className="brief-note">第4四半期の EPS は年次報告（10-K）にしか無いため、EPS の加速は未確認です（年間値から差し引いて推計はしません）。</p>}
  </>;
}

/** The fundamentals card: SEC quarters first, the Yahoo reference only when SEC has none and it is current. */
export default function FundamentalsCard({ financial, wide }) {
  const report = financial?.report, code33 = financial?.code33, history = financial?.history;
  const sec = financial?.sec || secStatus(null, null);
  const rows = report?.rows?.slice(-8) || [];
  // SEC first; the Yahoo reference only when SEC has no quarters and its history is current.
  const yahoo = !rows.length && history?.valid && history.quarterly?.length ? yahooTiles(history) : null;
  const tiles = rows.length ? fundamentalTiles(report) : yahoo || ['EPS 前年比', '売上 前年比', '純利益率'].map(label => ({ label, value: null, short: '—', note: sec.short }));
  const stamp = utcStamp(financial?.historyRetrievedAt);
  const source = rows.length ? `${fundamentalsSource(report)}${tiles.some(t => t.derived) ? '・売上/純利益のQ4は10-K年度値−3四半期で算出' : ''}`
    : yahoo ? `出典：参考 Yahoo 四半期値（${stamp ? `取得 ${stamp} UTC・` : ''}提出日未確認）` : null;
  const explain = code33Explain(report, sec, code33);
  const tone = explain.state === 'pass' ? 'zone' : explain.state === 'fail' ? 'ext' : 'neutral';
  const yoyKnown = rows.some(r => finite(r.epsYoY) || finite(r.salesYoY));
  return <section className="brief-card in" style={{ '--i': 5 }} aria-labelledby="brief-fin-title" data-testid="brief-fundamentals">
    <div><h2 id="brief-fin-title">業績の加速</h2>{source && <p className="brief-note brief-fin-source">{source}</p>}</div>
    <div className="brief-facts is-fin">{tiles.map(t => <div className="brief-fact" key={t.label}><small>{t.label}</small><b>{t.value ?? t.short}</b><em>{t.note}</em></div>)}</div>
    {rows.length ? yoyKnown ? <QuarterBars rows={rows} /> : <><QuarterTable rows={rows} /><p className="brief-note">{noYoYText(rows)}</p></>
      : explain.kind !== 'no_sec' && <p className="brief-note">{sec.long}</p>}
    <div className={`brief-code33 tone-${tone}`}><span className="brief-code33-mark" aria-hidden="true">33</span><div><strong>{explain.title}</strong><p>{explain.text}</p></div></div>
    {code33?.source !== 'yahoo' && <Code33Parts report={report} explained={explain.kind === 'q4_eps'} />}
    {wide && <p className="brief-note">{EPS_NOTE}</p>}
  </section>;
}

/** The 13F card: how many managers reported the stock each quarter. */
export function InstitutionalCard({ institutional }) {
  const observations = institutional?.observations || [];
  const max = Math.max(1, ...observations.map(o => o.manager_count).filter(finite));
  return <section className="brief-card in" style={{ '--i': 6 }} aria-labelledby="brief-13f-title">
    <h2 id="brief-13f-title">機関の保有（13F）</h2>
    {observations.length ? <div className="brief-bars">{observations.map((o, i) => <div key={o.period} className={i === observations.length - 1 ? 'is-current' : ''}><span>{o.period}</span><span className="grow-x" style={{ width: `${Math.round(o.manager_count / max * 100)}%`, '--i': i }} /><b>{finite(o.manager_count) ? o.manager_count.toLocaleString('ja-JP') : '—'}</b></div>)}</div> : <p className="brief-note">13F の集計値は未取得です。</p>}
    <p className="brief-note">{institutional?.growth?.reason ? `${institutional.growth.reason.replace(/。$/, '')}。` : ''}13F を報告した運用会社の数（四半期）で、日々の売買ではありません。報告日は買付日ではありません。</p>
  </section>;
}
