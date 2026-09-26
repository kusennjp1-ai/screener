import { tradeEvidence } from './bookRiskPolicy';

export const JOURNAL_VERSION = 1;
export const JOURNAL_STORAGE_KEY = 'screener.local-trade-journal.v1';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const positive = n => finite(n) && n > 0 && n <= 1e9;
const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const symbolOK = s => typeof s === 'string' && /^[A-Z][A-Z0-9.-]{0,14}$/.test(s);
const strategies = ['minervini', 'oneil', 'ibd', 'other', 'unclassified'];
const amount = n => Math.round(n * 1e8) / 1e8;
const upCent = n => Math.ceil(n * 100 - 1e-8) / 100;
const requireThat = (ok, message) => { if (!ok) throw Error(message); };

export function emptyJournal(initialCapital = 100000, mode = 'live') {
  requireThat(positive(initialCapital), '開始資金は正の数値で指定してください。');
  requireThat(['live', 'paper'].includes(mode), '実取引・ペーパーの区分を確認してください。');
  return { version: JOURNAL_VERSION, mode, initialCapital, events: [] };
}

// Import only the known schema. The local journal is declared evidence, not a
// broker feed. Financial-policy violations are recorded, never rewritten away.
export function normalizeJournal(input) {
  requireThat(input && input.version === JOURNAL_VERSION && ['live', 'paper'].includes(input.mode) && positive(input.initialCapital) && Array.isArray(input.events) && input.events.length <= 1000, '取引日誌の形式・取引区分・件数・開始資金を確認してください。');
  const ids = new Set();
  let previousDate = '';
  const events = input.events.map(e => {
    requireThat(e && typeof e.id === 'string' && /^[\w-]{1,80}$/.test(e.id) && !ids.has(e.id), 'イベントIDの重複または形式を確認してください。');
    ids.add(e.id);
    requireThat(day(e.date) && e.date >= previousDate && symbolOK(e.symbol) && ['buy', 'sell', 'mark', 'stop', 'ma50'].includes(e.type), '日付順・銘柄・イベント種類を確認してください。');
    requireThat(input.mode !== 'live' || e.date <= new Date().toISOString().slice(0, 10), '未来日の記録は実取引の実績にできません。ペーパー区分を使用してください。');
    previousDate = e.date;
    requireThat(e.note === undefined || (typeof e.note === 'string' && e.note.length <= 2000), 'メモは2000文字以内です。');
    const event = { id: e.id, date: e.date, type: e.type, symbol: e.symbol, note: e.note || '' };
    if (e.type === 'ma50') {
      requireThat(positive(e.close) && positive(e.ma50), '50日線観測の終値・移動平均を確認してください。');
      event.close = e.close; event.ma50 = e.ma50;
    } else if (e.type === 'stop') {
      requireThat(positive(e.stop), '逆指値を確認してください。');
      event.stop = e.stop;
    } else {
      requireThat(positive(e.price), '価格を確認してください。');
      event.price = e.price;
      if (e.type !== 'mark') {
        requireThat(Number.isSafeInteger(e.shares) && e.shares > 0 && e.shares <= 1e9 && finite(e.fees) && e.fees >= 0 && e.fees <= 1e9, '株数・手数料を確認してください。');
        event.shares = e.shares; event.fees = e.fees;
        if (e.type === 'buy') {
          requireThat(positive(e.stop) && e.stop < e.price, '買付時の初期逆指値は正数で買値未満です。');
          requireThat(e.strategy === undefined || strategies.includes(e.strategy), '戦略区分を確認してください。');
          event.strategy = e.strategy || 'unclassified';
          const setupDate = e.setupDate || null;
          requireThat(setupDate === null || (day(setupDate) && setupDate <= e.date), 'セットアップ確認日は取引日以前の日付で指定してください。');
          event.setupDate = setupDate;
          const confirmations = e.confirmations || {};
          event.confirmations = Object.fromEntries(['setupConfirmed', 'marketConfirmed', 'earningsConfirmed', 'reentryConfirmed'].map(key => [key, confirmations[key] === true]));
          event.stop = e.stop;
        }
      }
    }
    return event;
  });
  return { version: JOURNAL_VERSION, mode: input.mode, initialCapital: input.initialCapital, events };
}

export function deriveJournal(input) {
  const journal = normalizeJournal(input), positions = new Map(), closedTrades = [], warnings = [], equityHistory = [];
  let cash = journal.initialCapital, realized = 0, highWater = cash, maxDrawdown = 0, maxDrawdownPct = 0;
  for (const e of journal.events) {
    let p = positions.get(e.symbol);
    if (e.type === 'buy') {
      const cost = e.shares * e.price + e.fees;
      requireThat(finite(cost) && cost <= cash + 1e-7, '現金を超える買付です。信用取引・外部入出金はこの日誌では未対応です。');
      const previousWinners = closedTrades.filter(t => t.returnPct > 0);
      const previousAverageWin = previousWinners.length ? previousWinners.reduce((sum, t) => sum + t.returnPct, 0) / previousWinners.length : null;
      const entryStopPct = (e.price - e.stop) / e.price * 100;
      if (entryStopPct > Math.min(10, previousAverageWin === null ? 10 : previousAverageWin / 2) + 1e-9) warnings.push(`${e.id}: 当時の実績から求める初期停止幅または10%上限を超過`);
      if (!e.setupDate || !e.note.trim() || !e.confirmations.setupConfirmed) warnings.push(`${e.id}: 当時のセットアップ確認日・根拠の記録が未確認`);
      if (!p) {
        p = { symbol: e.symbol, strategy: e.strategy, shares: 0, costBasis: 0, totalBuyCost: 0, cycleRealized: 0, entryDate: e.date, initialPrice: e.price, initialStop: e.stop, stop: e.stop, peak: e.price, price: e.price, markDate: e.date };
        positions.set(e.symbol, p);
      } else {
        if (e.price <= p.costBasis / p.shares) warnings.push(`${e.id}: 含み益のない追加購入`);
        if (e.stop < p.stop) warnings.push(`${e.id}: 追加購入で逆指値を引下げ`);
        if (e.strategy !== p.strategy) warnings.push(`${e.id}: 保有途中の戦略区分変更（最初の戦略で集計）`);
      }
      cash = amount(cash - cost);
      p.shares += e.shares; p.costBasis += cost; p.totalBuyCost += cost;
      p.stop = e.stop; p.lastBuyDate = e.date;
    } else {
      requireThat(Boolean(p), `${e.symbol} の保有記録がありません。`);
      if (e.type === 'sell') {
        requireThat(e.shares <= p.shares, '保有株数を超える売却です。');
        const basis = p.costBasis * e.shares / p.shares, proceeds = e.shares * e.price - e.fees;
        requireThat(cash + proceeds >= -1e-7, '売却手数料が利用できる資金を超えています。');
        const pnl = proceeds - basis;
        cash = amount(cash + proceeds); realized += pnl; p.cycleRealized += pnl;
        p.costBasis -= basis; p.shares -= e.shares;
        if (!p.shares) {
          closedTrades.push({ symbol: p.symbol, strategy: p.strategy, entryDate: p.entryDate, exitDate: e.date, exitId: e.id, pnl: amount(p.cycleRealized), returnPct: p.cycleRealized / p.totalBuyCost * 100, invested: p.totalBuyCost });
          positions.delete(p.symbol);
        }
      } else if (e.type === 'ma50') {
        const previous = p.ma50Observations?.at(-1);
        requireThat(!previous || e.date > previous.date, '50日線観測は前回より後の日付で記録してください。');
        const risingAboveCost = previous && e.ma50 > previous.ma50 && e.ma50 >= p.costBasis / p.shares;
        if (p.ma50TrailingLevel != null || risingAboveCost) p.ma50TrailingLevel = Math.max(p.ma50TrailingLevel ?? 0, e.ma50, p.stop);
        p.ma50Observations = [...(p.ma50Observations || []), { date: e.date, close: e.close, ma50: e.ma50 }];
      } else if (e.type === 'stop') {
        if (e.stop < p.stop) warnings.push(`${e.id}: 逆指値を前回より引下げ`);
        if (e.stop >= p.price) warnings.push(`${e.id}: 逆指値が直近評価価格以上。約定・注文状態を確認`);
        p.stop = e.stop;
      }
    }
    if (p && e.type !== 'stop') {
      const observedPrice = e.type === 'ma50' ? e.close : e.price;
      p.price = observedPrice; p.markDate = e.date; p.peak = Math.max(p.peak, observedPrice);
    }
    const marketValue = [...positions.values()].reduce((s, holding) => s + holding.shares * holding.price, 0);
    const equity = cash + marketValue;
    requireThat(finite(equity), '資産額の計算範囲を超えています。');
    highWater = Math.max(highWater, equity);
    const drawdown = highWater - equity, drawdownPct = highWater > 0 ? drawdown / highWater * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown); maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    equityHistory.push({ id: e.id, date: e.date, equity: amount(equity), drawdown: amount(drawdown), mixedDates: [...positions.values()].some(h => h.markDate !== e.date) });
  }
  const holdings = [...positions.values()].map(p => ({ ...p, averageCost: p.costBasis / p.shares, marketValue: p.shares * p.price, unrealized: p.shares * p.price - p.costBasis }));
  const marketValue = holdings.reduce((s, p) => s + p.marketValue, 0), equity = cash + marketValue;
  const returns = closedTrades.map(t => t.returnPct);
  // Data outside the calculator's supported return range remains recorded.
  const stats = returns.every(n => finite(n) && n >= -100 && n <= 10000) ? tradeEvidence(returns) : null;
  const lastDate = journal.events.at(-1)?.date ?? null;
  const largestClosedLoss = Math.max(0, ...closedTrades.map(t => -t.pnl));
  const lossBeyondAverageWinner = stats?.averageWin == null ? null : closedTrades.filter(t => -t.returnPct > stats.averageWin).map(t => ({ symbol: t.symbol, exitId: t.exitId, lossPct: -t.returnPct }));
  const strategyStats = [...new Set(closedTrades.map(t => t.strategy))].map(strategy => {
    const trades = closedTrades.filter(t => t.strategy === strategy);
    return { strategy, count: trades.length, realized: amount(trades.reduce((s, t) => s + t.pnl, 0)) };
  });
  return { journal, cash, marketValue, equity, realized: amount(realized), unrealized: amount(marketValue - holdings.reduce((s, p) => s + p.costBasis, 0)), holdings, closedTrades, stats, warnings, equityHistory,
    largestClosedLoss, lossBeyondAverageWinner, strategyStats,
    exposure: equity > 0 ? marketValue / equity : null, lastDate,
    maxDrawdown: amount(maxDrawdown), maxDrawdownPct,
    drawdownBasis: '入力済み取引・評価価格の時点のみ。未記録の日や日中の最大下落は不明',
    marksAligned: holdings.every(p => p.markDate === lastDate), verifiedExternally: false };
}

export function appendJournalEvent(journal, event) {
  const next = normalizeJournal({ ...journal, events: [...journal.events, event] });
  deriveJournal(next); // Validate chronology, holdings and cash before saving.
  return next;
}

export function importJournal(text) {
  requireThat(typeof text === 'string' && text.length <= 2000000, 'JSONは2MB以内です。');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Error('JSONを読み取れません。'); }
  return deriveJournal(parsed).journal;
}
export const exportJournal = journal => JSON.stringify(deriveJournal(journal).journal, null, 2);

export function journalExposurePolicy(state) {
  const stats = state.stats;
  const defensive = Boolean(stats?.defensive) || state.equity < state.journal.initialCapital || state.realized < 0;
  const expansionSupported = !defensive && stats?.positiveTrials === true && state.realized > 0 && state.equity > state.journal.initialCapital;
  // Application limits, not a claim that either book mandates these percentages.
  return { defensive, expansionSupported, totalCap: defensive ? .125 : expansionSupported ? .5 : .25,
    singleCap: defensive ? .05 : expansionSupported ? .125 : .0625,
    riskPerTrade: defensive ? .0025 : .005, portfolioRiskCap: defensive ? .005 : .01, requiresReduction: state.exposure > (defensive ? .125 : expansionSupported ? .5 : .25),
    source: '書籍の成功後拡大・不調時縮小を使った独自の保守的上限。口座の真実性は自己申告' };
}

export function reviewJournalOrder(state, order) {
  const errors = [], unknowns = [];
  if (!order || !symbolOK(order.symbol) || !positive(order.price) || !day(order.date) || order.date < (state.lastDate || '') ||
      !Number.isSafeInteger(order.shares) || order.shares <= 0 || !finite(order.fees) || order.fees < 0) return { valid: false, errors: ['注文シナリオの日付・銘柄・価格・株数・手数料を確認してください。'] };
  const policy = journalExposurePolicy(state), holding = state.holdings.find(p => p.symbol === order.symbol), averageWin = state.stats?.averageWin ?? null;
  const ceiling = averageWin === null ? null : Math.min(10, averageWin / 2);
  const empiricalStopCheck = ceiling === null ? 'not-yet-observed' : 'available';
  // A new journal starts from the book's absolute ceiling and conservative pilot
  // sizing. It does not require fabricated historical winners to begin recording.
  const minimumStop = upCent(order.price * (1 - (ceiling ?? 10) / 100));
  const stop = order.stop;
  if (!positive(stop) || stop >= order.price) return { valid: false, errors: ['逆指値は正数で買値未満にしてください。'] };
  const stopPct = (order.price - stop) / order.price * 100;
  if (stopPct > 10 + 1e-9 || (ceiling !== null && stopPct > ceiling + 1e-9)) errors.push('逆指値幅が実績平均利益の半分または10%を超える');
  const setupDated = day(order.setupDate) && order.setupDate <= order.date;
  if (order.setupConfirmed !== true || !setupDated || typeof order.setupNote !== 'string' || !order.setupNote.trim()) unknowns.push('新しいセットアップ・ピボット・出来高の確認日と記録が必要');
  if (order.marketConfirmed !== true) unknowns.push('当日の市場と先導株の動きが未確認');
  if (order.earningsConfirmed !== true) unknowns.push('決算日・イベントリスクが未確認');
  if (state.holdings.some(p => p.markDate !== order.date)) unknowns.push('全保有銘柄の同日評価価格が揃っていない');
  const lastExit = state.closedTrades.filter(t => t.symbol === order.symbol).at(-1);
  const reentry = !holding && Boolean(lastExit);
  if (reentry && (order.reentryConfirmed !== true || !setupDated || order.setupDate < lastExit.exitDate || !order.setupNote?.trim())) unknowns.push('以前の手仕舞い以後の日付で新セットアップによる再仕掛け確認が必要');
  if (holding && (!setupDated || order.setupDate < holding.lastBuyDate)) unknowns.push('前回買付以後の新しい買い場の確認日が必要');
  if (holding && order.price <= holding.averageCost) errors.push('含み損・損益ゼロの保有への追加購入は不可');
  if (holding && order.price <= holding.price) unknowns.push('直近に記録した評価価格からの再上昇が未確認。新しい買い場の値動きを確認');
  if (holding && stop < holding.stop) errors.push('追加購入で既存逆指値を下げない');
  const cost = order.price * order.shares + order.fees;
  const oldRisk = holding ? Math.max(0, holding.costBasis - holding.stop * holding.shares) : 0;
  const combinedRisk = Math.max(0, (holding?.costBasis || 0) + cost - stop * ((holding?.shares || 0) + order.shares));
  if (holding && combinedRisk > oldRisk + 1e-7) errors.push('追加購入後の元本リスクが増える。停止水準と数量を再検討');
  const currentValue = holding ? holding.shares * order.price : 0;
  const equityAtOrder = state.equity + (holding ? holding.shares * (order.price - holding.price) : 0);
  const otherValue = state.marketValue - (holding?.marketValue || 0);
  const remainingExposure = Math.max(0, equityAtOrder * policy.totalCap - otherValue - currentValue);
  const nameRoom = Math.max(0, equityAtOrder * policy.singleCap - currentValue);
  const otherRisk = state.holdings.filter(p => p.symbol !== order.symbol).reduce((sum, p) => sum + Math.max(0, p.costBasis - p.stop * p.shares), 0);
  const retainedRisk = (holding?.costBasis || 0) - stop * (holding?.shares || 0);
  const riskRoom = Math.max(0, Math.min(equityAtOrder * policy.riskPerTrade, equityAtOrder * policy.portfolioRiskCap - otherRisk) - retainedRisk - order.fees);
  const portfolioRisk = otherRisk + combinedRisk;
  const maxShares = Math.max(0, Math.floor(Math.min((state.cash - order.fees) / order.price, (remainingExposure - order.fees) / order.price, (nameRoom - order.fees) / order.price, riskRoom / (order.price - stop))));
  if (!Number.isSafeInteger(maxShares) || !finite(combinedRisk)) return { valid: false, errors: ['計算範囲を超えています。'] };
  if (order.shares > maxShares || cost > state.cash) errors.push('全保有を合算した現金・配分・損失予算の上限を超える');
  if (portfolioRisk > equityAtOrder * policy.portfolioRiskCap + 1e-7) errors.push('全保有の元本リスクが口座全体の独自損失予算を超える');
  return { valid: true, errors, unknowns, policy, maxShares, minimumStop, stopPct, combinedRisk, portfolioRisk, reentry, empiricalStopCheck,
    proposalNumericallySupported: errors.length === 0 && unknowns.length === 0,
    executable: false, evidence: '自己申告の記録に基づく条件付き計算。現在の価格・書籍の裁量判断の認定ではない' };
}

export function reviewJournalExit(holding, { close, ma50 = null, backstop = null, previousMa50 = null, previousMa50Date = null, asOfDate = null, previousTrailingLevel = null }, stats) {
  if (!holding || !positive(close) || (ma50 !== null && !positive(ma50)) || (backstop !== null && (!positive(backstop) || backstop < holding.averageCost))) return { valid: false, errors: ['終値・50日平均・利益保護水準を確認してください。'] };
  const initialRisk = holding.initialPrice - holding.initialStop;
  const peak = Math.max(holding.peak, close), peakGain = (peak / holding.averageCost - 1) * 100;
  const review2R = peak >= holding.initialPrice + 2 * initialRisk;
  const protect3R = peak >= holding.initialPrice + 3 * initialRisk;
  const protectAverage = stats?.averageWin != null && peakGain >= 2 * stats.averageWin;
  const stopFloor = Math.max(holding.stop, protect3R || protectAverage ? holding.averageCost : 0, backstop ?? 0);
  const unknowns = [];
  const stored = holding.ma50Observations?.at(-1);
  previousMa50 ??= stored?.ma50 ?? null;
  previousMa50Date ||= stored?.date ?? null;
  previousTrailingLevel = Math.max(previousTrailingLevel ?? 0, holding.ma50TrailingLevel ?? 0) || null;
  const datedMa = positive(previousMa50) && day(previousMa50Date) && day(asOfDate) && previousMa50Date < asOfDate && asOfDate >= holding.markDate;
  const previousTrailKnown = previousTrailingLevel === null ? datedMa && previousMa50 < holding.averageCost : positive(previousTrailingLevel) && previousTrailingLevel >= holding.averageCost;
  if (ma50 !== null && (!datedMa || !previousTrailKnown)) unknowns.push('50日線の上昇と過去の追随水準を確認するため、前回値・前回日付・今回日付・既存追随水準が必要（前回線が原価未満なら新規開始）');
  const storedTrail = positive(holding.ma50TrailingLevel);
  const ma50Eligible = storedTrail || (ma50 !== null && datedMa && previousTrailKnown && ((ma50 > previousMa50 && ma50 >= holding.averageCost) || previousTrailingLevel !== null));
  const useCurrentMa = ma50 !== null && datedMa && previousTrailKnown;
  const ma50TrailingLevel = ma50Eligible ? Math.max(stopFloor, useCurrentMa ? ma50 : 0, previousTrailingLevel ?? 0) : null;
  return { valid: true, review2R, protect3R, protectAverage, stopFloor,
    fixedBackstop: backstop, ma50TrailingLevel, unknowns,
    ma50CloseExit: ma50Eligible ? close < ma50TrailingLevel : null,
    ma50Eligible, stopTouched: close <= holding.stop, remainingShares: holding.shares,
    note: '50日線は終値割れ確認。日中逆指値とは別。固定バックストップは利益保護額で指定し自動追随させない。約定は保証しない' };
}
