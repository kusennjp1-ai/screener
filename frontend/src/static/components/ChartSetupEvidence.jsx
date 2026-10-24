import { useState } from 'react';
import './chartSetupEvidence.css';

const number = value => Number.isFinite(value) ? value.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) : '未確認';

// These are the same measured legs used by the chart overlay. This panel does
// not run another VCP detector or turn retrospective annotations into signals.
export default function ChartSetupEvidence({ annotations, symbol, date, warning, daily = true, detailed, onToggle, onFocus }) {
  const [selected, setSelected] = useState(null);
  const usable = !warning && daily;
  const legs = usable ? annotations.legs || [] : [];
  const base = usable ? annotations.boxes?.find(box => !box.curve && !box.arrow) : null;
  const last = legs.at(-1);
  const volumeKnown = legs.length >= 2 && legs.every(leg => Number.isFinite(leg.volume) && leg.volume > 0);
  const volumeShrinks = volumeKnown && legs.every((leg, index) => !index || leg.volume < legs[index - 1].volume);
  const lastVolumeRatio = volumeKnown ? last.volume / legs[0].volume : null;
  const activeIndex = legs.findIndex(leg => `${leg.start}/${leg.end}` === selected);
  const active = legs[activeIndex >= 0 ? activeIndex : legs.length - 1];
  const activeNumber = activeIndex >= 0 ? activeIndex + 1 : legs.length;
  const candidate = usable && annotations.candidate;
  const label = candidate ? 'VCP候補を検出' : base ? 'ベース候補のみ' : '収縮条件は未確認';
  const maximum = Math.max(1, ...legs.map(leg => leg.depthPct));
  return <section className="chart-setup-evidence" aria-label={`${symbol} のVCP分析`}>
    <header className="chart-setup-head">
      <div><span className="chart-setup-eyebrow">PATTERN INSIGHT</span><h3>値幅の収縮を読み解く</h3></div>
      <span className="chart-setup-status" data-state={candidate ? 'candidate' : 'unknown'}>{candidate ? '◈' : '○'} {label}</span>
    </header>
    <p className="chart-setup-caption">{symbol} · 日足 {date || '基準日未確認'} · 自動検出の参考図解</p>
    {!usable ? <p className="chart-setup-unavailable">{warning ? '日足の整合性を確認できないため、VCPの図解と数値を表示できません。' : 'VCPの収縮区間は日足で確認できます。日足に切り替えてください。'}</p> : <>
      <div className="chart-setup-metrics">
        <div><span>収縮区間</span><strong>{legs.length ? <>{legs.length}<small> 回</small></> : '未確認'}</strong><small>{legs.length ? '連続する押しの値幅が縮小' : base ? '連続した縮小を確認できず' : 'ベース候補を確認できず'}</small></div>
        <div><span>最終区間の値幅</span><strong>{last ? <>{last.depthPct.toFixed(1)}<small> %</small></> : '—'}</strong><small>探索設定：10%以内</small></div>
        <div><span>区間平均出来高</span><strong>{lastVolumeRatio !== null ? <>{Math.round(lastVolumeRatio * 100)}<small> %</small></> : '—'}</strong><small>{volumeKnown ? `C1比 · ${volumeShrinks ? '各区間で減少' : '順次減少は未確認'}` : '収縮区間の比較データなし'}</small></div>
      </div>
      {legs.length > 0 ? <>
        <div className="chart-contraction-heading"><span>収縮の推移 <small>区間を選ぶとチャートに移動</small></span><button type="button" aria-pressed={detailed} onClick={onToggle}>{detailed ? '図上のガイドを隠す' : '図上にガイドを表示'}</button></div>
        <div className="chart-contraction-sequence" role="group" aria-label="収縮区間をチャートで確認">
          {legs.map((leg, index) => <button type="button" key={`${leg.start}/${leg.end}`} aria-pressed={active === leg} aria-label={`C${index + 1} の収縮区間を表示`} onClick={() => { setSelected(`${leg.start}/${leg.end}`); onFocus(leg, index); }}>
            <span className="chart-contraction-number">C{index + 1}</span><strong>{leg.depthPct.toFixed(1)}<small>%</small></strong>
            <span className="chart-contraction-track" aria-hidden="true"><span style={{ width: `${leg.depthPct / maximum * 100}%` }} /></span>
            <span className="chart-contraction-date">{leg.start.slice(5)} → {leg.end.slice(5)}</span>
          </button>)}
        </div>
        <div className="chart-contraction-detail" aria-live="polite"><span>C{activeNumber}</span><p>{active.start} → {active.end}<br /><span>高値 {number(active.high)} / 安値 {number(active.low)} · 区間平均出来高 {number(active.volume)}</span></p></div>
      </> : <p className="chart-setup-unavailable">{annotations.summary} 条件を確認できない区間に収縮線は描きません。</p>}
      {candidate && <div className="chart-setup-observation"><span>収縮高値 <strong>{number(annotations.pivot)}</strong></span><span>{annotations.breakout ? `${annotations.breakout.date} · ${annotations.breakout.label}` : '収縮高値の上抜けは未確認'}</span></div>}
    </>}
    <p className="chart-setup-note">過去の日足からの形状候補です。VCPの成立や購入条件の通過を示すものではありません。出来高は区間平均の比較で、最終日の出来高枯渇とは別です。</p>
  </section>;
}
