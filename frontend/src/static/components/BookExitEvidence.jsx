import { useState } from 'react';
import { Alert, Button, Typography } from '@mui/material';
import { fetchStaticChartPayload } from '../chartClient';
import { buildBookExitEvidence } from '../bookExitEvidence';
const n = v => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '未確認';
const yes = v => v === null ? '未確認' : v ? '該当' : '非該当';

function ExitForm({ row, entry, date }) {
  const [form, setForm] = useState({ breakoutDate: '', reviewDate: '', source: '', stage: '', baseCount: '', setupConfirmed: false });
  const [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState('');
  const update = (key, value) => { setForm(f => ({ ...f, [key]: value })); setResult(null); setError(''); setSaved(''); };
  const ready = form.breakoutDate && form.reviewDate && form.source.trim() && form.setupConfirmed;
  async function calculate(e) {
    e.preventDefault(); setResult(null); setError(''); setSaved(''); setLoading(true);
    try {
      const evidence = buildBookExitEvidence(row, await fetchStaticChartPayload(entry.path), date, form);
      setResult(evidence);
      if (evidence.valid && form.setupConfirmed === true) {
        try {
          window.localStorage.setItem(`book-exit-review-v1:${row.symbol}:${date}`, JSON.stringify({ symbol: row.symbol, asOfDate: date,
            breakoutDate: form.breakoutDate, source: form.source.trim(), reviewDate: form.reviewDate, reviewedAtISO: new Date().toISOString(),
            setupConfirmed: true, stage: evidence.stage, baseCount: evidence.context.baseCount }));
          setSaved('確認したブレイク日と文脈をこの端末に保存しました。自己申告の確認記録であり、成立認定や当時既知だった証拠ではありません。');
        } catch { setSaved('実測結果は表示できますが、端末への確認記録の保存に失敗しました。JSONを保存してください。'); }
      }
    }
    catch (err) { setError(`日足を読み取れません：${err.message}`); }
    finally { setLoading(false); }
  }
  return <details style={{ marginTop: 12 }}><summary>ブレイク後の異常動作と初期・後期の区別</summary>
    <Typography sx={{ fontSize: 13, my: 1 }}>確認したブレイク日から、20日線・連続安値・買い支えを日別に照合します。局面が空欄なら、急騰をクライマックス売りとは認定しません。</Typography>
    <form onSubmit={calculate}><fieldset disabled={loading} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
      {[['breakoutDate','出口検証のブレイク日'],['reviewDate','文脈を確認した日']].map(([key,label]) => <label key={key}>{label}<input aria-label={label} type="date" max={key === 'reviewDate' ? new Date().toISOString().slice(0,10) : date} required value={form[key]} onChange={e => update(key,e.target.value)} style={{ display: 'block', minHeight: 40, width: '100%' }} /></label>)}
      <label>出口検証の確認資料<input aria-label="出口検証の確認資料" required maxLength={500} value={form.source} onChange={e => update('source',e.target.value)} style={{ display: 'block', minHeight: 40, width: '100%' }} /></label>
      <label>確認した局面<select aria-label="確認した局面" value={form.stage} onChange={e => update('stage',e.target.value)} style={{ display: 'block', minHeight: 40, width: '100%' }}><option value="">未確認</option><option value="early">初期（本人確認）</option><option value="late">後期（本人確認）</option></select></label>
      <label>ベース番号（任意）<input aria-label="ベース番号（任意）" type="number" min="1" max="99" step="1" value={form.baseCount} onChange={e => update('baseCount',e.target.value)} style={{ display: 'block', minHeight: 40, width: '100%' }} /></label>
    </div><label style={{ display: 'block', margin: '12px 0' }}><input type="checkbox" checked={form.setupConfirmed} onChange={e => update('setupConfirmed',e.target.checked)} />適切なベースからの上放れを資料で確認した</label>
    <Button type="submit" disabled={!ready || !entry?.path || loading}>{loading ? '照合中…' : 'ブレイク後の実測を照合'}</Button></fieldset></form>
    {!ready && <Typography sx={{ fontSize: 12 }}>ブレイク日・資料・確認日・ベース確認を入力してください。架空の文脈は補完しません。</Typography>}
    {error && <Alert severity="error">{error}</Alert>}{result && !result.valid && <Alert severity="warning">{result.errors.join(' / ')}</Alert>}
    {saved && <Typography role="status" sx={{ fontSize: 12, my: 1 }}>{saved}</Typography>}
    {result?.valid && <section aria-label="出口の実測根拠"><Typography sx={{ my: 1 }}>局面：{result.stage === 'early' ? '初期（自己申告）' : result.stage === 'late' ? '後期（自己申告）' : '未確認'}。初期15日中12日以上上昇：{yes(result.stageSignals.earlyStrength)} ／ 後期急騰の複合確認対象：{yes(result.stageSignals.lateExhaustionReview)}。売却指示ではありません。</Typography>
      <Typography sx={{ fontSize: 13 }}>指定ブレイク後の最大日中値幅：{result.stageSignals.largestRangeDate || '未確認'} ／ 最大出来高：{result.stageSignals.largestVolumeDate || '未確認'}。</Typography>
      <Typography sx={{ fontSize: 13 }}>{result.stageSignals.gains.map(g => `${g.sessions}営業日比 ${n(g.gainPct)}%`).join(' ／ ')}</Typography>
      <Typography sx={{ fontSize: 13 }}>{result.stageSignals.upWindows.map(w => `${w.sessions}日：上昇${w.upDays ?? '未確認'}日 (${n(w.upPct)}%)`).join(' ／ ')}</Typography>
      <div style={{ overflowX: 'auto', maxHeight: 360 }}><table className="research-table" aria-label="ブレイク後の日別検証"><thead><tr>{['日付（経過）','20 / 50日線割れ','3安値切下げ','増商い・上半分引け','買い支え','出来高 / 50日','複合懸念','薄商いブレイク後の売り'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{result.postBreakout.map(p => <tr key={p.date}><td>{p.date}（{p.sessionsSinceBreakout}）</td><td>{yes(p.below20)} / {yes(p.below50)}</td><td>{yes(p.threeLowerLows)}</td><td>{yes(p.volumeIncreasing)} / {yes(p.upperHalfClose)}</td><td>{yes(p.thirdDaySupport)}</td><td>{n(p.volumeToPrior50)}倍</td><td>{yes(p.combinedConcern)}</td><td>{yes(p.thinBreakoutThenDistribution)}</td></tr>)}</tbody></table></div>
      <ul>{result.unknowns.map(t => <li key={t}>{t}</li>)}</ul><a download={`${row.symbol}-${date}-exit-review.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result,null,2))}`}>文脈と日別根拠を保存</a>
    </section>}</details>;
}
export default function BookExitEvidence(props) { return <ExitForm key={`${props.row.symbol}:${props.date}:${props.entry?.path || ''}`} {...props} />; }
