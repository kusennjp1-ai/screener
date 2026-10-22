import { instrumentApplicability, instrumentApplicabilityLabel } from '../instrumentApplicability';
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Paper, useMediaQuery } from '@mui/material';
import CandlestickChart from '../../components/Charts/CandlestickChart';
import { chartHistoryWarning, invalidChartHistory } from '../../components/Charts/researchChartModel';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';
import { entryReadiness } from '../entryReadiness';
import { assess, entryPlan } from '../researchEngine';
import { singleMissingCondition } from '../missingCondition';
import { money, signed, times, stateKey, STATES } from '../positionGeometry';
import './comparison.css';
import { EntrySourceBadge } from './EntrySourceNote';
import { verifiedVolumeRatio, hasVerifiedDailyBars } from '../qualificationAudit';
import { PIVOT_FOLLOW_SOURCE_TITLE } from '../bookSourceContext';

const Card = memo(function ComparisonCard({ item, date, generation, method, nearOnly, market, now, sessions, onSelect, paused }) {
  const { row } = item, ref = useRef(null), [visible, setVisible] = useState(false);
  const plan=useMemo(()=>item.plan || entryPlan(row,null,method),[item,row,method]);
  const descriptionId = useId(), smallScreen = useMediaQuery('(max-width:767px)');
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '0px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  const query = useQuery({ queryKey: [...staticChartKeys.payload(row.symbol, row.chart_path), generation], enabled: visible && !paused && Boolean(row.chart_path), staleTime: Infinity,
    queryFn: async () => { const data = await fetchStaticChartPayload(row.chart_path, { generation }); if (data.symbol !== row.symbol || data.as_of_date !== date) throw Error('Chart snapshot mismatch'); return data; } });
  const invalidIdentity = query.data && (query.data.symbol !== row.symbol || query.data.as_of_date !== date);
  const bars = invalidIdentity ? null : query.data?.bars, ready = entryReadiness(row, date, market, now ?? Date.now(), method);
  const invalidHistory = !hasVerifiedDailyBars(row, date) || (bars?.length && bars.at(-1).date !== date);
  // Compact comparison charts are daily-only. Use their actual final input
  // candle, not a possibly different quote or visible-range last candle.
  const finalCandle = !query.isError && !invalidHistory && !invalidChartHistory(bars) && bars?.length ? bars.at(-1) : null;
  const historyWarning = chartHistoryWarning(bars);
  const levelPrice = value => finalCandle && !historyWarning && Number.isFinite(value) && value > 0 ? money(value) : '—';
  const [stateLabel, mark, tone] = STATES[stateKey(plan.state)];
  const applicabilityLabel = item.assessment.financial_exclusion?.label || instrumentApplicabilityLabel(instrumentApplicability(row));
  const volume = verifiedVolumeRatio(row, date);
  const missing = nearOnly ? singleMissingCondition(assess(row, method, now)) : null;
  return <Paper ref={ref} component="article" variant="outlined" className="comparison-card" data-method={method} aria-label={`${row.symbol} 比較チャート`}>
    <button className="comparison-card-click" onClick={() => onSelect(row.symbol)} aria-label={`${row.symbol} を分析`} aria-describedby={descriptionId}><span className="sr-only">{row.symbol} を分析</span></button>
    <div className="comparison-heading"><h3>{row.symbol}</h3><span className="comparison-state-chip" style={{ color: `var(--${tone})` }} title={plan.state}>{mark} {stateLabel}</span><span className="comparison-distance">ピボット比 <b style={{ color: `var(--${tone})` }}>{signed(plan.distance)}</b></span></div>
    <div className="comparison-company"><span className="comparison-company-label" title={nearOnly ? `${row.company_name || ''} · ${missing?.csv || ''}` : row.company_name}>{nearOnly ? missing?.text || '判定資料を再確認' : row.company_name || '企業名未配信'}</span><EntrySourceBadge plan={plan}/><strong>{finalCandle ? <span data-testid="comparison-final-bar-legend" aria-label={`最終日足 ${finalCandle.date} 終値 ${money(finalCandle.close)}`}><span aria-hidden="true">⋯ </span>終値 {money(finalCandle.close)}</span> : money(row.current_price)}</strong></div>
    <div className="comparison-canvas" data-active-chart={!invalidHistory && visible && !paused && Boolean(bars?.length)}>
      {query.isError || invalidIdentity ? <Alert severity="warning">銘柄・日付の整合性または取得状態を確認できません。</Alert>
          : !row.chart_path ? <Alert severity="info">チャート未配信。買い形状は確認できません。</Alert>
            : query.isSuccess && !bars?.length ? <Alert severity="info">日足データが不足しています。買い形状は確認できません。</Alert>
        : invalidHistory ? <Alert severity="warning">日足を検証できません：{row.technical_audit?.errors?.[0] || (bars?.length && bars.at(-1).date !== date ? '最終日足が分析日と不一致' : '取引所営業日を含む現行の日足検証が未確認')}。現在の比較チャートには使用しません。</Alert>
              : visible && !paused && bars?.length ? <CandlestickChart key={row.symbol} symbol={row.symbol} priceData={bars} rsLineData={query.data.rs_line || []} rsRatingValue={row.rs_rating} compact researchView externalResearchLegend comparisonSessions={sessions} interactive={false} pivotPrice={plan.pivot} pivotLabel="共通ピボット" buyCeiling={plan.upper} stopPrice={plan.stopExample} height={smallScreen ? 240 : 220} />
                : <div className="comparison-skeleton" role="status" aria-label={`${row.symbol} チャートを読み込み中`}><span /><span /><span /></div>}
    </div>
    <dl className="comparison-metrics" role="group" aria-label="価格・RS・出来高の凡例"><div><dt><span className="comparison-level-line" aria-hidden="true"/>上限</dt><dd className="comparison-upper">{levelPrice(plan.upper)}</dd></div><div><dt><span className="comparison-level-line" aria-hidden="true"/>ピボット</dt><dd className="comparison-pivot">{levelPrice(plan.pivot)}</dd></div><div><dt><span className="comparison-level-line comparison-level-stop" aria-hidden="true"/>損切り例</dt><dd className="comparison-stop">{levelPrice(plan.stopExample)}</dd></div><div><dt><span className="comparison-rs-key" aria-label={query.data?.rs_line?.length ? 'RS線' : 'RS線未配信'}>{query.data?.rs_line?.length ? 'RS線' : 'RS—'}</span> / 出来高</dt><dd aria-label={`RS評価 ${Number.isFinite(row.rs_rating) ? row.rs_rating.toFixed(0) : '未確認'}、出来高比 ${times(volume)}`}>評{Number.isFinite(row.rs_rating) ? row.rs_rating.toFixed(0) : '—'} · {times(volume)}</dd></div><div><dt>購入条件</dt><dd>{ready.passed}/{ready.total}</dd></div></dl>
    {applicabilityLabel && <p>{applicabilityLabel}。価格・テクニカルは参考表示です。</p>}
    <p id={descriptionId} className="sr-only">{row.company_name}。価格位置：{plan.state}。ピボット比 {signed(plan.distance)}。共通ピボット {money(plan.pivot)}。アプリ上限 {money(plan.upper)}。{plan.sourceContext?.warning ? `書籍の追随目安外：『${PIVOT_FOLLOW_SOURCE_TITLE}』のピボット追随目安（約2〜3%）を超えています。` : ''}損切り例 {money(plan.stopExample)}。{applicabilityLabel || `選定 ${item.assessment.passed}/${item.assessment.total}`}。購入条件 {ready.passed}/{ready.total}、{ready.ready ? '日次条件通過' : `未達・未確認 ${ready.rules.filter(rule => rule.state !== 'pass').length}件`}。日次 {date}、{sessions}営業日。</p>
  </Paper>;
});

export default function CandidateCharts({ ordered, method, nearOnly=false, date, generation, market, now, onSelect, paused }) {
  const [page, setPage] = useState(0), [sessions, setSessions] = useState(63);
  const current = Math.min(page, Math.max(0, Math.ceil(ordered.length / 6) - 1));
  return <div className="candidate-comparison">
    <div className="comparison-controls"><label><span className="comparison-period-caption"><span>表示期間</span><span>日足バー日</span><time data-testid="comparison-final-bar-date" dateTime={date}>{date}</time></span><select aria-label="全チャートの期間" value={sessions} onChange={event => setSessions(Number(event.target.value))}><option value={21}>1か月</option><option value={63}>3か月</option><option value={126}>6か月</option><option value={252}>1年</option></select></label><span>日次 {date} · 縦軸は銘柄ごと · 帯＝買いゾーン · 破線＝損切り例</span>
      <div className="candidate-pagination"><Button aria-label="前の6銘柄" disabled={!current} onClick={() => setPage(current - 1)}>前へ</Button><span>{ordered.length ? current * 6 + 1 : 0}–{Math.min((current + 1) * 6, ordered.length)} / {ordered.length}</span><Button aria-label="次の6銘柄" disabled={(current + 1) * 6 >= ordered.length} onClick={() => setPage(current + 1)}>次へ</Button><a className="comparison-attribution" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a><a className="comparison-notice" href={`${import.meta.env.BASE_URL}lightweight-charts-NOTICE.txt`} target="_blank" rel="noopener noreferrer" aria-label="Lightweight Charts 著作権表記">NOTICE</a></div>
    </div>
    <div className="comparison-grid">{ordered.slice(current * 6, current * 6 + 6).map(item => <Card key={item.row.symbol} {...{ item, method, nearOnly, date, generation, market, now, sessions, onSelect, paused }} />)}</div>
    {!ordered.length && <p>条件に一致する銘柄はありません。</p>}
  </div>;
}
