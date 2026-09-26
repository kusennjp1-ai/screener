import { useState } from 'react';
import { Alert, Button, Typography } from '@mui/material';
import { fetchStaticChartPayload } from '../chartClient';
import { reviewBookPattern } from '../bookPatternReview';

const show = n => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '未確認';
const fields = [['advanceStart', '先行上昇の起点'], ['baseStart', 'ベース開始'], ['troughDate', 'ベースの底'], ['cheatStart', 'チート開始'], ['cheatEnd', 'チート終了'], ['breakoutDate', 'ブレイク日（未発生なら空欄）']];

function PatternForm({ row, entry, date }) {
  const storageKey = `book-pattern-review-v1:${row.symbol}:${date}`;
  const saved = () => { try { const data = JSON.parse(localStorage.getItem(storageKey)); return data?.symbol === row.symbol && data?.date === date && data.review && typeof data.review === 'object' && ['vcp', 'three-c', 'low-cheat', 'power-play'].includes(data.review.pattern) ? data.review : null; } catch { return null; } };
  const [form, setForm] = useState(() => saved() || { pattern: 'three-c', source: '', tickSize: .01 });
  const [context, setContext] = useState(() => saved()?.context || {});
  const [savedAt, setSavedAt] = useState(() => saved()?.reviewedAt || null);
  const [result, setResult] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const update = (key, value) => { setForm(f => ({ ...f, [key]: value })); setResult(null); };
  async function calculate(event) {
    event.preventDefault(); setLoading(true); setError(''); setResult(null);
    try {
      const payload = await fetchStaticChartPayload(entry.path);
      const review = { ...form, ipoPrice: form.ipoPrice ? Number(form.ipoPrice) : null, context, reviewedAt: new Date().toISOString() };
      const evidence = reviewBookPattern(row, payload, date, review);
      setResult(evidence);
      if (evidence.valid) {
        try { localStorage.setItem(storageKey, JSON.stringify({ symbol: row.symbol, date, review })); setSavedAt(review.reviewedAt); }
        catch { setSavedAt(null); }
      }
    } catch (e) { setError(`日足の取得・検証に失敗しました：${e.message}`); }
    finally { setLoading(false); }
  }
  return <details style={{ marginTop: 12 }}>
    <summary>区間を指定してVCP・3C・低いチート・パワープレーを実測</summary>
    <Typography sx={{ fontSize: 13, my: 1 }}>チャートで確認した日付を入力すると、その区間の高安・値幅・出来高を測定します。自動認定ではありません。空欄から始め、過去の値動きに都合よく区間を選ばないよう確認資料を残します。</Typography>
    {!entry?.path && <Alert severity="warning">この銘柄の日足が配信されていないため実測できません。</Alert>}
    <form onSubmit={calculate}>
      <fieldset disabled={loading} aria-label="パターン確認入力" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <label>確認するパターン<select aria-label="確認するパターン" value={form.pattern} onChange={e => update('pattern', e.target.value)} style={{ display: 'block', width: '100%', minHeight: 40 }}><option value="vcp">VCP</option><option value="three-c">3C</option><option value="low-cheat">低いチート</option><option value="power-play">パワープレー</option></select></label>
        {form.pattern === 'vcp' ? Array.from({ length: 6 }, (_, i) => ['startDate', 'endDate'].map(key => <label key={`${i}-${key}`}>T{i + 1} {key === 'startDate' ? '高値の日' : '安値までの終了日'}<input type="date" max={date} required={i < 2} value={form.intervals?.[i]?.[key] || ''} onChange={e => { const intervals = Array.from({ length: 6 }, (_, n) => ({ ...form.intervals?.[n] })); intervals[i][key] = e.target.value; update('intervals', intervals); }} style={{ display: 'block', width: '100%', minHeight: 40, boxSizing: 'border-box' }} /></label>)) : fields.map(([key, label]) => <label key={key}>{label}<input aria-label={label} type="date" max={date} required={key !== 'breakoutDate'} value={form[key] || ''} onChange={e => update(key, e.target.value)} style={{ display: 'block', width: '100%', minHeight: 40, boxSizing: 'border-box' }} /></label>)}
        <label>呼値の計算例<input aria-label="呼値の計算例" type="number" min="0.0001" step="0.0001" required value={form.tickSize} onChange={e => update('tickSize', e.target.value)} style={{ display: 'block', width: '100%', minHeight: 40, boxSizing: 'border-box' }} /></label>
        {form.pattern === 'low-cheat' && <><label>IPO日（該当する場合）<input type="date" max={date} value={form.ipoDate || ''} onChange={e => update('ipoDate', e.target.value)} style={{ display: 'block', minHeight: 40, width: '100%' }} /></label><label>IPO価格（任意）<input type="number" min="0" step="any" value={form.ipoPrice || ''} onChange={e => update('ipoPrice', e.target.value)} style={{ display: 'block', minHeight: 40, width: '100%' }} /></label></>}
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>確認資料・チャートの出所<input aria-label="確認資料・チャートの出所" required maxLength={500} value={form.source} onChange={e => update('source', e.target.value)} placeholder="確認したチャートや開示のURL・資料名" style={{ display: 'block', width: '100%', minHeight: 40, boxSizing: 'border-box' }} /></label>
      <fieldset style={{ margin: '12px 0', border: '1px solid currentColor', borderRadius: 8 }}><legend>目視で確認した項目だけを記録</legend>{[['stageConfirmed', '初期／後期ステージ'], ['supplyConfirmed', '売り枯れ・上値の売り圧力'], ['weeklyTightnessConfirmed', '週足・狭い値幅']].map(([key, label]) => <label key={key} style={{ display: 'block', padding: 8 }}><input type="checkbox" checked={context[key] === true} onChange={e => { setContext(c => ({ ...c, [key]: e.target.checked })); setResult(null); }} /> {label}</label>)}</fieldset>
      <Button type="submit" variant="outlined" disabled={loading || !entry?.path}>{loading ? '日足を検証中…' : '指定区間を実測する'}</Button>
      {savedAt && <Typography sx={{ fontSize: 12, mt: 1 }}>この端末に保存した区間：{savedAt}。再表示時も「実測する」で現在の配信日足と照合します。<Button size="small" onClick={() => { try { localStorage.removeItem(storageKey); } catch { /* local storage may be unavailable */ } setSavedAt(null); setForm({ pattern: 'three-c', source: '', tickSize: .01 }); setContext({}); setResult(null); }}>記録を消去</Button></Typography>}
      </fieldset>
    </form>
    {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    {result && !result.valid && <Alert severity="warning" sx={{ mt: 1 }}>{result.errors.join(' / ')}</Alert>}
    {result?.valid && <section aria-label="指定パターンの実測結果">
      <Typography sx={{ my: 1 }}>ベース {show(result.facts.baseDepth)}% ／ チート {show(result.facts.cheatDepth)}% ／ 出来高比 {show(result.facts.dryRatio)}倍。確認日時：{result.review.reviewedAt}</Typography>
      <ul>{result.rules.map(r => <li key={r.label}>{r.label}：{r.state === 'pass' ? '測定条件に該当' : r.state === 'fail' ? '測定条件に非該当' : '未確認'}{r.scope === 'reviewer-declaration' ? '（入力者の確認記録）' : ''}</li>)}</ul>
      {result.vcp?.legs?.length > 0 && <div style={{ overflowX: 'auto' }}><table aria-label="指定VCP区間の実測"><thead><tr><th>区間</th><th>高値→安値</th><th>押し%</th><th>営業日</th><th>平均出来高</th></tr></thead><tbody>{result.vcp.legs.map((leg, i) => <tr key={`${leg.startDate}-${leg.endDate}`}><th>T{i + 1} {leg.startDate} → {leg.endDate}</th><td>{show(leg.high)} → {show(leg.low)}</td><td>{show(leg.depthPct)}</td><td>{leg.sessions}</td><td>{show(leg.averageVolume)}</td></tr>)}</tbody></table></div>}
      {result.vcp?.finalContractionVolume && <Typography sx={{ my: 1 }}>指定した最終収縮の開始前50日平均比：区間全体 {show(result.vcp.finalContractionVolume.intervalRatio)}倍 ／ 最終1本 {show(result.vcp.finalContractionVolume.lastRatio)}倍 ／ 最終2本平均 {show(result.vcp.finalContractionVolume.lastTwoRatio)}倍。基準期間 {result.vcp.finalContractionVolume.baselineStart}〜{result.vcp.finalContractionVolume.baselineEnd}、区間末尾 {result.vcp.finalContractionVolume.lastDate}。比較窓はアプリの代理指標です。</Typography>}
      {result.plan && <Alert severity="info">計算例：チート高値超え ${show(result.plan.entryTriggerExample)} ／ 構造上の無効化を想定した逆指値 ${show(result.plan.structuralStopExample)} ／ 1株リスク ${show(result.plan.riskPerShare)}（{show(result.plan.riskPct)}%）。{result.plan.basis}</Alert>}
      <ul>{result.unknowns.map(s => <li key={s}>{s}</li>)}</ul>
      <a download={`${row.symbol}-${date}-pattern-review.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result, null, 2))}`}>区間・出所・実測結果を保存</a>
      <Typography sx={{ fontSize: 12, mt: 1 }}>書籍の裁量判断の成立認定、購入指示、98%の再現保証ではありません。パワープレーでは通常の業績条件を一律に要求しません。</Typography>
    </section>}
  </details>;
}

// Reset drafts/results when identity changes; never display the prior stock's review.
export default function BookPatternReview(props) {
  return <PatternForm key={`${props.row.symbol}:${props.date}:${props.entry?.path || ''}`} {...props} />;
}
