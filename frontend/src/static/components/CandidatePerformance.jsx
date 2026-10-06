import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Typography } from '@mui/material';
import { fetchStaticJson } from '../dataClient';
import { PERFORMANCE_HORIZONS } from '../candidatePerformance';
import { signed } from '../positionGeometry';
const names = { minervini: 'ミネルヴィニ', minervini2: 'ミネルヴィニ 第2方式', oneil: 'オニール / CAN SLIM', ibd: 'IBD型' };

export default function CandidatePerformance({ entry }) {
  const [open, setOpen] = useState(false), [method, setMethod] = useState('minervini'), [cohort, setCohort] = useState('all');
  const ref = entry?.assets?.candidate_performance;
  const query = useQuery({ queryKey: ['candidate-performance', ref?.path, ref?.sha256, entry?.as_of_date], enabled: open && Boolean(ref?.path), staleTime: Infinity, placeholderData: () => undefined,
    queryFn: async () => { const data = await fetchStaticJson(ref.path, { sha256: ref.sha256, worker: true, ...(entry?.publication && { publication: entry.publication }) }); if (data.as_of !== entry.as_of_date) throw Error('Performance date mismatch'); return data; } });
  const data = query.data, summary = cohort === 'all' ? data?.summary?.[method] : data?.cohorts.find(item => item.as_of === cohort)?.methods?.[method];
  return <Box component="details" className="research-performance" onToggle={event => setOpen(event.currentTarget.open)} sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderRadius: '16px', p: 2, '& > summary': { cursor: 'pointer', minHeight: 44, fontSize: 14, fontWeight: 700 }, '& select': { minHeight: 44, maxWidth: '100%', bgcolor: 'background.paper', color: 'text.primary', border: '1px solid', borderColor: 'divider', borderRadius: '8px', fontSize: 13, p: 1 } }}>
    <summary>過去の通過銘柄を検証する · 5 / 20 / 60営業日</summary>
    {!ref ? <Typography sx={{ fontSize: 13 }}>保存済みの成績データはまだありません。記録がない期間は後付けしません。</Typography>
      : query.isError ? <Alert severity="warning">成績データを取得できません。未取得を0%には置き換えません。</Alert>
        : !data ? <Typography role="status" sx={{ fontSize: 13 }}>成績データを読み込み中…</Typography> : <>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>記録開始 {data.history_first_as_of || '初回公開後'} · 計測日 {data.as_of}。最初の騰落率は5営業日を観測してから表示します。</Typography>
          <Alert severity="info" sx={{ mt: 1 }}>起点は分析日の終値です。実際の公開時刻は未確認のため、公開前の値動きが含まれる場合があります。公開後に買えた価格からの運用成績ではありません。</Alert>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, my: 2 }}>
            <label>方式 <select value={method} onChange={event => setMethod(event.target.value)}>{Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>分析日 <select value={cohort} onChange={event => setCohort(event.target.value)}><option value="all">保存した全分析日</option>{data.cohorts.map(item => <option key={item.as_of} value={item.as_of}>{item.as_of}</option>)}</select></label>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0,1fr))' }, gap: 2 }}>
            {PERFORMANCE_HORIZONS.map(horizon => { const result = summary?.[horizon]; return <Box component="section" aria-label={`${horizon}営業日後の成績`} key={horizon} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px', p: 2 }}>
              <Typography component="h3" sx={{ fontSize: 16, fontWeight: 700 }}>{horizon}営業日後</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', my: 1 }}>標本 n={result?.n ?? '—'}（銘柄×分析日） / 対象 {result?.cohort_count ?? '—'}<br />観測日数 {result?.observed_sessions_min ?? '—'}〜{result?.observed_sessions_max ?? '—'}営業日</Typography>
              <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, fontSize: 13, m: 0, '& dd': { m: 0, fontFamily: 'var(--font-mono, monospace)' } }}>
                <dt>騰落率の中央値</dt><dd>{signed(result?.median_return_pct)}</dd><dt>SPYの中央値</dt><dd>{signed(result?.median_spy_return_pct)}</dd><dt>最大下落率の中央値</dt><dd>{signed(result?.median_max_drawdown_pct)}</dd><dt>観測済み標本の上昇割合</dt><dd>{Number.isFinite(result?.win_rate) ? `${(result.win_rate * 100).toFixed(1)}%` : '—'}</dd>
              </Box>
              {(!result || result.sample_insufficient) && <Typography sx={{ fontSize: 12, color: 'warning.main', mt: 1 }}>参考値（標本不足：n &lt; 20）</Typography>}
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>観測待ち {result?.pending ?? '—'} / 欠損・未検証 {result?.unavailable ?? '—'}</Typography>
            </Box>; })}
          </Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 2 }}>中央値・上昇割合は観測済みの標本 n だけで計算します。欠損・未検証も対象数に残しますが、上場廃止などで観測できない銘柄により、集計値が偏る可能性があります。</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 2 }}>{data.definition} 同じ銘柄が別の分析日に通過した場合は別標本です。全分析日の集計は公開当時のルール改定を含みます。</Typography>
        </>}
  </Box>;
}
