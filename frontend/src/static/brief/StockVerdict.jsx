import { signed } from '../positionGeometry';
import { code33ChipView } from '../fundamentalsExplain.js';
import { meterPercent } from './briefNav';
import { footprint, RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';
import { sellChipView } from './briefSell';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

const CALL = {
  zone: (v, breakout) => ['zone', breakout ? 'ピボットを出来高を伴って上抜け' : '買いゾーン内', `ピボット比 ${signed(v.distance)}。ピボットから＋5%までが買いの範囲です。`],
  wait: v => finite(v.distance) && v.distance >= -5 ? ['wait', `ピボットまで あと${Math.abs(v.distance).toFixed(1)}%`, '出来高を伴ってピボットを上抜けるまで待ちます。'] : ['neutral', '土台を形成中', `ピボット比 ${signed(v.distance)}。まだ買いの局面ではありません。`],
  ext: v => ['ext', '買いゾーンを超過', `ピボット比 ${signed(v.distance)}。追いかけ買いは避け、次の土台を待ちます。`],
};

function Meter({ distance }) {
  if (!finite(distance)) return <p className="brief-note">ピボットを確認できないため位置は未確認です。</p>;
  return <div className="brief-meter" role="img" aria-label={`ピボットからの位置 ${signed(distance)}`}>
    <span className="brief-meter-labels" aria-hidden="true"><span>土台</span><span>接近</span><span className="is-zone">買い</span><span>伸びすぎ</span></span>
    <span className="brief-meter-track" aria-hidden="true"><i className="seg-base" /><i className="seg-near" /><i className="seg-zone" /><i className="seg-ext" /></span>
    <span className="brief-marker brief-meter-marker is-entering" style={{ '--p': meterPercent(distance) }} aria-hidden="true" />
    <span className="brief-meter-ticks" aria-hidden="true">{['−10%', '−5%', '0%', '+5%', '+10%'].map(t => <span key={t}>{t}</span>)}</span>
  </div>;
}

/**
 * The stock's conclusion card: the position call, the pivot meter, the three level tiles and the chip
 * list. `market` is the market verdict (step 0: not read yet).
 */
export default function StockVerdict({ view, plan, stage, technical, bars, rsHigh, financial, row, sells, diagnostics, market = null }) {
  void market;
  const breakout = view.state === 'zone' && finite(view.volumeRatio) && view.volumeRatio >= 1.4;
  const [tone, title, sub] = (CALL[view.state] || (() => ['neutral', view.stateLabel, '買い位置を判定できません。']))(view, breakout);
  const print = footprint(technical, bars);
  const code33 = code33ChipView(financial), sell = sellChipView(sells);
  const chips = [
    [stage ? `ステージ${stage.value}${stage.computed ? '（日足から算出）' : ''}` : 'ステージ 未確認', stage?.value === 2 ? 'zone' : stage ? 'ext' : ''],
    [print ? print.text : 'VCP 未確認', print?.contracting === true ? 'zone' : ''],
    [`RS推計 ${finite(view.rs) ? view.rs : '未確認'}`, finite(view.rs) && view.rs >= 70 ? 'zone' : ''],
    // RS line at a new high while the price is still below its own high: the RS line is leading.
    ...(rsHigh ? [[finite(view.fromHigh) && view.fromHigh >= RS_LEAD_FROM_HIGH_PERCENT ? `RS線 新高値（株価に先行・高値の${view.fromHigh.toFixed(0)}%下）` : 'RS線 新高値', 'zone']] : []),
    [code33.text, code33.tone],
    ...(Number.isInteger(row?.ibd_group_rank) ? [[`業種 ${row.ibd_group_rank}位（推計）`, row.ibd_group_rank <= 40 ? 'zone' : '']] : []),
    ...(sell ? [[sell.text, sell.tone]] : []),
    ...(diagnostics?.valid && diagnostics.powerPlay?.mechanicalMatch ? [['パワープレー候補（機械的探索）', 'wait']] : []),
    [view.earnings ? `決算まで ${view.earnings.days}日` : '決算日 未確認', view.earnings && view.earnings.days <= 10 ? 'ext' : ''],
  ];
  return <section className={`brief-card brief-call tone-${tone} in`} style={{ '--i': 0 }} aria-label="結論" data-testid="brief-conclusion">
    <div className="brief-call-status"><span className="brief-call-dot" aria-hidden="true" /><div><strong>{title}</strong><p>{sub}</p></div></div>
    <Meter distance={view.distance} />
    <div className="brief-kgrid">
      <div><small>買いの範囲</small><b className="numeric">{price(view.pivot)}</b><em>〜{price(view.upper)}</em></div>
      <div><small>{plan ? `損切り（−${plan.stopPercent.toFixed(1)}%）` : '損切り'}</small><b className="numeric">{price(plan?.stop)}</b><em>買値 {price(plan?.entry)}</em></div>
      <div><small>利益目標 2R</small><b className="numeric">{price(plan?.r2)}</b><em>3R {price(plan?.r3)}</em></div>
    </div>
    <div className="brief-tags">{chips.map(([text, t]) => <span key={text} className={`brief-chip${t ? ` tone-${t}` : ''}`}>{text}</span>)}</div>
  </section>;
}
