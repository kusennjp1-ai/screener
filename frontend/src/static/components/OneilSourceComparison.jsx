import { useEffect, useState } from 'react';
import { ONEIL_SOURCE_DIAGNOSTIC_SCOPE, oneilSourceDiagnostics } from '../oneilSourceDiagnostics';
import { BOOK_SOURCE_PAGE_NOTE } from '../bookSourceContext';
import { validClock } from '../evidenceTime';
import './oneilSourceComparison.css';

const stateLabel = { pass: '該当', fail: '未達', unknown: '未確認', not_applicable: '対象外' };
const text = value => typeof value === 'string' && value.trim() ? value : '未確認';
const number = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '未確認';
const percent = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '未確認';

function State({ value }) {
  return <strong className="oneil-source-state">{stateLabel[value] || '未確認'}</strong>;
}

function Metadata({ value }) {
  return <dl className="financial-evidence-metadata">
    <div><dt>対象期</dt><dd>{text(value.period)}</dd></div>
    <div><dt>提供元</dt><dd>{text(value.source)}</dd></div>
    <div><dt>取得</dt><dd>{text(value.observedAt)}</dd></div>
    <div><dt>単位</dt><dd>{text(value.unit)}</dd></div>
  </dl>;
}

function CurrentRule({ row }) {
  return <section className="oneil-source-card" aria-label="現行アプリ" data-state={row?.state || 'unknown'}>
    <h5>現行アプリ <State value={row?.state}/></h5>
    <p>{text(row?.condition)}</p><p className="oneil-source-value">{text(row?.actual)}</p>
    {row?.explanation && <p>{text(row.explanation)}</p>}
  </section>;
}

export default function OneilSourceComparison({ row, symbol, date, now, currentRows = [] }) {
  const [localNow, setLocalNow] = useState(now);
  const evaluatedAt = !validClock(now) ? now : validClock(localNow) ? Math.max(now, localNow) : now;
  const diagnostics = oneilSourceDiagnostics(row?.symbol === symbol ? row : null, { date, now: evaluatedAt });
  const next = diagnostics.nextCheckAt;
  // This clock refreshes only these diagnostics. App selection and financial
  // evidence keep their existing clocks and rules. next is already the first
  // invalid millisecond; do not add another millisecond or invent a new TTL.
  useEffect(() => {
    const wake = () => setLocalNow(Date.now());
    const visible = () => { if (document.visibilityState !== 'hidden') wake(); };
    const timer = next === null ? null : setTimeout(wake, Math.min(2147483647, Math.max(1, next - Date.now())));
    const check = setInterval(() => { if (Date.now() < localNow || (next !== null && Date.now() >= next)) wake(); }, 15000);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); clearInterval(check); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', visible); };
  }, [next, localNow]);
  const { annual, sales } = diagnostics;
  return <details className="research-disclosure oneil-source-comparison">
    <summary>原典との比較（診断のみ）</summary>
    <p>{ONEIL_SOURCE_DIAGNOSTIC_SCOPE}</p><p>{BOOK_SOURCE_PAGE_NOTE}</p>
    <p>診断の確認時刻：{validClock(evaluatedAt) ? new Date(evaluatedAt).toISOString() : '未確認'}</p>
    <p>診断の「該当」はこの欄の条件だけの結果です。現行アプリの選定条件や集計には加算しません。</p>
    <section aria-label="年次EPSの原典比較">
      <h4>年次EPS · PDF 197頁</h4>
      <div className="oneil-source-grid">
        <CurrentRule row={currentRows.find(item => item.id === 'annual_eps_growth_3y')}/>
        <section className="oneil-source-card" aria-label="原典の年次EPS条件" data-state={annual.state}>
          <h5>原典の該当条件 <State value={annual.state}/></h5>
          <p>3年CAGR 25%以上、かつ過去3年の各年増益</p>
          <p data-state={annual.cagr.state}>3年CAGR：<strong>{percent(annual.cagr.value)}</strong> · <State value={annual.cagr.state}/></p>
          <p data-state={annual.eachYear.state}>各年増益：<State value={annual.eachYear.state}/></p>
          {!!annual.eachYear.comparisons.length && <ul className="oneil-source-periods" aria-label="年次EPSの各年比較">{annual.eachYear.comparisons.map((comparison, index) =>
            <li key={index} data-state={comparison.state}><span>{text(comparison.from)} → {text(comparison.to)}</span><span>EPS {number(comparison.previous)} → {number(comparison.latest)} · 増益率 {percent(comparison.growth)} · <State value={comparison.state}/></span></li>)}</ul>}
          <p>{text(annual.explanation)}</p><Metadata value={annual}/>
          <p>{text(annual.limitations)}</p>
        </section>
      </div>
    </section>
    <section aria-label="売上の原典比較">
      <h4>売上 · PDF 66頁</h4>
      <div className="oneil-source-grid">
        <CurrentRule row={currentRows.find(item => item.id === 'sales_growth_yy')}/>
        <section className="oneil-source-card" aria-label="原典の売上条件" data-state={sales.state}>
          <h5>原典の該当条件 <State value={sales.state}/></h5>
          <p>最新四半期の売上YoY 25%以上、または直近3四半期の売上YoYが加速</p>
          <p data-state={sales.latest.state}>最新YoY：<strong>{percent(sales.latest.value)}</strong> · <State value={sales.latest.state}/></p>
          <p>{text(sales.latest.explanation)}</p><Metadata value={sales.latest}/>
          <p data-state={sales.acceleration.state}>3四半期のYoY加速：<State value={sales.acceleration.state}/></p>
          <p>{text(sales.acceleration.explanation)}</p><p>{text(sales.explanation)}</p>
        </section>
      </div>
    </section>
  </details>;
}
