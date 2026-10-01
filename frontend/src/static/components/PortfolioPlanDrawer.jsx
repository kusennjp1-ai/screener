import { useId, useMemo, useState } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import BookRiskWorkbench from './BookRiskWorkbench';
import LocalTradeJournal from './LocalTradeJournal';
import { planConditionDetail, presentPortfolio } from '../portfolioPresentation';
import { SECTORS, sectorKey } from '../sectorDefinitions';
import './portfolioPlan.css';

const money = number => Number.isFinite(number) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : '未確認';
const pct = number => Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : '未確認';
const sectorLabel = sector => SECTORS.find(item => item[0] === sectorKey(sector))?.[1] || '業種未分類';

function PlanPosition({ position, onInspect }) {
  const p = position;
  const titleId = useId();
  return <Box component="article" className="portfolio-position" aria-labelledby={titleId} data-ready={p.fullyReady} sx={{ borderColor: 'divider', bgcolor: 'background.paper' }}>
    <div className="portfolio-position-heading">
      <Typography id={titleId} component="h4" sx={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>{p.symbol}</Typography>
      <Typography component="span" className="portfolio-status" sx={{ color: p.fullyReady ? 'success.main' : 'warning.main', borderColor: 'currentColor' }}>
        {p.fullyReady ? '✓ 日次条件通過' : `未達 ${p.failed} · 未確認 ${p.unknown}`}
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>購入条件 {p.passed}/{p.total}</Typography>
    </div>
    <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>{sectorLabel(p.sector)} · 比率 {pct(p.weight)} · {money(p.cost)}</Typography>
    <dl className="portfolio-price-grid">
      <div><dt>{p.fullyReady ? '試算の買い上限' : '条件成立時の目安'}</dt><dd>{money(p.buy)}</dd></div>
      <div><dt>株数の試算</dt><dd>{p.shares.toLocaleString('en-US')}株</dd></div>
      <div><dt>損切り例</dt><dd className="portfolio-stop">{money(p.stop)}</dd></div>
    </dl>
    {!p.fullyReady && <ul className="portfolio-unmet" aria-label={`${p.symbol} の未達・未確認条件`}>
      {p.unmet.map(rule => <li key={rule.id} data-condition-state={rule.state}>
        <strong>{rule.state === 'fail' ? '×' : '?'} {rule.label} · {rule.state === 'fail' ? '未達' : '未確認'}</strong>
        <span>{planConditionDetail(rule.detail)}</span>
      </li>)}
    </ul>}
    <div className="portfolio-position-secondary">
      <span>共通ピボット <b>{money(p.pivot)}</b></span><span>想定損失 <b>{money(p.loss)}</b></span>
    </div>
    <details className="portfolio-optional"><summary>試算の詳細</summary><p>利確指値の計算例 {money(p.target)}。損切り例は想定買値の−7%、利確例は+20%という既存モデルの機械的な計算です。実際の約定価格で再計算してください。</p></details>
    {onInspect && <Button onClick={() => onInspect(p.symbol)} aria-label={`${p.symbol} の配分根拠を確認`} sx={{ minHeight: 44, fontSize: 14 }}>根拠・チャートを見る →</Button>}
  </Box>;
}

export default function PortfolioPlanDrawer({ plan, open, onClose, onInspect }) {
  const titleId = useId();
  const descriptionId = useId();
  const presentation = useMemo(() => presentPortfolio(plan), [plan]);
  const [journalOpen, setJournalOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const inspect = symbol => { onClose(); onInspect?.(symbol); };
  return <Dialog open={open} onClose={onClose} aria-labelledby={titleId} aria-describedby={descriptionId} maxWidth={false}
    transitionDuration={0} className="portfolio-plan-dialog"
    BackdropProps={{ sx: { backgroundColor: 'var(--scrim)' } }}
    sx={{ '& .MuiDialog-container': { justifyContent: 'flex-end' } }}
    PaperProps={{ className: 'portfolio-plan-drawer', sx: { width: 520, maxWidth: '100%', height: '100dvh', maxHeight: '100dvh', m: 0, borderRadius: 0, borderLeft: '1px solid', borderColor: 'divider', boxShadow: 'none', bgcolor: 'background.default' } }}>
    <DialogTitle component="div" className="portfolio-drawer-title" sx={{ p: { xs: 2, sm: 3 }, pb: 1 }}>
      <Typography component="h2" id={titleId} sx={{ fontSize: 20, fontWeight: 700 }}>配分の試算・未達条件</Typography>
      <IconButton aria-label="配分の試算を閉じる" onClick={onClose} sx={{ minWidth: 44, minHeight: 44, border: '1px solid', borderColor: 'divider', borderRadius: '12px' }}><CloseIcon /></IconButton>
    </DialogTitle>
    <DialogContent sx={{ p: { xs: 2, sm: 3 }, pt: '8px !important' }}>
      <Typography id={descriptionId} sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        新規資金{money(plan.capital)}の未約定モデル。数値は<strong>全条件が成立した場合の試算</strong>です。未達・未確認の条件は合格に数えません。
      </Typography>
      <section aria-label="日次条件をすべて通過" className="portfolio-plan-group">
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 700, mb: 1 }}>日次条件をすべて通過 · {presentation.daily.length}銘柄</Typography>
        {presentation.daily.length ? presentation.daily.map(position => <PlanPosition key={position.symbol} position={position} onInspect={onInspect && inspect} />)
          : <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>該当なし。日次条件の通過が発注・約定を意味するものではありません。</Typography>}
      </section>
      <section aria-label="条件付き（未達あり）" className="portfolio-plan-group">
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 700, mb: 1 }}>条件付き（未達・未確認あり） · {presentation.conditional.length}銘柄</Typography>
        {presentation.conditional.map(position => <PlanPosition key={position.symbol} position={position} onInspect={onInspect && inspect} />)}
        {!presentation.conditional.length && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>該当なし。</Typography>}
      </section>
      {!plan.positions.length && <Typography sx={{ fontSize: 13, my: 2 }}>配分できる候補はありません。条件を緩めて資金を埋めません。</Typography>}
      <Box component="section" aria-label="全条件成立時の試算" className="portfolio-plan-totals" sx={{ borderColor: 'divider' }}>
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 700 }}>全条件成立時の試算</Typography>
        <table><caption>配分金額と想定損失の内訳</caption><thead><tr><th scope="col">区分</th><th scope="col">配分金額</th><th scope="col">想定損失</th></tr></thead>
          <tbody><tr><th scope="row">日次条件通過</th><td>{money(presentation.dailyTotals.cost)}</td><td>{money(presentation.dailyTotals.risk)}</td></tr>
            <tr><th scope="row">条件付き</th><td>{money(presentation.conditionalTotals.cost)}</td><td>{money(presentation.conditionalTotals.risk)}</td></tr>
            <tr><th scope="row">合計</th><td>{money(plan.invested)}</td><td>{money(plan.risk)}</td></tr></tbody></table>
        <Typography sx={{ fontSize: 13 }}>株式 {pct(plan.exposure)} · 残す現金 {money(plan.cash)}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>未約定のため、実際のモデル資金は株式 {pct(plan.executionExposure)}・現金 {money(plan.executionCash)}。</Typography>
      </Box>
      <Typography className="portfolio-model-limits" sx={{ fontSize: 12, color: 'text.secondary', my: 2 }}>上限：市場「{plan.market.label}」で新規 {pct(plan.allocationCap)}、1銘柄10%、1取引の損失0.5%、総損失2%、同一業種20%、最大5銘柄。このモデルは発注・約定を行いません。</Typography>
      <details className="portfolio-optional"><summary>配分ルールと限界</summary>
        <p>ミネルヴィニ・IBD型を通過し、流動性・ピボットから−3〜+5%・形状信頼度70以上・業種情報で絞った既存モデルです。CAN SLIM全条件の合格ではありません。</p>
        <p>現金から始めるため試行配分は最大25%。当日の市場・決算日・出来高・形状を再確認し、ピボット以上の上昇を確認してから買い上限以内で計画します。上限超過を追わず、未約定は当日失効とする試算です。</p>
        <p>逆指値の価格での約定は保証されず、ギャップ・滑りで想定損失を超える場合があります。手数料・税・為替は含みません。既存保有がある場合は全保有と合算して再計算してください。</p>
        {plan.blockers.length > 0 && <ul>{plan.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      </details>
      <details className="portfolio-optional" onToggle={event => setRiskOpen(event.currentTarget.open)}><summary>実績と逆指値の検証</summary>{riskOpen && <BookRiskWorkbench />}</details>
      <details className="portfolio-optional" onToggle={event => setJournalOpen(event.currentTarget.open)}><summary>自分の取引日誌・全保有のリスク</summary>{journalOpen && <LocalTradeJournal />}</details>
    </DialogContent>
  </Dialog>;
}
