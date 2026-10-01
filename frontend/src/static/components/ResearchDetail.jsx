import { memo, forwardRef } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { assess, entryPlan, finite } from '../researchEngine';
import { tradingViewUrl } from '../tradingView';
import ResearchChart from './ResearchChart';
import QualificationVerification from './QualificationVerification';
import QuoteConnection from './QuoteConnection';
import { entryReadiness } from '../entryReadiness';
const METHODS = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール / CAN SLIM', ibd: 'IBD型リーダー' };
const fmt = (v, digits = 1) => finite(v) ? v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const panel = { p: 2.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' };

const ResearchDetail = memo(forwardRef(function ResearchDetail({selected,method,usableQuote,date,market,now,chartEntry,version,onExpand,watch,onWatch,liveStatus,personalKey,personal,onConnect,onDisconnect,verificationSymbol,onVerificationToggle,detail,onVerified}, detailRef) {
 const checks = selected ? assess(selected,method) : null;
 const plan = selected ? entryPlan(selected,usableQuote,method) : null;
 const readiness = selected ? entryReadiness(selected,date,market,now) : null;
 return (
      <div role="region" className="research-detail" ref={detailRef} key={selected?.symbol} tabIndex={-1} aria-label="銘柄詳細">
        {selected && <>
          <Paper className="research-panel">
            <div className="research-symbol-head">
              <Box><Stack direction="row" gap={1.5} alignItems="baseline"><Typography component="h2" sx={{ fontSize: 34, lineHeight: 1.2, fontWeight: 700, fontFamily: 'monospace' }}>{selected.symbol}</Typography><Chip size="small" label={selected.exchange || 'US'} variant="outlined" sx={{ height: 22, borderRadius: 1 }} /></Stack><Typography sx={{ mt: .75, fontSize: 14 }} color="text.secondary">{selected.company_name}</Typography><Typography sx={{ mt: .75, fontSize: 12 }} color="text.secondary">{selected.ibd_industry_group || '業種未確認'}</Typography></Box>
              <div className="research-symbol-price"><Typography sx={{ fontSize: 34, fontWeight: 600, lineHeight: 1.2 }}>${fmt(plan.price, 2)}</Typography><Typography sx={{ fontSize: 13, mt: .75, color: selected.price_change_1d >= 0 ? 'success.main' : 'error.main' }}>{finite(selected.price_change_1d) ? `${selected.price_change_1d >= 0 ? '+' : ''}${fmt(selected.price_change_1d)}% 前日比（日次）` : '前日比未確認'}</Typography><Button size="small" sx={{ mt: .5 }} onClick={() => onWatch(selected.symbol)} aria-pressed={watch.includes(selected.symbol)}>{watch.includes(selected.symbol) ? '★ 保存済み' : '☆ ウォッチ'}</Button></div>
            </div>
            <ResearchChart method={method} quote={usableQuote} date={date} market={market} now={now} row={selected} rsRating={selected.rs_rating} entry={chartEntry} symbol={selected.symbol} generation={version} onExpand={onExpand} />
            <div className="research-metrics">{[['RS 推計', fmt(selected.rs_rating, 0)], ['Composite 推計', fmt(selected.composite_rating, 0)], ['EPS 前年同期比', finite(selected.eps_growth_yy) ? `${fmt(selected.eps_growth_yy)}%` : '—'], ['業種順位 推計', fmt(selected.ibd_group_rank, 0)]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
          </Paper>
          <div className="research-bottom">
            <Paper sx={panel}>
              <div className="research-kicker">選定条件</div><Typography component="h3" sx={{ fontSize: 16, fontWeight: 700, mt: .75 }}>{METHODS[method]}の判定根拠</Typography>
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
              <Stack direction="row" justifyContent="space-between"><div className="research-kicker">価格接続・購入条件</div><Chip size="small" label={liveStatus} color={liveStatus === 'リアルタイム' ? 'success' : 'default'} sx={{ height: 22, fontSize: 12 }} /></Stack>
              <Typography component="h3" sx={{ fontSize: 16, fontWeight: 700, mt: .75 }}>場中価格と詳細条件</Typography>
              <QuoteConnection key={`${selected.symbol}-${Boolean(personalKey)}`} connected={Boolean(personalKey)} apiKey={personalKey} symbol={selected.symbol} cusip={selected.institutional_evidence?.cusip} status={personal.status} quote={personal.quote} onConnect={onConnect} onDisconnect={onDisconnect} />
              <details className="research-disclosure"><summary>買い条件の自動確認：{readiness.passed}/{readiness.total}</summary>
                {readiness.rules.map(rule=><Typography key={rule.id} sx={{fontSize:12,my:1}}>{rule.state==='pass'?'✓':rule.state==='fail'?'×':'?'} {rule.label}：{rule.detail}</Typography>)}
                <Typography sx={{fontSize:12}}>ミネルヴィニ＋IBD型の新規資金モデル。最新の終値で判定し、場中価格の確認とは区別します。形状は自動推定です。</Typography>
              </details>
              <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}><Typography component="h3" variant="subtitle2">チャートの確認ポイント</Typography><Typography sx={{ fontSize: 13, mt: 1 }}>VCP：{selected.vcp_detected == null ? '未確認' : selected.vcp_detected ? '検出' : '未検出'} / 出来高50日平均比：{fmt(selected.se_volume_vs_50d, 2)}倍</Typography><Typography sx={{ fontSize: 13, mt: 1 }}>ベース：{fmt(selected.se_base_length_weeks)}週 / 深さ：{fmt(selected.se_base_depth_pct)}%</Typography></Box>
            </Paper>
          </div>
            <Paper sx={{ ...panel, mt: 2 }}>
              <details className="research-disclosure" onToggle={e=>onVerificationToggle(e.currentTarget.open ? selected.symbol : null)}><summary>詳細検証 — 財務・チャート・書籍の条件</summary>
              {verificationSymbol === selected.symbol && detail.isLoading && <Typography role="status">詳細資料を読み込み中…</Typography>}
              {verificationSymbol === selected.symbol && detail.isError && <Alert severity="error" action={<Button onClick={()=>detail.refetch()}>再試行</Button>}>詳細資料を取得できません。</Alert>}
              {verificationSymbol === selected.symbol && (!selected.research_detail_path || detail.isSuccess) && <QualificationVerification row={selected} entry={chartEntry} date={date} generation={version} method={method} onVerified={onVerified} />}
              </details>
            </Paper>
        </>}
      </div>
 );
}));
export default ResearchDetail;
