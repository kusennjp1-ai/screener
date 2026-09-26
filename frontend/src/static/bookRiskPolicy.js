// Book-derived principles, with explicitly separate application parameters.
// These calculations consume declared completed-trade returns, never invented fills.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const MAX_TRADES = 1000;
const validReturn = n => finite(n) && n >= -100 && n <= 10000;
export function parseTradeReturns(text) {
  if (typeof text !== 'string') throw Error('損益率は数値の一覧で入力してください。');
  if (!text.trim()) return [];
  const tokens = text.trim().split(/[\s,、]+/);
  if (tokens.length > MAX_TRADES || tokens.some(t => !/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(t))) throw Error('損益率を古い順に数値で入力してください。');
  const values = tokens.map(t => Number(t.replace('%', '')));
  if (!values.every(validReturn)) throw Error('損益率の範囲を確認してください。');
  return values;
}

export function tradeEvidence(returns = []) {
  if (!Array.isArray(returns) || returns.length > MAX_TRADES || !Array.from(returns).every(validReturn)) throw Error('Invalid completed trade returns');
  const wins = returns.filter(n => n > 0), losses = returns.filter(n => n < 0);
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  let lossStreak = 0;
  for (let i = returns.length - 1; i >= 0 && returns[i] < 0; i--) lossStreak++;
  const winRate = returns.length ? wins.length / returns.length : null;
  const averageWin = mean(wins), averageLoss = mean(losses.map(n => -n));
  // Book 1, recording 116.75s: average winner at least twice average loser.
  // A history without both outcomes cannot verify this realized-payoff rule.
  const rawPayoffRatio = averageWin !== null && averageLoss !== null ? averageWin / averageLoss : null;
  const payoffRatio = finite(rawPayoffRatio) ? rawPayoffRatio : null;
  const payoffState = payoffRatio === null ? 'unknown' : payoffRatio + 1e-9 >= 2 ? 'pass' : 'fail';
  // Equal-trade arithmetic expectancy, not an account return or a forecast.
  const expectancy = mean(returns);
  const positiveTrials = returns.length >= 3 && returns.slice(-3).every(n => n > 0);
  // Sticky reduction: a flat trade or a single small win is not recovery.
  // Three consecutive wins plus positive cumulative mean is an app proxy,
  // not a book-mandated threshold or proof of restored account performance.
  let defensive = false, consecutiveWins = 0, consecutiveLosses = 0, cumulative = 0;
  returns.forEach((r, i) => {
    cumulative += r;
    consecutiveWins = r > 0 ? consecutiveWins + 1 : 0;
    consecutiveLosses = r < 0 ? consecutiveLosses + 1 : 0;
    if (consecutiveLosses >= 2 || (i >= 2 && cumulative <= 0)) defensive = true;
    else if (consecutiveWins >= 3 && cumulative > 0) defensive = false;
  });
  return { count: returns.length, wins: wins.length, losses: losses.length, winRate, averageWin, averageLoss,
    expectancy, payoffRatio, payoffState, payoffMinimum: 2,
    payoffSource: { book: '成長株投資法', recordingSeconds: 116.75 },
    lossStreak, positiveTrials, defensive,
    // Two-times payoff is a book guideline; 10% is a ceiling, not a normal stop.
    stopCeilingPct: averageWin === null ? null : Math.min(10, averageWin / 2),
    phase: defensive ? '縮小' : positiveTrials && expectancy > 0 ? '段階的拡大を検討' : '試行・実績確認',
    // These are scenario limits, never verified account profit or auto allocation.
    evidenceOrigin: 'user-declared-trade-percentages', accountPerformanceVerified: false,
    riskPerTrade: defensive ? .0025 : .005 };
}

function validEvidence(e) {
  if (!e || !Number.isInteger(e.count) || e.count < 0 || e.count > MAX_TRADES ||
      typeof e.defensive !== 'boolean' || e.riskPerTrade !== (e.defensive ? .0025 : .005)) return false;
  if (e.averageWin !== null && (!finite(e.averageWin) || e.averageWin <= 0 || e.averageWin > 10000)) return false;
  return e.stopCeilingPct === (e.averageWin === null ? null : Math.min(10, e.averageWin / 2)) &&
    !(e.count === 0 && e.averageWin !== null);
}

export function reviewPosition(input, evidence) {
  if (!input || typeof input !== 'object' || !validEvidence(evidence)) return { valid: false, errors: ['入力と取引実績の数値を確認してください。'] };
  // Peak must be supplied: falling back to current would erase an earlier trigger.
  const { entry, current, peak, initialStop, currentStop, previousStop, shares = 0, capital = 100000 } = input;
  const errors = [];
  if (![entry, current, peak, initialStop, currentStop, capital].every(n => finite(n) && n > 0) || peak < Math.max(entry, current) || initialStop >= entry ||
      !Number.isSafeInteger(shares) || shares < 0 || (previousStop !== undefined && (!finite(previousStop) || previousStop <= 0))) return { valid: false, errors: ['価格・購入後最高値・初期逆指値・株数を確認してください。'] };
  const initialRisk = entry - initialStop, stopPct = initialRisk / entry * 100;
  const gainPct = (current / entry - 1) * 100, multiple = (current - entry) / initialRisk;
  const peakGainPct = (peak / entry - 1) * 100, peakMultiple = (peak - entry) / initialRisk;
  if (stopPct > 10 + 1e-9) errors.push('初期損切り幅が10%上限を超えています');
  if (evidence.stopCeilingPct !== null && stopPct > evidence.stopCeilingPct + 1e-9) errors.push('初期損切り幅が実績平均利益の半分を超えています');
  if (evidence.averageWin === null) errors.push('平均利益の実績がなく、損切り幅の適合は未確認です');
  if (currentStop < initialStop) errors.push('初期逆指値より損切り幅を広げています');
  if (previousStop !== undefined && currentStop < previousStop) errors.push('前回の逆指値から水準を引き下げています');
  if (currentStop > peak) errors.push('現在の逆指値が入力された購入後最高値を超えています');
  const breakevenRequired = evidence.averageWin !== null && peakGainPct + 1e-9 >= 2 * evidence.averageWin;
  // Book 1 119.25s / book 2 219.50s: begin reviewing protection at 2–3R.
  // This early review is not the stronger 3R or two-times-average-win trigger.
  const twoRProtectionReview = peakMultiple + 1e-9 >= 2;
  const protectionReview = peakMultiple + 1e-9 >= 3 && (evidence.averageWin === null || peakGainPct + 1e-9 >= evidence.averageWin);
  const book1ProtectionReview = peakMultiple + 1e-9 >= 3;
  // Book 1's 3R guidance supports a breakeven review; book 2 also has the
  // stronger two-times-average-win rule. Keep their statuses distinct.
  const stopFloor = Math.max(initialStop, currentStop, previousStop ?? 0, breakevenRequired || book1ProtectionReview ? entry : 0);
  const triggered = current <= currentStop;
  if (breakevenRequired && currentStop < entry) errors.push('平均利益の2倍に到達：少なくとも建値までの利益保護を確認');
  else if (protectionReview && currentStop < entry) errors.push('初期リスクの3倍に到達：建値以上への利益保護を検討');
  else if (book1ProtectionReview && currentStop < entry) errors.push('成長株投資法の3Rに到達：建値保護を確認（基本と原則の平均利益条件は未充足）');
  else if (twoRProtectionReview && currentStop < entry) errors.push('初期リスクの2倍に到達：利益保護を検討（3R・平均利益2倍の条件とは別）');
  const riskBudget = capital * evidence.riskPerTrade;
  const maxShares = Math.floor(Math.min(riskBudget / initialRisk, capital * (evidence.defensive ? .05 : .1) / entry));
  const plannedLoss = shares * initialRisk, protectionLoss = shares * Math.max(0, current - currentStop);
  if (![stopPct, gainPct, multiple, peakGainPct, peakMultiple, riskBudget, plannedLoss, protectionLoss].every(finite) ||
      !Number.isSafeInteger(maxShares)) return { valid: false, errors: ['計算可能な価格・資金・株数の範囲を超えています。'] };
  if (shares > maxShares) errors.push('入力株数が独自モデルの損失予算または1銘柄上限を超えています');
  // valid means calculable input, never an approved order or qualified setup.
  return { valid: true, errors, stopPct, gainPct, multiple, peakGainPct, peakMultiple, stopFloor, triggered, breakevenRequired, protectionReview,
    book1ProtectionReview, twoRProtectionReview,
    twoRProtectionSource: { book: '株式トレード 基本と原則', recordingSeconds: 219.5 },
    averagingDown: current < entry, riskBudget, maxShares,
    plannedLoss, protectionLoss, qualified: false, accountPerformanceVerified: false };
}
