import { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { appendJournalEvent, deriveJournal, emptyJournal, exportJournal, importJournal, JOURNAL_STORAGE_KEY, journalExposurePolicy, reviewJournalExit, reviewJournalOrder } from '../localTradeJournal';
import PartialSalePlan from './PartialSalePlan';

const number = (n, suffix = '') => typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}${suffix}` : '未確認';
const emptyEvent = { date: '', type: 'buy', symbol: '', price: '', shares: '', fees: '0', stop: '', note: '', strategy: 'minervini', setupDate: '' };
const emptyChecks = { setupConfirmed: false, marketConfirmed: false, earningsConfirmed: false, reentryConfirmed: false };
const emptyExit = { symbol: '', close: '', ma50: '', backstop: '', previousMa50: '', previousMa50Date: '', asOfDate: '', previousTrailingLevel: '' };
const emergencySteps = [
  '通信断・停電：証券会社の代替アクセスと連絡先を事前に用意し、未約定注文と保有を確認する。',
  '寄付ギャップ・急落：逆指値で約定したかを確認し、損失を取り戻す目的で追加しない。停止価格での約定を保証しない。',
  '損切り後：注文残と株数を照合する。再仕掛けは以前の買値への執着ではなく、新しいセットアップの確認から始める。',
];

function readSaved(mode = 'live') {
  try {
    const raw = window.localStorage.getItem(`${JOURNAL_STORAGE_KEY}.${mode}`);
    const journal = raw ? importJournal(raw) : emptyJournal(100000, mode);
    if (journal.mode !== mode) throw Error('取引区分が一致しません。');
    return { journal, error: '' };
  } catch { return { journal: emptyJournal(100000, mode), error: '保存済み日誌を読み取れませんでした。自動上書きはしていません。元データを確認してください。' }; }
}

export default function LocalTradeJournal() {
  const [initial] = useState(readSaved);
  const [journal, setJournal] = useState(initial.journal);
  const [error, setError] = useState(initial.error);
  const [form, setForm] = useState(emptyEvent);
  const [capital, setCapital] = useState(String(initial.journal.initialCapital));
  const [importText, setImportText] = useState('');
  const [checks, setChecks] = useState(emptyChecks);
  const [proposal, setProposal] = useState(null);
  const changeForm = updater => { setForm(updater); setProposal(null); };
  const [exitInput, setExitInput] = useState(emptyExit);
  const state = useMemo(() => deriveJournal(journal), [journal]);
  const policy = journalExposurePolicy(state);
  const save = next => {
    const text = exportJournal(next);
    try { window.localStorage.setItem(`${JOURNAL_STORAGE_KEY}.${next.mode}`, text); }
    catch { throw Error('端末に保存できませんでした。記録は追加していません。JSONを退避して空き容量を確認してください。'); }
    setJournal(next); setProposal(null); setChecks(emptyChecks); setError('');
  };
  const eventValues = () => ({ date: form.date, type: form.type, symbol: form.symbol.trim().toUpperCase(), price: Number(form.price), shares: Number(form.shares), fees: Number(form.fees), stop: Number(form.stop), note: form.note, strategy: form.strategy, setupDate: form.setupDate, confirmations: checks });
  const addEvent = () => {
    try {
      const e = eventValues();
      save(appendJournalEvent(journal, { ...e, id: crypto.randomUUID() }));
      setForm({ ...emptyEvent, date: form.date });
    } catch (e) { setError(e.message); }
  };
  const evaluate = () => {
    setError('');
    setProposal(reviewJournalOrder(state, { ...eventValues(), ...checks, setupNote: form.note, setupDate: form.setupDate }));
  };
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([exportJournal(journal)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `screener-${journal.mode}-trade-journal.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const recordMa50 = () => {
    try {
      save(appendJournalEvent(journal, { id: crypto.randomUUID(), type: 'ma50', symbol: exitInput.symbol, date: exitInput.asOfDate, close: Number(exitInput.close), ma50: Number(exitInput.ma50) }));
    } catch (e) { setError(e.message); }
  };
  const exitHolding = state.holdings.find(p => p.symbol === exitInput.symbol);
  const exitResult = exitHolding && exitInput.close.trim() ? reviewJournalExit(exitHolding, {
    close: Number(exitInput.close), ma50: exitInput.ma50.trim() ? Number(exitInput.ma50) : null,
    backstop: exitInput.backstop.trim() ? Number(exitInput.backstop) : null,
    previousMa50: exitInput.previousMa50.trim() ? Number(exitInput.previousMa50) : null, previousMa50Date: exitInput.previousMa50Date, asOfDate: exitInput.asOfDate,
    previousTrailingLevel: exitInput.previousTrailingLevel.trim() ? Number(exitInput.previousTrailingLevel) : null,
  }, state.stats) : null;

  return <Box component="section" aria-label="端末内の取引日誌" sx={{ mt: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    <Typography component="h3" variant="h6">取引日誌と全保有のリスク</Typography>
    <Typography sx={{ fontSize: 13, my: 1 }}>入力した取引だけを、このブラウザーに保存します。外部送信・発注・架空の取引作成はありません。端末変更・ブラウザー初期化の前にJSONを退避してください。信用取引・入出金・株式分割は未対応です。</Typography>
    {error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', my: 2 }}>
      <TextField select label="日誌の取引区分" size="small" value={journal.mode} onChange={e => { const saved = readSaved(e.target.value); setJournal(saved.journal); setCapital(String(saved.journal.initialCapital)); setError(saved.error); setProposal(null); setForm(emptyEvent); setExitInput(emptyExit); setChecks(emptyChecks); }}><MenuItem value="live">実取引（自己申告）</MenuItem><MenuItem value="paper">ペーパートレード</MenuItem></TextField>
      <TextField label="日誌の開始資金 $" size="small" value={capital} disabled={journal.events.length > 0} onChange={e => setCapital(e.target.value)} />
      <Button disabled={journal.events.length > 0} onClick={() => { try { save(emptyJournal(Number(capital), journal.mode)); } catch (e) { setError(e.message); } }}>開始資金を保存</Button>
      <Button onClick={exportFile}>日誌JSONを保存</Button>
    </Box>
    <Typography sx={{ fontWeight: 700, my: 1 }}>{journal.mode === 'live' ? '実取引の記録' : 'ペーパートレードの記録'} — 成績・資金は区分ごとに分離</Typography>
    <div className="decision-totals"><span>現金 <strong>${number(state.cash)}</strong></span><span>評価資産 <strong>${number(state.equity)}</strong></span><span>株式比率 <strong>{number(state.exposure * 100, '%')}</strong></span><span>実現損益 <strong>${number(state.realized)}</strong></span><span>記録上の最大下落 <strong>${number(state.maxDrawdown)} / {number(state.maxDrawdownPct, '%')}</strong></span></div>
    <Typography sx={{ fontSize: 12, my: 1 }}>{state.drawdownBasis}。複数銘柄の評価時刻は同時ではなく、配当・税・為替は未反映です。{state.marksAligned ? '' : '評価日が混在しています。'}</Typography>
    <Typography sx={{ my: 1 }}>自己申告の全記録に基づく条件付き上限：総投入{number(policy.totalCap * 100, '%')}、1銘柄{number(policy.singleCap * 100, '%')}、1取引損失予算{number(policy.riskPerTrade * 100, '%')}、全保有元本リスク{number(policy.portfolioRiskCap * 100, '%')}。{policy.defensive ? '縮小段階' : policy.expansionSupported ? '実績を伴う拡大検討段階' : '試行段階'}。</Typography>
    <Typography sx={{ fontSize: 12 }}>{policy.source}。損益ゼロや小利益1回で縮小は解除しません。資金加重の損益がマイナスなら、単純平均の成績が良くても拡大しません。</Typography>
    {policy.requiresReduction && <Alert severity="warning" sx={{ mt: 1 }}>現在の全保有は計算上限を超えています。新規買付前に、全体の縮小計画を確認してください。自動売却はしません。</Alert>}
    <Typography sx={{ fontSize: 13, my: 1 }}>全売却済み{state.closedTrades.length}件 ／ 平均利益 {number(state.stats?.averageWin, '%')} ／ 平均損失 {number(state.stats?.averageLoss, '%')} ／ 損益比 {number(state.stats?.payoffRatio, '倍')}。分割売却は全売却まで1取引として完了集計しません。</Typography>
    {state.stats?.averageWin == null && <Typography sx={{ fontSize: 12 }}>過去の取引を用意する必要はありません。初回は10%の絶対上限と小さい試行配分を使い、今後の勝ち取引が蓄積したら平均利益の半分も検算します。10%を通常の損切り幅として推奨するものではありません。</Typography>}
    <Typography sx={{ fontSize: 13 }}>最大の実現損失 ${number(state.largestClosedLoss)} ／ 平均勝ち利益率を超える負け取引 {state.lossBeyondAverageWinner === null ? '勝ち取引の蓄積待ち' : `${state.lossBeyondAverageWinner.length}件`}。</Typography>
    {state.strategyStats.map(s => <Typography key={s.strategy} sx={{ fontSize: 12 }}>戦略 {s.strategy}：完了{s.count}件・実現損益 ${number(s.realized)}</Typography>)}
    {state.holdings.map(p => <Box key={p.symbol} sx={{ p: 1, my: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}><strong>{p.symbol} · {p.shares}株</strong><Typography sx={{ fontSize: 13 }}>平均取得原価 ${number(p.averageCost)} ／ 評価価格 ${number(p.price)}（{p.markDate}） ／ 含み損益 ${number(p.unrealized)} ／ 残株の逆指値 ${number(p.stop)}</Typography></Box>)}
    {!state.holdings.length && <Typography sx={{ my: 1 }}>保有記録はありません。</Typography>}
    <details style={{ marginTop: 16 }}><summary>取引・評価価格・逆指値を記録する</summary>
      <Typography sx={{ fontSize: 12, my: 1 }}>実際に行った取引を日付順に入力。過去のルール違反も隠さず記録します。記録ボタンは証券注文ではありません。</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
        <TextField select label="記録種類" value={form.type} onChange={e => { changeForm(v => ({ ...v, type: e.target.value })); setProposal(null); }} size="small">{[['buy','買付'],['sell','売却'],['mark','評価価格'],['stop','逆指値更新']].map(([v,l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>
        <TextField label="記録日 YYYY-MM-DD" value={form.date} onChange={e => changeForm(v => ({ ...v, date: e.target.value }))} size="small" />
        <TextField label="日誌の銘柄" value={form.symbol} onChange={e => changeForm(v => ({ ...v, symbol: e.target.value }))} size="small" />
        {form.type === 'buy' && <TextField select label="取引の戦略" size="small" value={form.strategy} onChange={e => changeForm(v => ({ ...v, strategy: e.target.value }))}>{[['minervini','ミネルヴィニ'],['oneil','オニール'],['ibd','IBD型'],['other','その他']].map(([v,l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>}
        {form.type !== 'stop' && <TextField label="取引・評価価格 $" value={form.price} onChange={e => changeForm(v => ({ ...v, price: e.target.value }))} size="small" />}
        {['buy','sell'].includes(form.type) && <><TextField label="記録株数" value={form.shares} onChange={e => changeForm(v => ({ ...v, shares: e.target.value }))} size="small" /><TextField label="手数料 $" value={form.fees} onChange={e => changeForm(v => ({ ...v, fees: e.target.value }))} size="small" /></>}
        {['buy','stop'].includes(form.type) && <TextField label="記録する逆指値 $" value={form.stop} onChange={e => changeForm(v => ({ ...v, stop: e.target.value }))} size="small" />}
        <TextField label="判断・セットアップの記録" value={form.note} onChange={e => changeForm(v => ({ ...v, note: e.target.value }))} multiline size="small" />
        {form.type === 'buy' && <TextField label="セットアップ確認日 YYYY-MM-DD" value={form.setupDate} onChange={e => changeForm(v => ({ ...v, setupDate: e.target.value }))} size="small" />}
      </Box>
      <Button sx={{ mt: 1 }} onClick={addEvent}>実施済みの内容を日誌に記録</Button>
      {form.type === 'buy' && <Box sx={{ mt: 2 }}><Typography component="h4">記録前に買付シナリオを検算</Typography>{[['setupConfirmed','新しいセットアップ・出来高を自分で確認'],['marketConfirmed','当日の市場・先導株を自分で確認'],['earningsConfirmed','決算・イベントを自分で確認'],['reentryConfirmed','再仕掛けは以前と別の新セットアップを確認']].map(([key,label]) => <FormControlLabel key={key} label={label} control={<Checkbox checked={checks[key]} onChange={e => { setChecks(v => ({ ...v, [key]: e.target.checked })); setProposal(null); }} />} />)}<Button onClick={evaluate}>全保有を含めて検算</Button></Box>}
      {proposal && <Box sx={{ my: 1 }}><Typography>計算可能株数の上限 {proposal.maxShares ?? '未確認'}株 ／ 初期逆指値の下限 ${number(proposal.minimumStop)}</Typography>{proposal.errors.map(t => <Alert key={t} severity="warning">{t}</Alert>)}{proposal.unknowns?.map(t => <Alert key={t} severity="info">{t}</Alert>)}{proposal.proposalNumericallySupported && <Typography>自己申告した条件内で数値矛盾は検出されませんでした。発注可能の認定ではありません。</Typography>}</Box>}
    </details>
    <details style={{ marginTop: 16 }}><summary>残株の利益保護・50日線・バックストップ</summary><Typography sx={{ fontSize: 12, my: 1 }}>手入力の終値・50日平均を使う確認欄です。自動取得・注文変更はしません。分割売却後も、残株に記録済みの逆指値は維持します。50日線観測を保存すると、異なる日付の2観測で上昇を確認して原価以上で追随を開始し、その後の線の下落では追随水準を下げません。保存は注文変更ではありません。</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}><TextField select size="small" label="保護する保有銘柄" value={exitInput.symbol} onChange={e => setExitInput(v => ({ ...v, symbol: e.target.value }))}>{state.holdings.map(p => <MenuItem key={p.symbol} value={p.symbol}>{p.symbol}</MenuItem>)}</TextField>{[['close','確認終値 $'],['ma50','50日移動平均 $（任意）'],['backstop','固定利益保護水準 $（任意）'],['previousMa50','前回50日移動平均 $'],['previousMa50Date','前回50日線の日付 YYYY-MM-DD'],['asOfDate','今回終値・50日線の日付 YYYY-MM-DD'],['previousTrailingLevel','既存50日線追随水準 $（開始前は空欄）']].map(([key,label]) => <TextField key={key} label={label} value={exitInput[key]} onChange={e => setExitInput(v => ({ ...v, [key]: e.target.value }))} size="small" />)}</Box><Button onClick={recordMa50}>終値と50日線の観測を日誌に保存</Button>{exitHolding?.ma50Observations?.length > 0 && <Typography sx={{ fontSize: 12 }}>保存済み50日線観測 {exitHolding.ma50Observations.length}件 ／ 保持する追随水準 ${number(exitHolding.ma50TrailingLevel)}</Typography>}{exitResult && (exitResult.valid ? <Typography sx={{ my: 1 }}>停止水準の下限案 ${number(exitResult.stopFloor)} ／ 残株{exitResult.remainingShares} ／ 50日線追随案 ${number(exitResult.ma50TrailingLevel)}（終値判定） ／ 50日線を終値で割れ：{exitResult.ma50CloseExit === null ? '適用未確認' : exitResult.ma50CloseExit ? '該当' : '非該当'}。{exitResult.note} {exitResult.unknowns.join(' / ')}</Typography> : <Alert severity="warning">{exitResult.errors.join(' / ')}</Alert>)}</details>
    <PartialSalePlan state={state} />
    <details style={{ marginTop: 16 }}><summary>緊急時の事前対応</summary><ul>{emergencySteps.map(t => <li key={t}>{t}</li>)}</ul><Typography sx={{ fontSize: 12 }}>書籍の緊急対応・再仕掛けの考え方を整理したものです。連絡先・未約定注文・実際の約定は証券会社で確認してください。</Typography></details>
    <details style={{ marginTop: 16 }}><summary>変更履歴・JSON復元</summary>{state.warnings.map(t => <Alert key={t} severity="warning">{t}</Alert>)}<ol>{journal.events.map(e => <li key={e.id}>{e.date} · {e.symbol} · {e.type} · {e.shares ?? ''} {e.price ?? e.close ?? e.stop}{e.ma50 ? ` / MA50 ${e.ma50}` : ''} · {e.note}</li>)}</ol><TextField fullWidth multiline minRows={3} label="復元する日誌JSON" value={importText} onChange={e => setImportText(e.target.value)} /><Button onClick={() => { try { const next = importJournal(importText); if (next.mode !== journal.mode) throw Error('復元するJSONと実取引・ペーパー区分が異なります。先に区分を切り替えてください。'); save(next); setCapital(String(next.initialCapital)); setImportText(''); } catch (e) { setError(e.message); } }}>検証して現在の日誌を置き換える</Button><Typography sx={{ fontSize: 12 }}>復元前に現在の日誌をJSON保存してください。外部には送信しません。編集内容の監査履歴は自己申告で、改ざん防止された証券記録ではありません。</Typography></details>
  </Box>;
}
