import { money, times } from '../positionGeometry';
import { footprint, upDownVolume } from './briefChartModel';

const finite = Number.isFinite;
// The desktop (1024px and wider) keeps this footnote in place; below that it is in the screen's 注記.
const UPDOWN_INLINE = '上げた日の出来高 ÷ 下げた日の出来高。1超は買いが優勢';

/** The VCP card: the measured contractions and the volume evidence beside the pivot. */
export default function VcpCard({ technical, bars, judged, view, wide }) {
  const print = footprint(technical, bars), legs = technical?.vcp?.legs || [];
  const dry = legs.at(-1)?.volumeEvidence?.intervalRatio;
  return <section className="brief-card in" style={{ '--i': 4 }} aria-labelledby="brief-vcp-title">
    <h2 id="brief-vcp-title">値幅の収縮（VCP）</h2>
    {print ? <>
      <p className="brief-footprint">{print.text}</p>
      <p className="brief-note">土台 {print.weeks}週・{print.firstLabel} {print.first.toFixed(0)}% → 最後 {print.last.toFixed(0)}%・収縮 {print.count}回{print.contracting === true ? '（押しが毎回浅くなっています）' : print.contracting === false ? '（押しの縮小が途切れています）' : ''}</p>
      <div className="brief-legs" aria-hidden="true">{legs.map((leg, i) => <div key={leg.startDate}><span className="grow-y" style={{ height: `max(6px, calc(${(leg.depthPct / Math.max(...legs.map(l => l.depthPct))).toFixed(3)} * (100% - 22px)))`, '--i': i }} />−{leg.depthPct.toFixed(0)}%</div>)}</div>
    </> : <p className="brief-note">測定できる収縮が2回以上ないため、VCPは未確認です。</p>}
    <dl className="brief-dl">
      <div><dt>最後の収縮の出来高</dt><dd>{finite(dry) ? <>{times(dry)}<small>直前50日平均比</small></> : '未確認'}</dd></div>
      <div><dt>上げ下げ出来高比（50日）</dt><dd>{(() => { const v = upDownVolume(judged); return v ? <>{v.ratio.toFixed(2)}<small>{wide ? UPDOWN_INLINE : '1超は買いが優勢'}</small></> : '未確認'; })()}</dd></div>
      <div><dt>当日の出来高</dt><dd>{finite(view?.volumeRatio) ? <>{times(view.volumeRatio)}<small>上抜けの目安 1.40×以上</small></> : '未確認'}</dd></div>
      <div><dt>ピボット</dt><dd>{finite(view?.pivot) ? <>{money(view.pivot)}<small>{view.pivotSource}</small></> : '未確認'}</dd></div>
    </dl>
  </section>;
}
