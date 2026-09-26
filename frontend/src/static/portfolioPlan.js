import { assess, finite, snapshotFreshness } from './researchEngine.js';

const centsUp = v => Math.ceil(v * 100 - 1e-8) / 100;
const centsDown = v => Math.floor(v * 100 + 1e-8) / 100;

// Deliberately a disclosed research model, not IBD's proprietary exposure scale.
export function modelMarket(rows) {
  const us = rows.filter(r => r.market === 'US' && r.currency === 'USD');
  const regimes = [...new Set(us.map(r => r.market_regime).filter(Boolean))];
  const observed = us.filter(r => r.market_regime && typeof r.market_above_50dma === 'boolean' && typeof r.market_above_200dma === 'boolean');
  // Market context is replicated on stock rows. Unscanned stocks have no context;
  // do not let those erase known observations, but reject conflicting regimes.
  if (!observed.length || regimes.length !== 1) return { label: '市場未確認', cap: 0 };
  if (observed.some(r => r.market_above_200dma === false)) return { label: '長期トレンド警戒', cap: 0 };
  if (observed.some(r => r.market_above_50dma !== true)) return { label: '市場条件未確認・弱含み', cap: 0 };
  if (regimes[0] === 'confirmed_uptrend') return { label: '上昇トレンド（独自判定）', cap: .5 };
  if (regimes[0] === 'uptrend_under_pressure') return { label: '上昇に圧力（独自判定）', cap: .25 };
  return { label: '新規購入を抑制', cap: 0 };
}

export function buildPortfolioPlan(rows, date, capital = 100000, now = Date.now()) {
  if (!finite(capital) || capital <= 0 || capital > 100000000) throw Error('Invalid model capital');
  const market = modelMarket(rows);
  // This account starts in cash and has no demonstrated trading results.
  // Use a disclosed pilot allocation; market strength alone cannot scale it up.
  const allocationCap = Math.min(market.cap, .25);
  const freshness = snapshotFreshness(date, now);
  // Static scans cannot establish current execution conditions, even with a fresh date.
  const blockers = ['当日の価格・出来高・市場状態が未検証', '決算日とベース形状の最終確認が必要'];
  if (freshness.state !== 'recent' || freshness.days > 1) blockers.unshift('分析基準日を最新の取引日と照合してください');
  if (!market.cap) blockers.unshift(market.label);
  const counts = new Map();
  rows.forEach(r => counts.set(r.symbol, (counts.get(r.symbol) || 0) + 1));
  const candidates = rows.filter(r => {
    if (!r.symbol || counts.get(r.symbol) !== 1 || r.market !== 'US' || r.currency !== 'USD') return false;
    const pivot = r.se_pivot_price;
    return assess(r, 'minervini').qualified && assess(r, 'ibd').qualified &&
      finite(r.adv_usd) && r.adv_usd >= 20000000 && finite(r.current_price) && r.current_price >= 10 &&
      finite(pivot) && pivot > 0 && r.current_price >= pivot * .97 && r.current_price <= pivot * 1.05 &&
      finite(r.se_pattern_confidence) && r.se_pattern_confidence >= 70 &&
      typeof r.gics_sector === 'string' && r.gics_sector.trim().length > 0;
  }).sort((a, b) => b.rs_rating - a.rs_rating || a.symbol.localeCompare(b.symbol));
  const positions = [], sectors = new Map();
  let used = 0, risk = 0;
  for (const row of candidates) {
    if (positions.length === 5) break;
    const buy = centsUp(Math.max(row.current_price, row.se_pivot_price * 1.001));
    if (buy > row.se_pivot_price * 1.05) continue;
    const stop = centsDown(buy * .93);
    const perShareRisk = buy - stop;
    const sector = row.gics_sector.trim();
    const budget = Math.min(capital * .1, capital * allocationCap - used, capital * .2 - (sectors.get(sector) || 0));
    const shares = Math.max(0, Math.floor(Math.min(budget / buy, capital * .005 / perShareRisk, (capital * .02 - risk) / perShareRisk)));
    if (!shares) continue;
    const cost = Math.round(shares * buy * 100) / 100;
    const loss = Math.round(shares * perShareRisk * 100) / 100;
    used += cost; risk += loss; sectors.set(sector, (sectors.get(sector) || 0) + cost);
    positions.push({ symbol: row.symbol, sector, buy, stop, target: centsDown(buy * 1.2), shares, cost, loss, weight: cost / capital, pivot: row.se_pivot_price });
  }
  return { date, capital, market, allocationCap, blockers, positions, candidateCount: candidates.length,
    invested: used, cash: capital - used, exposure: used / capital, risk,
    decision: '新規購入は保留', executionExposure: 0, executionCash: capital };
}
