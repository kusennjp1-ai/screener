import { useMemo, useState } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import BookRiskWorkbench from './BookRiskWorkbench';
import { buildPortfolioPlan } from '../portfolioPlan';

const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const pct = n => `${(n * 100).toFixed(1)}%`;

export default function PortfolioDecision({ rows, date, now, onInspect }) {
  const plan = useMemo(() => buildPortfolioPlan(rows, date, 100000, now), [rows, date, now]);
  const [expanded, setExpanded] = useState(false);
  return <Paper component="section" id="today-decision" tabIndex={-1} aria-label="本日の判断と10万ドルの配分" className="decision-panel" elevation={0}>
    <div className="research-kicker">01 / TODAY → ALLOCATION → RESEARCH</div>
    <div className="decision-overview"><div>
    <Typography component="h2" variant="h5" sx={{ mt: 1, fontWeight: 700 }}>{plan.decision}</Typography>
    <Typography sx={{ mt: 1 }}>本日そのまま発注できる銘柄は未確認です。新規資金10万ドルのモデルは株式0%、現金100%（$100,000）で待機します。</Typography>
    </div><div className="decision-account"><small>MODEL ACCOUNT / 待機資金</small><strong>$100,000</strong><span>株式 0% · 現金 100%</span></div></div>
    <Typography color="text.secondary" sx={{ mt: 1, fontSize: 13 }}>分析基準日：{date} ／ {plan.market.label}。既存保有なし・信用取引なしのモデルです。保有株の売却指示ではありません。</Typography>
    <ul className="decision-blockers">{plan.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <Button variant="outlined" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} aria-controls="conditional-plan">{expanded ? '条件付き計画を閉じる' : `条件付きの配分・注文計画を見る（${plan.positions.length}銘柄）`}</Button>
    {expanded && <Box id="conditional-plan" sx={{ mt: 2 }}>
      <Typography component="h3" variant="h6">確認後のモデル計画 — 発注前</Typography>
      <Typography color="text.secondary" sx={{ fontSize: 13, my: 1 }}>ミネルヴィニ・IBD型の両方を通過し、流動性・ピボットから−3〜+5%・形状信頼度70以上・セクター情報で絞ります。CAN SLIM全条件の合格ではありません。</Typography>
      <div className="decision-totals"><span>試行配分の上限 <strong>{pct(plan.allocationCap)}</strong></span><span>条件付き株式 <strong>{pct(plan.exposure)}</strong></span><span>残す現金 <strong>{money(plan.cash)}</strong></span><span>逆指値で約定した場合の損失 <strong>{money(plan.risk)}</strong></span></div>
      <Typography sx={{ fontSize: 13, my: 1 }}>現金から始めるモデルのため、条件確認後も試行配分は最大25%に制限します。この数値は独自設定です。市場が強いだけでは増額せず、実際のトレード結果を確認します。損失が続くときは資金配分を縮小し、ストップ幅の拡大や含み損への買い増しで補いません。</Typography>
      {!plan.positions.length ? <Typography sx={{ my: 2 }}>配分できる候補はありません。条件を緩めて資金を埋めません。</Typography> : <div className="order-grid">{plan.positions.map(p => <article key={p.symbol} className="order-card">
        <Button onClick={() => onInspect(p.symbol)} aria-label={`${p.symbol} の注文根拠を確認`} sx={{ fontSize: 20, fontWeight: 700 }}>{p.symbol} → 根拠・チャート</Button>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>{p.sector} ／ {p.shares}株 ／ {money(p.cost)}（{pct(p.weight)}）</Typography>
        <dl><dt>上昇確認水準（ピボット）</dt><dd>{money(p.pivot)}</dd><dt>買い指値の上限</dt><dd>{money(p.buy)}</dd><dt>購入後の売り逆指値例</dt><dd>{money(p.stop)}</dd><dt>利確指値の計算例</dt><dd>{money(p.target)}</dd><dt>想定損失額</dt><dd>{money(p.loss)}</dd></dl>
      </article>)}</div>}
      <Typography sx={{ mt: 2, fontSize: 13 }}>注文条件：当日の市場・決算日・出来高とチャートを再確認し、ピボット以上の上昇を確認してから上記上限の買い指値。上限を超えたら追いかけません。未約定は当日失効とし、買えた株数だけに売り注文を設定します。</Typography>
      <Typography sx={{ mt: 1, fontSize: 13 }} color="text.secondary">逆指値は想定買値の−7%、利確は+20%の機械的な例で、構造的支持線や予測価格ではありません。実際の約定価格で再計算が必要です。ギャップ・滑りで損失額を超える場合があります。手数料・税・為替は含みません。</Typography>
      <details><summary>配分ルールと限界</summary><p>1銘柄上限10%、1銘柄損失予算0.5%、総損失予算2%、同一セクター20%、最大5銘柄。市場上限は独自モデル：上昇50%、圧力あり25%、弱含み・不明0%。相関やベータを調整した最適化ではありません。既存保有がある場合はこの新規資金モデルを重ねず、全保有と合算して再計算してください。</p></details>
      <BookRiskWorkbench />
    </Box>}
  </Paper>;
}
