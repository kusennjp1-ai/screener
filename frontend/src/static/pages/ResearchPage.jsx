import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography, useTheme } from '@mui/material';
import { fetchStaticJson, resolveStaticMarketEntry, useStaticManifest } from '../dataClient';
import { useStaticChartIndex } from '../chartClient';
import StaticChartViewerModal from '../StaticChartViewerModal';
import { assess, compareReference, entryPlan, finite, highDistance, quoteStatus, rankCandidates, researchCsv, snapshotFreshness } from '../researchEngine';
import { tradingViewUrl } from '../tradingView';
import ResearchChart from '../components/ResearchChart';
import PortfolioDecision from '../components/PortfolioDecision';
import QualificationVerification from '../components/QualificationVerification';
import { mergeScanRows } from '../qualificationAudit';
import '../research.css';

const METHODS = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール / CAN SLIM', ibd: 'IBD型リーダー' };
const fmt = (v, digits = 1) => finite(v) ? v.toLocaleString('ja-JP', { maximumFractionDigits: digits }) : '—';
const panel = { p: 2.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' };

export default function ResearchPage() {
  const theme = useTheme();
  const client = useQueryClient();
  const manifest = useStaticManifest();
  const entry = resolveStaticMarketEntry(manifest.data, 'US');
  const version = manifest.data?.generated_at;
  const [method, setMethod] = useState('minervini');
  const [search, setSearch] = useState('');
  const [strict, setStrict] = useState(false);
  const [mobileView, setMobileView] = useState('list');
  const [liquid, setLiquid] = useState(true);
  const detailRef = useRef(null);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [symbol, setSymbol] = useState(null);
  const [chart, setChart] = useState(null);
  const [limit, setLimit] = useState(50);
  const [storageError, setStorageError] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState(null);
  const [watch, setWatch] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem('research-watch') || '[]'); return Array.isArray(value) ? value.filter(s => typeof s === 'string') : []; } catch { return []; }
  });
  const bundle = useQuery({
    placeholderData: () => undefined,
    queryKey: ['researchRows', entry.pages?.scan?.path, version],
    enabled: Boolean(entry.pages?.scan?.path),
    queryFn: async () => {
      const index = await fetchStaticJson(entry.pages.scan.path);
      if (entry.as_of_date && index.as_of_date && entry.as_of_date !== index.as_of_date) throw new Error('Snapshot date mismatch');
      const chunks = await Promise.all((index.chunks || []).map(c => fetchStaticJson(c.path)));
      if (chunks.some(c => c.as_of_date && c.as_of_date !== index.as_of_date)) throw new Error('Mixed snapshot dates');
      return { rows: mergeScanRows([index, ...chunks], index.as_of_date), date: index.as_of_date };
    }, staleTime: 60000,
  });
  const reference = useQuery({ queryKey: ['researchReference', version], queryFn: async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}ibd-reference.json`, { cache: 'no-cache' });
    return response.ok ? response.json() : null;
  }, retry: false });
  const rows = useMemo(() => bundle.data?.rows || [], [bundle.data]);
  const ranked = useMemo(() => rankCandidates(rows, method, { search, qualifiedOnly: strict, watchlist: onlyWatch ? watch : null, liquidOnly: liquid }), [rows, method, search, strict, onlyWatch, watch, liquid]);
  const selected = ranked.find(r => r.row.symbol === symbol)?.row || ranked[0]?.row;
  const checks = selected ? assess(selected, method) : null;
  const index = useStaticChartIndex(entry.assets?.charts?.path);
  const chartEntry = index.data?.symbols?.find(r => r.symbol === selected?.symbol);
  const endpoint = import.meta.env.VITE_RESEARCH_QUOTE_URL;
  const quote = useQuery({ queryKey: ['researchQuote', selected?.symbol], enabled: Boolean(endpoint && selected),
    placeholderData: () => undefined,
    queryFn: async () => {
      const url = new URL(endpoint); url.searchParams.set('symbol', selected.symbol);
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('価格配信に接続できません');
      const result = await response.json();
      if (result.symbol !== selected.symbol || !finite(result.price)) throw new Error('価格データが不正です');
      return result;
    }, refetchInterval: 15000, retry: 1,
  });
  const clock = useQuery({ queryKey: ['researchClock'], queryFn: () => Date.now(), refetchInterval: 15000, initialData: Date.now });
  const liveStatus = quote.isError ? '接続エラー' : quoteStatus(quote.data, clock.data);
  const usableQuote = ['リアルタイム', '遅延データ'].includes(liveStatus) ? quote.data : null;
  const plan = selected ? entryPlan(selected, usableQuote, method) : null;
  const leaders = useMemo(() => rankCandidates(rows, 'ibd', { liquidOnly: true }).filter(r => r.assessment.qualified).slice(0, 50).map(r => r.row), [rows]);
  const overlap = compareReference(leaders, reference.data, bundle.data?.date);
  const age = clock.data - Date.parse(manifest.data?.generated_at);
  const stale = !Number.isFinite(age) || age > 36 * 3600000;
  const freshness = snapshotFreshness(bundle.data?.date || entry.as_of_date, clock.data);
  function toggleWatch(ticker) {
    const next = watch.includes(ticker) ? watch.filter(s => s !== ticker) : [...watch, ticker];
    setWatch(next);
    try { localStorage.setItem('research-watch', JSON.stringify(next)); } catch { setStorageError(true); }
  }
  function inspectOrder(ticker) {
    setMethod('minervini'); setSearch(ticker); setStrict(false); setOnlyWatch(false); setSymbol(ticker); setMobileView('detail');
    focusDetail();
  }
  function applyVerification(ticker, result, date, generation) {
    // Ignore an in-flight result from a replaced daily snapshot.
    if (date !== bundle.data?.date || generation !== version) return;
    client.setQueryData(['researchRows', entry.pages?.scan?.path, version], previous => previous ? {
      ...previous, rows: previous.rows.map(r => r.symbol === ticker ? { ...r, technical_audit: result.audit, book_diagnostics: result.bookDiagnostics, book_technical_evidence: result.bookTechnical } : r),
    } : previous);
    setVerificationNotice(`${ticker}：日足再検証を候補一覧・判定根拠・配分に反映しました。${result.assessment.qualified ? '選定条件を確認。' : '未充足または未確認の条件があります。全条件通過のみでは除外します。'}`);
  }
  function focusDetail() { requestAnimationFrame(() => {
    detailRef.current?.focus?.({ preventScroll: true });
    detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }); }
  function download() {
    const csv = researchCsv(ranked, method, bundle.data?.date);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `research-${method}-${bundle.data?.date || 'unknown'}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <Box component="main" className="research-workbench" data-mobile-view={mobileView} sx={{ '--accent': theme.palette.mode === 'dark' ? '#a399ff' : '#6555dc' }}>
    <header className="research-heading">
      <Box><div className="research-kicker">米国株スクリーナー</div><Typography component="h1" sx={{ fontSize: { xs: 25, md: 30 }, fontWeight: 700, letterSpacing: '-.03em', mt: .5 }}>今日の投資判断</Typography></Box>
      <Stack alignItems="flex-end" gap={.5}><Typography variant="body2" color="text.secondary">日次分析：{bundle.data?.date || entry.as_of_date || '取得中'}</Typography><Button size="small" onClick={() => client.invalidateQueries()}>データを再確認 ↻</Button></Stack>
    </header>
    {bundle.data && !bundle.isError && <PortfolioDecision rows={rows} date={bundle.data.date} now={clock.data} onInspect={inspectOrder} onBrowse={() => { setMobileView('list'); document.getElementById('candidate-search')?.focus(); }} />}
    <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>候補を探す</Typography>
    <div className="research-summary">
      <span>分析対象<strong>{rows.length.toLocaleString()} 銘柄</strong></span>
      <span>条件通過<strong>{ranked.filter(r => r.assessment.qualified).length} 銘柄</strong></span>
      <Typography variant="body2" color="text.secondary" sx={{ ml: { md: 'auto' }, fontSize: 12 }}>公開更新：{manifest.data?.generated_at ? new Date(manifest.data.generated_at).toLocaleString('ja-JP') : '未確認'}</Typography>
    </div>
    {stale && <Alert severity="warning" sx={{ mb: 2 }}>公開データの鮮度を確認してください。選定とチャートは日次データです。</Alert>}
    {bundle.data && freshness.state !== 'recent' && <Alert severity="warning" sx={{ mb: 2 }}>
      {freshness.state === 'old' ? `分析基準日は米国東部の日付から${freshness.days}暦日前です。公開更新が新しくても、分析データが新しいとは限りません。休場日も含む日数です。` : '分析基準日が未確認、または未来の日付です。最新の分析として扱わないでください。'}
    </Alert>}
    <Paper className="research-controls" elevation={0}>
      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} justifyContent="space-between" alignItems={{ md: 'center' }}>
        <ToggleButtonGroup exclusive value={method} onChange={(_, value) => { if (value) { setMethod(value); setLimit(50); } }} aria-label="投資手法" sx={{ flexWrap: 'wrap' }}>
          {Object.entries(METHODS).map(([key, label]) => <ToggleButton key={key} value={key} sx={{ px: 2.5, py: 1, fontSize: 14 }}>{label}</ToggleButton>)}
        </ToggleButtonGroup>
        <TextField id="candidate-search" label="銘柄・企業名を検索" value={search} onChange={e => { setSearch(e.target.value); setLimit(50); }} size="small" sx={{ width: { xs: '100%', md: 260 } }} />
      </Stack>
      <Stack direction="row" flexWrap="wrap" columnGap={2} sx={{ mt: 1 }} alignItems="center">
        <FormControlLabel control={<Switch size="small" checked={strict} onChange={e => setStrict(e.target.checked)} />} label="全条件通過のみ" sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }} />
        <FormControlLabel control={<Switch size="small" checked={onlyWatch} onChange={e => setOnlyWatch(e.target.checked)} />} label="ウォッチのみ" sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }} />
      </Stack>
      <details className="research-disclosure research-options"><summary>表示・保存オプション</summary><Stack direction="row" flexWrap="wrap" alignItems="center" gap={1}>
        <FormControlLabel control={<Switch size="small" checked={liquid} onChange={e => setLiquid(e.target.checked)} />} label="流動性フィルター：株価 $10以上・平均売買代金 $2,000万以上" sx={{ '& .MuiFormControlLabel-label': { fontSize: 12 } }} />
        <Button onClick={download} disabled={!ranked.length} size="small" sx={{ ml: 'auto' }}>CSV保存 ↓</Button>
        <Button component="a" href={`${import.meta.env.BASE_URL}qualification-audit.json`} download size="small">全銘柄の検証記録 ↓</Button>
      </Stack></details>
    </Paper>
    {(manifest.isError || bundle.isError) && <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => client.invalidateQueries()}>再試行</Button>}>データを取得できません。以前の表示値がある場合は最新とは限りません。</Alert>}
    {(manifest.isLoading || bundle.isLoading) && <Box role="status" sx={{ p: 4 }}><CircularProgress size={24} /> 銘柄と分析根拠を読み込んでいます…</Box>}
    {storageError && <Alert severity="warning">ウォッチはこの画面のみ保持されます。端末への保存が制限されています。</Alert>}
    {verificationNotice && <Alert severity="info" onClose={() => setVerificationNotice(null)} sx={{ mb: 2 }}>{verificationNotice}</Alert>}
    <ToggleButtonGroup className="research-mobile-tabs" exclusive value={mobileView} onChange={(_, value) => { if (value) setMobileView(value); if (value === 'detail') focusDetail(); }} fullWidth aria-label="表示パネル">
      <ToggleButton value="list">候補一覧</ToggleButton><ToggleButton value="detail" disabled={!selected}>銘柄分析 {selected?.symbol}</ToggleButton>
    </ToggleButtonGroup>
    <div className="research-grid">
      <Paper className="research-panel research-list">
        <Stack direction="row" sx={{ p: 2 }} justifyContent="space-between" alignItems="center"><Typography component="h2" sx={{ fontSize: 15, fontWeight: 700 }}>候補リスト</Typography><Typography variant="body2" color="text.secondary">{ranked.length.toLocaleString()} 件</Typography></Stack>
        <Typography sx={{ px: 2, pb: 1.5, fontSize: 12, color: 'text.secondary' }}>銘柄を選ぶと、チャートと判定を確認できます。条件数は購入の合格認定ではありません。</Typography>
        <TableContainer sx={{ maxHeight: { xs: 560, md: 'calc(100vh - 350px)' }, minHeight: 200 }}><Table stickyHeader size="small" aria-label="投資手法別の銘柄候補">
          <TableHead><TableRow>{['銘柄 / 株価', '条件', 'RS推計', '高値比'].map(h => <TableCell key={h} sx={{ whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{ranked.slice(0, limit).map(({ row: r, assessment: a }) => <TableRow key={r.symbol} selected={selected?.symbol === r.symbol} hover>
            <TableCell><Button onClick={() => { setSymbol(r.symbol); setMobileView('detail'); focusDetail(); }} aria-label={`${r.symbol} の分析を表示`} sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 17, color: 'text.primary', justifyContent: 'flex-start', p: 0, minHeight: 38 }}>{r.symbol}</Button><Typography sx={{ fontSize: 12, color: 'text.secondary' }}>${fmt(r.current_price, 2)}</Typography></TableCell>
            <TableCell><Chip size="small" color={a.qualified ? 'success' : 'default'} variant="outlined" label={`${a.passed}/${a.total}`} sx={{ borderRadius: 1, height: 24 }} />{a.unknown > 0 && <Typography sx={{ fontSize: 11 }}>未確認 {a.unknown}</Typography>}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{fmt(r.rs_rating, 0)}</TableCell><TableCell>{highDistance(r) == null ? '—' : `${highDistance(r) ? '−' : ''}${fmt(highDistance(r))}%`}</TableCell>
          </TableRow>)}</TableBody></Table></TableContainer>
        {!ranked.length && !bundle.isLoading && <Typography sx={{ p: 3 }}>該当銘柄がありません。検索や「全条件通過のみ」を解除して確認できます。</Typography>}
        {ranked.length > limit && <Button fullWidth onClick={() => setLimit(limit + 50)} sx={{ p: 1.5 }}>次の50件を表示</Button>}
      </Paper>
      <div className="research-detail" ref={detailRef} key={selected?.symbol} tabIndex={-1} aria-label="銘柄詳細">
        {selected && <>
          <Button size="small" onClick={() => { const target = document.getElementById('today-decision'); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start', behavior: 'auto' }); }}>← 本日の配分に戻る</Button>
          <Paper className="research-panel">
            <div className="research-symbol-head">
              <Box><Stack direction="row" gap={1.5} alignItems="baseline"><Typography component="h2" sx={{ fontSize: 32, lineHeight: 1.2, fontWeight: 700, fontFamily: 'monospace' }}>{selected.symbol}</Typography><Chip size="small" label={selected.exchange || 'US'} variant="outlined" sx={{ height: 22, borderRadius: 1 }} /></Stack><Typography sx={{ mt: .75, fontSize: 14 }} color="text.secondary">{selected.company_name}</Typography><Typography sx={{ mt: .75, fontSize: 12 }} color="text.secondary">{selected.ibd_industry_group || '業種未確認'}</Typography></Box>
              <div className="research-symbol-price"><Typography sx={{ fontSize: 30, fontWeight: 600, lineHeight: 1.2 }}>${fmt(plan.price, 2)}</Typography><Typography sx={{ fontSize: 13, mt: .75, color: selected.price_change_1d >= 0 ? 'success.main' : 'error.main' }}>{finite(selected.price_change_1d) ? `${selected.price_change_1d >= 0 ? '+' : ''}${fmt(selected.price_change_1d)}% 前日比（日次）` : '前日比未確認'}</Typography><Button size="small" sx={{ mt: .5 }} onClick={() => toggleWatch(selected.symbol)} aria-pressed={watch.includes(selected.symbol)}>{watch.includes(selected.symbol) ? '★ 保存済み' : '☆ ウォッチ'}</Button></div>
            </div>
            <div className="research-metrics">{[['RS 推計', fmt(selected.rs_rating, 0)], ['Composite 推計', fmt(selected.composite_rating, 0)], ['EPS 前年同期比', `${fmt(selected.eps_growth_yy)}%`], ['業種順位 推計', fmt(selected.ibd_group_rank, 0)]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
            <ResearchChart rsRating={selected.rs_rating} entry={chartEntry} symbol={selected.symbol} generation={version} onExpand={() => setChart(selected.symbol)} />
          </Paper>
          <div className="research-bottom">
            <Paper sx={panel}>
              <div className="research-kicker">選定条件</div><Typography component="h3" sx={{ fontSize: 17, fontWeight: 700, mt: .75 }}>{METHODS[method]}の判定根拠</Typography>
              <Typography sx={{ fontSize: 14, my: 1 }}>適合 {checks.passed} / {checks.total}・未確認 {checks.unknown}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>一次選定の結果です。購入条件は下の詳細検証で確認できます。</Typography>
              <details className="research-disclosure"><summary>条件ごとの結果を見る</summary>
              <ul className="research-rules">{checks.rules.map(r => <li key={r.label}><span>{r.label}{r.evidence && <small style={{ display: 'block' }}>{r.evidence}</small>}</span><Box component="span" sx={{ color: r.state === 'pass' ? 'success.main' : r.state === 'fail' ? 'error.main' : 'text.secondary' }}>{r.state === 'pass' ? '✓ 適合' : r.state === 'fail' ? '× 不適合' : '— 未確認'}{finite(r.value) ? ` · ${fmt(r.value)}${r.unit}` : ''}</Box></li>)}</ul>
              {checks.templateMismatch && <Alert severity="warning">元のテンプレート判定と日足再計算が不一致です。上の再計算結果を選定に使用しています。</Alert>}
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>未確認は合格に数えません。RS・EPS・Composite・業種順位は独自推計です。</Typography>
              {method === 'ibd' && <Typography sx={{ fontSize: 12, mt: 1 }}>公開ルールを参考にした独自の厳格成長スクリーニングです。財務履歴の欠損を推計スコアで補完しません。公式IBDの全条件や選出リストへの合格認定ではありません。</Typography>}
              {method.startsWith('minervini') && <Typography sx={{ fontSize: 12, mt: 1 }}>{method === 'minervini2' ? '書籍②『株式トレード 基本と原則』：安値から25%以上。買い位置は2〜3%以内という記述の上限3%を採用。' : '書籍①『成長株投資法』：安値から30%以上。表示する5%ゾーンはIBD型の補助指標で、書籍の固定条件ではありません。'} 200日線の4〜5か月上昇や高いRSは望ましい特徴で、最低条件とは区別します。</Typography>}
              </details>
              <Button component="a" href={tradingViewUrl(selected.symbol, 'US')} target="_blank" rel="noopener noreferrer" size="small" sx={{ mt: 1.5 }}>TradingView</Button>
            </Paper>
            <Paper sx={panel}>
              <Stack direction="row" justifyContent="space-between"><div className="research-kicker">買い位置の確認</div><Chip size="small" label={liveStatus} color={liveStatus === 'リアルタイム' ? 'success' : 'default'} sx={{ height: 22, fontSize: 12 }} /></Stack>
              <Typography component="h3" sx={{ fontSize: 17, fontWeight: 700, mt: .75 }}>エントリー位置</Typography>
              <Typography sx={{ fontSize: 24, fontWeight: 700, my: 2, color: plan.state === '買いゾーン超過' ? 'warning.main' : 'text.primary' }}>{plan.state}</Typography>
              <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, fontSize: 14, '& dd': { m: 0, textAlign: 'right' } }}><dt>{usableQuote ? '配信価格' : '日次価格'}</dt><dd>${fmt(plan.price, 2)}</dd><dt>推定ピボット</dt><dd>${fmt(plan.pivot, 2)}</dd><dt>ピボット比</dt><dd>{fmt(plan.distance)}%</dd><dt>{plan.zone || 5}%ゾーン上限</dt><dd>${fmt(plan.upper, 2)}</dd><dt>7%損切りの計算例</dt><dd>${fmt(plan.stopExample, 2)}</dd></Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 2 }}>{plan.pivotSource || '未判定'}のピボット。ゾーンは価格位置だけの判定で、出来高・市場環境・ベースの妥当性を保証しません。チャートのVCPトリガーとは計算方式が異なる場合があります。</Typography>
              <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}><Typography component="h3" variant="subtitle2">チャートの確認ポイント</Typography><Typography sx={{ fontSize: 13, mt: 1 }}>VCP：{selected.vcp_detected == null ? '未確認' : selected.vcp_detected ? '検出' : '未検出'} / 出来高50日平均比：{fmt(selected.se_volume_vs_50d, 2)}倍</Typography><Typography sx={{ fontSize: 13, mt: 1 }}>ベース：{fmt(selected.se_base_length_weeks)}週 / 深さ：{fmt(selected.se_base_depth_pct)}%</Typography></Box>
            </Paper>
          </div>
            <Paper sx={{ ...panel, mt: 2 }}>
              <details className="research-disclosure"><summary>詳細検証 — 財務・チャート・書籍の条件</summary>
              <QualificationVerification row={selected} entry={chartEntry} date={bundle.data?.date} generation={version} method={method} onVerified={applyVerification} />
              </details>
            </Paper>
        </>}
      </div>
    </div>
    <footer className="research-method-note">
      <details><summary>補助ビュー</summary><Stack direction="row" gap={2}><Button component="a" href="#/daily">デイリー一覧</Button><Button component="a" href="#/groups">業種ランキング</Button></Stack></details>
      <Typography variant="body2">IBD公式リストとの一致：{overlap ? `${Math.round(overlap.recall * 100)}%` : '未検証'}</Typography>
      <details className="research-disclosure"><summary>選定方式とデータの読み方</summary>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.9 }}>{endpoint ? `価格配信は15秒ごとに確認。配信時刻：${usableQuote?.as_of || '未確認'}。${usableQuote?.feed === 'iex' ? 'IEX取引所のみの価格です。' : ''}` : '場中価格の配信先は未設定です。現在は日次価格で計算しています。'} ピボット・財務条件・チャートは日次です。候補は購入推奨ではありません。</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.9 }}>オニールは前年同期比成長、ミネルヴィニはトレンドテンプレート、IBD型は独自レーティングで比較します。RSは検証できた公開日足の母集団内で、63・126・189・252営業日リターンを40・20・20・20%で加重した順位です。全米株の公式RSとは異なり、未配信銘柄による母集団の偏りがあります。新製品・経営変化・機関投資家の質は個別確認が必要です。IBD公式の選定銘柄・非公開の計算式を再現したものではありません。</Typography>
      <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: 1 }}><Button size="small" component="a" href="https://shop.investors.com/images/promotional/20-Rules_102808.pdf" target="_blank" rel="noopener noreferrer">IBDの公開ルール ↗</Button><Button size="small" component="a" href="https://cdn.minervini.com/static/dist/mtp-review.1f8e8633.pdf" target="_blank" rel="noopener noreferrer">ミネルヴィニの資料 ↗</Button><Button size="small" component="a" href="https://github.com/kusennjp1-ai/screener/issues/new?template=research-feedback.yml" target="_blank" rel="noopener noreferrer">不具合・使い勝手を報告 ↗</Button></Stack>
      </details>
    </footer>
    <StaticChartViewerModal open={Boolean(chart)} onClose={() => setChart(null)} initialSymbol={chart} chartIndex={index.data} navigationSymbols={ranked.map(r => r.row.symbol)} />
  </Box>;
}
