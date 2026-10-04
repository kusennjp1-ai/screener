import { memo, useId, useState } from 'react';
import { money, signed, stateKey, STATES, times } from '../positionGeometry';
import './researchCandidateTable.css';

const METHOD_NAMES = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール', ibd: 'IBD型' };
const STATUS = { pass: '通過', fail: '未達', unknown: '未確認', reference: '参考' };
const statusLabel = state => STATUS[state] || STATUS.unknown;
const count = value => Number.isFinite(value) ? value : '未確認';
const metricRole = metric => typeof metric?.required === 'boolean' ? metric.required ? '必須' : '参考' : '役割 未確認';

function Status({ state, children }) {
  return <span className="research-table-status" data-state={STATUS[state] ? state : 'unknown'}>{children || statusLabel(state)}</span>;
}

function CompactGrowth({ metric }) {
  return <div className="research-table-growth" data-metric={metric?.id} data-state={metric?.state || 'unknown'}>
    <strong>{metric?.actual || '未確認'}</strong>
    <span className="research-table-metric-role">{metricRole(metric)} <Status state={metric?.state}/></span>
    <small>{metric?.condition || '選定条件の根拠待ち'}</small>
    {metric?.referenceActual && <small className="research-table-reference">参考計算：{metric.referenceActual}</small>}
  </div>;
}

function FinancialSource({ metric }) {
  return <div className="research-table-source" data-metric={metric.id}>
    <h4>{metric.label || metric.title} <span>{metricRole(metric)}</span></h4>
    <p><strong>{metric.actual || '未確認'}</strong> <Status state={metric.state}/></p>
    <p>{metric.condition || '選定条件の根拠待ち'}</p>
    <dl>
      <div><dt>対象期・比較期</dt><dd>{metric.period || '決算期 未確認'}</dd></div>
      <div><dt>提供元</dt><dd>{metric.source || '提供元 未確認'}</dd></div>
      <div><dt>取得時刻</dt><dd>{metric.observedAt || '取得時刻 未確認'}</dd></div>
      <div><dt>指標・計算基準</dt><dd>{[metric.metric, metric.basis].filter(Boolean).join(' · ') || '計算基準 未確認'}</dd></div>
    </dl>
    {metric.comparisonLabel && metric.comparisonLabel !== metric.actual && <p>{metric.comparisonLabel}</p>}
    {metric.referenceActual && <p>参考計算：{metric.referenceActual}</p>}
    {metric.calculationNote && <p>{metric.calculationNote}</p>}
    {metric.explanation && <p>{metric.explanation}</p>}
  </div>;
}

const CandidateTableRow = memo(function CandidateTableRow({ item, selected, date, onSelect, onCompare, onMove, watched, onWatch }) {
  const { row, assessment, plan, readiness, growth = [], annual, volume, missing } = item;
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const selectionState = assessment?.qualified ? 'pass' : assessment?.failed > 0 ? 'fail' : 'unknown';
  const dailyState = readiness?.ready ? 'pass' : readiness?.failed > 0 ? 'fail' : 'unknown';
  const position = stateKey(plan?.state);
  const [positionLabel] = STATES[position];
  const nextCheck = readiness?.rules?.find(rule => rule.state !== 'pass');
  const financialRows = [...growth, ...(annual ? [annual] : [])];
  const selectionRules = item.selectionRules || assessment?.rules || [];
  const dailyLabel = readiness ? `${count(readiness.passed)}/${count(readiness.total)}` : '未確認';
  const nextLabel = nextCheck ? `${nextCheck.label}：${statusLabel(nextCheck.state)}` : readiness?.ready ? '発注前に最新価格とリスクを確認' : '分析日または市場環境が未確認';
  return <>
    <tr data-feed-symbol={row.symbol} data-selected={selected || undefined}>
      <th scope="row" className="research-table-identity">
        <button type="button" className="candidate-row" aria-current={selected ? 'true' : undefined}
          aria-label={`${row.symbol} の分析を表示。選定条件 ${count(assessment?.passed)}/${count(assessment?.total)}。日次確認 ${dailyLabel}。価格位置 ${positionLabel}${annual?.required ? `。必須 年次EPS ${statusLabel(annual.state)}` : ''}`}
          onClick={() => onSelect(row.symbol)} onKeyDown={event => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && onMove) {
              event.preventDefault();
              onMove(row.symbol, event.key === 'ArrowDown' ? 1 : -1, event.currentTarget);
            }
            if (event.key === 'Enter' && onCompare) { event.preventDefault(); onCompare(row.symbol); }
          }}>
          <span className="candidate-name"><strong className="mono">{row.symbol}</strong><small>{row.company_name || '企業名未配信'}</small></span>
          <span className="research-table-price mono">{Number.isFinite(plan?.price) ? money(plan.price) : '価格 未確認'}</span>
          <small>{Number.isFinite(row.price_change_1d) ? `${signed(row.price_change_1d)} 前日比` : '前日比 未確認'}</small>
        </button>
        {annual?.required && <div className="research-table-annual" data-state={annual.state}><span>必須 年次EPS</span> <Status state={annual.state}/></div>}
      </th>
      <td data-check="selection">
        <strong>{count(assessment?.passed)}/{count(assessment?.total)}</strong> <Status state={selectionState}/>
        <small>未達 {count(assessment?.failed)} · 未確認 {count(assessment?.unknown)}</small>
        {missing && <small className="research-table-missing" data-state={missing.state}>{missing.text}</small>}
      </td>
      <td data-check="daily">
        <strong>日次確認 {dailyLabel}</strong> <Status state={dailyState}/>
        <small>未達 {count(readiness?.failed)} · 未確認 {count(readiness?.unknown)}</small>
        <small>選定条件とは別の共通購入モデル</small>
      </td>
      <td data-check="price">
        <strong>{position === 'na' ? '未確認・判定不可' : positionLabel}</strong>
        <small>ピボット比 {Number.isFinite(plan?.distance) ? signed(plan.distance) : '未確認'}</small>
        <small>RS {Number.isFinite(row.rs_rating) ? Math.round(row.rs_rating) : '未確認'} · 出来高 {Number.isFinite(volume) ? times(volume) : '未確認'}</small>
        {plan?.sourceContext?.warning && <small className="research-table-source-warning">書籍の追随目安外</small>}
      </td>
      <td><CompactGrowth metric={growth[0]}/></td>
      <td><CompactGrowth metric={growth[1]}/></td>
      <td className="research-table-next" data-check="next" data-state={nextCheck?.state || dailyState}>
        <span>{nextLabel}</span>
      </td>
      <td className="research-table-actions">
        <button type="button" className="research-table-evidence-toggle" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
          aria-label={`${row.symbol} の対象期・提供元と判定根拠を${expanded ? '閉じる' : '見る'}`} onClick={() => setExpanded(open => !open)}>対象期・提供元 <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
        <div>{onCompare && <button type="button" onClick={() => onCompare(row.symbol)} aria-label={`${row.symbol} のチャートを開く`}>チャート</button>}
          {onWatch && <button type="button" className="research-table-watch" aria-label={`${row.symbol} ${watched ? 'ウォッチ解除' : 'ウォッチに保存'}`} aria-pressed={watched} onClick={() => onWatch(row.symbol)}>{watched ? '★' : '☆'}</button>}</div>
      </td>
    </tr>
    {expanded && <tr className="research-table-evidence-row"><td colSpan={8}>
      <section id={detailId} aria-label={`${row.symbol} の対象期・提供元と判定根拠`}>
        <header><h3>{row.symbol} の根拠</h3><span>価格 {date || '未確認'} 終値</span><button type="button" onClick={() => onSelect(row.symbol)} aria-label={`${row.symbol} の詳しい分析を開く`}>詳しい分析 →</button></header>
        <div className="research-table-sources">{financialRows.map(metric => <FinancialSource key={metric.id} metric={metric}/>)}</div>
        <div className="research-table-rule-details">
          <div><h4>選択中の手法の選定条件</h4>{selectionRules.length ? <ul>{selectionRules.map((rule, index) => <li key={rule.id || `${rule.label}-${index}`}><span>{rule.label}</span> <Status state={rule.state}/>{(rule.detail || rule.evidence) && <p>{rule.detail || rule.evidence}</p>}</li>)}</ul> : <p>条件別の根拠は詳しい分析で確認</p>}</div>
          <div><h4>共通購入モデルの日次確認</h4>{readiness?.rules?.length ? <ul>{readiness.rules.map(rule => <li key={rule.id}><span>{rule.label}</span> <Status state={rule.state}/>{rule.detail && <p>{rule.detail}</p>}</li>)}</ul> : <p>分析日または市場環境が未確認</p>}</div>
        </div>
      </section>
    </td></tr>}
  </>;
});

// The board owns the universe, order, page size and all financial/daily
// evaluation. This view only renders the very same prepared visible items.
export default memo(function ResearchCandidateTable({ items, method, date, selectedSymbol, onSelect, onCompare, onMove, onWatch, watch = [] }) {
  const helpId = useId();
  return <div className="research-candidate-table-wrap">
    <p className="research-table-scroll-hint" id={helpId}>横にスクロールして比較。対象期・提供元は各行のボタンから確認できます。</p>
    <div className="research-candidate-table-scroll" role="region" aria-label="銘柄候補の比較表" aria-describedby={helpId} tabIndex={0}>
      <table className="research-candidate-table">
        <caption>{METHOD_NAMES[method] || '手法 未確認'}の候補 · 価格 {date || '未確認'} 終値</caption>
        <thead><tr><th scope="col">銘柄・価格</th><th scope="col">選択手法の選定条件</th><th scope="col">日次確認</th><th scope="col">価格位置 · アプリ</th><th scope="col">四半期EPS前年比</th><th scope="col">売上前年比</th><th scope="col">共通購入モデルで次に確認</th><th scope="col">根拠・操作</th></tr></thead>
        <tbody>{items.map(item => <CandidateTableRow key={item.row.symbol} item={item} date={date} selected={item.row.symbol === selectedSymbol} watched={watch.includes(item.row.symbol)} {...{ onSelect, onCompare, onMove, onWatch }}/>)}</tbody>
      </table>
    </div>
  </div>;
});
