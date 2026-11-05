import { fixedMinus, signed } from '../positionGeometry';
import { code33Explain, code33Parts, fundamentalTiles, fundamentalsSource, quarterReason, secStatus } from '../fundamentalsExplain.js';
import { Expander } from './briefPrimitives';

const finite = Number.isFinite;
/** The EPS footnote: in place on the card at 1024px and wider, in the stock screen's 注記 below that. */
export const EPS_NOTE = 'EPS は報告値（希薄化）で調整後EPSとは異なります。Q4 の売上・純利益が年度値でしか報告されていない場合は、年度値から3四半期を差し引いて算出し「Q4算出」と表示します。'
  + '在庫・売掛金の注意は独自判定で、直近1〜2四半期の前年比の伸びが売上の伸びを20ポイント以上上回るときに表示します。';
// What the SEC quarters cannot tell (shown in the card's fold on phones, in place on the desktop).
const OUT_OF_SCOPE = '対象外：予想・サプライズ・予想修正・調整後EPS';
const CAUTION_POINTS = 20;

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
const marginShort = value => !finite(value) ? '—' : fixedMinus(value, Math.abs(value) >= 10 ? 0 : 1);
// A growth rate in at most four characters (+120, −35, >999, <−99). A loss-to-profit quarter says 黒字 and a
// profit-to-loss one 赤字: facts, not rates (an EPS rate below −100% only says the quarter is a loss).
const growthShort = (value, row, metric) => {
  if (metric === 'eps' && !finite(value) && row.epsYoYReason === 'nonpositive_base' && finite(row.eps) && row.eps > 0) return '黒字';
  if (!finite(value)) return '—';
  if (metric === 'eps' && finite(row.eps) && row.eps < 0) return '赤字';
  const rounded = Math.round(value);
  return rounded > 999 ? '>999' : rounded < -999 ? '<−99' : `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded)}`;
};

function QuarterBars({ rows, wide, notes = null }) {
  const known = rows.flatMap(r => [r.epsYoY, r.salesYoY]).filter(finite);
  if (!known.length) return null;
  // Growth above and below the base line share one scale; a fall is never cut off at the bottom.
  const up = Math.max(0, ...known), down = Math.max(0, ...known.map(v => -v)), span = Math.max(10, up + down), H = 120;
  const unit = (H - 8) / span, base = 4 + up * unit, W = rows.length * 48;
  const gaps = quarterGaps(rows), derived = rows.some(r => r.derived);
  const gapList = gaps.length > 0 && <ul className="brief-q-gaps" aria-label="値なしの理由">{gaps.map(text => <li key={text}>{text}</li>)}</ul>;
  // Each phrase of the summary's small text wraps as a whole (a 320px phone never breaks inside 「対象外」).
  const phrases = [`${gaps.length}件`, notes && '業績の質の根拠', '対象外の項目'].filter(Boolean);
  const summary = gaps.length ? <>値なしの理由<small>{phrases.map((text, i) => <span key={text}>{i ? '・' : ''}{text}</span>)}</small></> : notes ? '業績の質の根拠と対象外の項目' : '判定の対象外の項目';
  return <div className="brief-fin-chart">
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
    {/* Each quarter's period, EPS and sales growth, margin and Q4 derivation as HTML under its bars (12px at every width). */}
    <div className="brief-q-axis" aria-hidden="true" style={{ '--n': rows.length }}>
      {rows.map(r => {
        // Grey only for 値なし (—): 黒字 and 赤字 are known facts and keep the row's colour.
        const eps = growthShort(r.epsYoY, r, 'eps'), sales = growthShort(r.salesYoY, r, 'sales');
        return <span key={r.end}><span>{r.end.slice(2, 4)}年</span><span>{Number(r.end.slice(5, 7))}月</span>
          <span className={`q-eps-t${eps === '—' ? ' is-unknown' : ''}`}>{eps}</span><span className={`q-sales-t${sales === '—' ? ' is-unknown' : ''}`}>{sales}</span>
          <b>{marginShort(r.margin)}</b>{derived && <i>{r.derived ? '算出' : ''}</i>}</span>;
      })}
    </div>
    {wide ? <p className="brief-q-legend"><span><i className="q-key-eps" />EPS 前年比</span><span><i className="q-key-sales" />売上 前年比</span><span>棒の下＝前年比(%)・下段＝純利益率(%)</span>{derived && <span>算出＝Q4を10-K年度値−3四半期で算出</span>}<span><i className="q-key-unknown" />灰色＝値なし{gaps.length ? '（理由は下記）' : ''}</span></p>
      // A phone keeps the legend on one line; the Q4 derivation is already named by the source line.
      : <p className="brief-q-legend"><span><i className="q-key-eps" />EPS</span><span><i className="q-key-sales" />売上</span><span>前年比%・下段は純利益率%</span><span><i className="q-key-unknown" />値なし</span></p>}
    {wide ? <>{gapList}<p className="brief-note brief-fin-scope">{OUT_OF_SCOPE}</p></>
      : <Expander id="stock-fin-gaps" className="brief-fin-gaps" summary={summary}>
        {notes}{gapList}<p className="brief-note brief-fin-scope">{OUT_OF_SCOPE}</p>
      </Expander>}
  </div>;
}

const usd = value => {
  if (!finite(value)) return '—';
  const size = Math.abs(value), sign = value < 0 ? '−' : '';
  return `${sign}${size >= 1e9 ? `$${(size / 1e9).toFixed(2)}B` : size >= 1e6 ? `$${(size / 1e6).toFixed(1)}M` : `$${Math.round(size).toLocaleString('en-US')}`}`;
};

/** The quarters themselves when no year-over-year comparison exists yet (few quarters or no comparable base). */
function QuarterTable({ rows }) {
  return <table className="brief-qtable">
    <thead><tr><th scope="col">期</th><th scope="col">EPS</th><th scope="col">売上</th><th scope="col">純利益率</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.end}><th scope="row">{r.end.slice(0, 7)}{r.derived ? '（Q4算出）' : ''}</th><td>{finite(r.eps) ? fixedMinus(r.eps, 2) : '—'}</td><td>{usd(r.revenue)}</td><td>{finite(r.margin) ? `${fixedMinus(r.margin, 1)}%` : '—'}</td></tr>)}</tbody>
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
    { label: '純利益率', value: marginRow ? `${fixedMinus(marginRow.netIncome / marginRow.revenue * 100, 1)}%` : null, short: '—', note: period(marginRow) },
  ];
}
const utcStamp = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString().slice(5, 16).replace('T', ' ') : null; };

function Code33Parts({ report, explained, hidden }) {
  const value = code33Parts(report);
  if (!value) return null;
  const label = { pass: ['zone', '達成'], fail: ['ext', '未達'] };
  return <>
    {/* On a phone the parts are hidden only where the Code 33 text already names each one (or none is known). */}
    <ul className={`brief-code33-parts${hidden ? ' is-said' : ''}`} aria-label="Code 33 の3条件">{value.parts.map(([name, state]) => <li key={name} className={`tone-${label[state]?.[0] || 'neutral'}`}><span>{name}</span><b>{label[state]?.[1] || '未確認'}</b></li>)}</ul>
    {value.q4Eps && !explained && <p className="brief-note">第4四半期の EPS は年次報告（10-K）にしか無いため、EPS の加速は未確認です（年間値から差し引いて推計はしません）。</p>}
  </>;
}

// The two quarters behind each known 未達 (bookFinancialEvidence's settled), named by the series they compare.
const SETTLED = [['epsAcceleration', 'EPS 前年比'], ['salesAcceleration', '売上 前年比'], ['marginImprovement', '純利益率']];
const periodOf = end => `${end.slice(0, 7)}期`;
const epsText = value => fixedMinus(value, 2);
function settledText(report) {
  const sentences = SETTLED.filter(([key]) => report?.[key] === 'fail' && report.settled?.[key]).map(([key, name]) => {
    const { from, to } = report.settled[key], margin = key === 'marginImprovement';
    // Two rates that round alike keep one decimal, so the sentence never reads 「+30% → +30%と鈍化」.
    const digits = !margin && signed(from.value, 0) === signed(to.value, 0) && from.value !== to.value ? 1 : 0;
    const format = value => margin ? `${fixedMinus(value, 1)}%` : signed(value, digits);
    const quarter = report.rows?.find(row => row.end === to.end);
    if (key === 'epsAcceleration' && finite(quarter?.eps) && quarter.eps < 0) return `${name}が${periodOf(from.end)} ${format(from.value)} → ${periodOf(to.end)}は赤字（EPS ${epsText(quarter.eps)}）です。`;
    const change = to.value < from.value ? margin ? 'と下がっています' : 'と伸びが鈍化しています' : 'と横ばいです';
    return `${name}が${periodOf(from.end)} ${format(from.value)} → ${periodOf(to.end)} ${format(to.value)}${change}。`;
  });
  return sentences.length ? `未達の根拠：${sentences.join('')}` : null;
}

const quarterOf = end => `${end.slice(2, 7)}期`;
/**
 * Three-valued quality checks from the SEC quarters: never a pass from missing data, and never a record from a
 * loss. Each chip may carry `detail`, the visible words of what it compared (in the card's fold on a phone,
 * under the chips on the desktop); `title` repeats it for a pointer.
 */
function qualityChips(report) {
  const word = { pass: '達成', fail: '未達', unknown: '未確認' }, tone = { pass: 'zone', fail: 'ext', unknown: '' };
  const floors = report.epsFloor || {}, settled = count => floors[count]?.at25 && floors[count].at25 !== 'unknown';
  // Four quarters when that is known (達成 or 未達), else two, else four (未確認).
  const count = settled(4) ? 4 : settled(2) ? 2 : 4, levels = floors[count] || { at25: 'unknown', at20: 'unknown', below25: [] };
  const twenty = levels.at25 === 'fail' && levels.at20 === 'pass';
  const below = (levels.below25 || []).map(item => `${quarterOf(item.end)} ${signed(item.value, 0)}`).join('・');
  const floorDetail = levels.at25 === 'fail' ? `EPS前年比が25%未満の期：${below}${twenty ? `（20%以上は直近${count}期とも達成）` : ''}` : null;
  const chips = [{ text: `EPS前年比≥25%（直近${count}期）${word[levels.at25]}${twenty ? '（20%以上は達成）' : ''}`, tone: tone[levels.at25],
    title: floorDetail || `EPS前年比が直近${count}期すべて25%以上か${levels.at25 === 'unknown' ? '（前年比がそろう四半期が足りず未確認）' : ''}`, detail: floorDetail }];
  const annual = report.annual || [], latest = annual.at(-1), record = report.annualRecord || 'unknown';
  const loss = record === 'fail' && finite(latest?.value) && latest.value < 0;
  const annualDetail = record === 'unknown' || !latest ? null : loss ? `年間EPS：直近の年度（${periodOf(latest.end)}）は ${epsText(latest.value)} の赤字です（赤字の年度は最高と数えません）。`
    : `年間EPS：直近の年度（${periodOf(latest.end)}）の ${epsText(latest.value)} は、SEC 年次報告のある${annual.length}年度で${record === 'pass' ? '最高です' : '最高ではありません'}。`;
  chips.push({ text: loss ? '年間EPS 赤字' : `年間EPS最高 ${{ pass: '更新', fail: '未更新', unknown: '未確認' }[record]}`, tone: loss ? 'ext' : tone[record],
    title: record === 'unknown' ? '直近の年度を含む3年度分の SEC 年次報告がないため未確認' : `SEC年次報告のある${annual.length}年度で${record === 'pass' ? '最高' : loss ? '直近が赤字' : '最高ではありません'}`, detail: annualDetail });
  if (report.balanceCoverage > 0) {
    const recent = new Set(report.rows.slice(-2).map(row => row.end));
    const seen = new Set();
    for (const warning of [...(report.balanceWarnings || [])].reverse()) {
      if (!recent.has(warning.end) || seen.has(warning.metric) || !(warning.growth - warning.salesGrowth >= CAUTION_POINTS)) continue;
      seen.add(warning.metric);
      const name = warning.metric === 'inventoryYoY' ? '在庫' : '売掛金';
      const detail = `${name}の伸び：${quarterOf(warning.end)} 前年比 ${signed(warning.growth, 0)}、売上 ${signed(warning.salesGrowth, 0)}（${CAUTION_POINTS}ポイント以上の差で表示する独自判定）`;
      chips.push({ text: `${name}の伸び＞売上（${quarterOf(warning.end)}・独自判定）`, tone: 'wait', title: detail, detail });
    }
  }
  return chips;
}

// The one line a phone shows for a stock without SEC quarters: what is missing and why, then Code 33
// (「Code 33」 never breaks between its words).
function missingLine(sec, explain) {
  if (sec.state === 'detail_loading') return '業績：読み込み中…';
  const why = sec.delivery ? '配信側の問題' : sec.state === 'refused' ? '検証できず' : '';
  return `業績：${String(sec.short).replace(/\s+/g, '')}${why ? `（${why}）` : ''}・${explain.title.replace('Code 33', 'Code\u00a033')}`;
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
  const settled = explain.state === 'fail' && code33?.source !== 'yahoo' ? settledText(report) : null;
  const quality = rows.length ? qualityChips(report) : null;
  const details = quality?.map(chip => chip.detail).filter(Boolean) || [];
  const qualityNotes = details.length > 0 && <ul className="brief-q-gaps brief-fin-quality-notes" aria-label="業績の質の根拠">{details.map(text => <li key={text}>{text}</li>)}</ul>;
  const facts = <div className="brief-facts is-fin">{tiles.map(t => <div className="brief-fact" key={t.label}><small>{t.label}</small>
    {t.turnaround ? <><b>黒字転換</b><em>{`${t.turnaround.end.slice(0, 7)}期・前年 ${fixedMinus(t.turnaround.from, 2)} → ${fixedMinus(t.turnaround.to, 2)}`}</em></>
      : <><b>{t.value ?? t.short}</b><em>{t.note}</em></>}</div>)}</div>;
  const box = <div className={`brief-code33 tone-${tone}`}><span className="brief-code33-mark" aria-hidden="true">33</span><div><strong>{explain.title}</strong><p>{explain.text}</p>{settled && <p>{settled}</p>}</div></div>;
  // On a phone the parts are hidden where the Code 33 text names each one (達成, Q4 EPS, other) or none is known;
  // a 未達, and a known part beside 8期未満・欠け・古い, stay visible.
  const partStates = code33Parts(report)?.parts.map(([, state]) => state) || [];
  const said = ['pass', 'q4_eps', 'other'].includes(explain.kind) || partStates.every(state => state === 'unknown');
  const parts = code33?.source !== 'yahoo' && <Code33Parts report={report} explained={explain.kind === 'q4_eps'} hidden={!wide && explain.state !== 'fail' && said} />;
  const bars = rows.length && yoyKnown;
  const missing = !rows.length && !yahoo;
  return <section className="brief-card in brief-fin" style={{ '--i': 5 }} aria-labelledby="brief-fin-title" data-testid="brief-fundamentals">
    <div><h2 id="brief-fin-title">業績の加速</h2>{source && <p className="brief-note brief-fin-source">{source}</p>}</div>
    {missing && !wide
      // No SEC quarters and no current reference: one line on a phone, today's reasons in its fold.
      ? <Expander id="stock-fin-missing" className="brief-fin-missing" summary={missingLine(sec, explain)}>
        {facts}
        {explain.kind !== 'no_sec' && <p className="brief-note">{sec.long}</p>}
        {box}
      </Expander>
      : <>
        {facts}
        {quality && <ul className="brief-fin-quality" aria-label="業績の質（SEC XBRL）">{quality.map(chip => <li key={chip.text} className={`brief-chip${chip.tone ? ` tone-${chip.tone}` : ''}`} title={chip.title || undefined}>{chip.text}</li>)}</ul>}
        {/* What each quality chip compared: under the chips on the desktop (and beside a quarter table), in the bars' fold on a phone. */}
        {(wide || !bars) && qualityNotes}
        {rows.length ? yoyKnown ? <QuarterBars rows={rows} wide={wide} notes={wide ? null : qualityNotes || null} /> : <><QuarterTable rows={rows} /><p className="brief-note">{noYoYText(rows)}</p><p className="brief-note brief-fin-scope">{OUT_OF_SCOPE}</p></>
          : explain.kind !== 'no_sec' && <p className="brief-note">{sec.long}</p>}
        {box}
        {parts}
      </>}
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
