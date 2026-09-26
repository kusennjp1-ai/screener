import { buildBookTechnicalEvidence } from './bookTechnicalEvidence.js';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const rule = (label, value, pass, scope = 'measured') => ({ label, value, state: value == null ? 'unknown' : pass(value) ? 'pass' : 'fail', scope });
function monthsBefore(date, count) {
  const d = new Date(date), monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - count, 1));
  const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  monthStart.setUTCDate(Math.min(lastDay, d.getUTCDate())); return monthStart.toISOString().slice(0, 10);
}

// User-selected historical boundaries are observations, never proof of the
// discretionary pattern. No interval is prefilled with an invented good example.
export function reviewBookPattern(row, payload, date, review) {
  const result = { symbol: row?.symbol, as_of_date: date, valid: false, errors: [], rules: [], facts: null, plan: null,
    certification: false, review: null, unknowns: ['実際の需給消化・オーバーヘッドサプライ', '市場環境と個別銘柄の先導性', '次回決算と売買時の価格・流動性'],
    source: { book: '株式トレード 基本と原則', seconds: [439.5, 449.5, 454, 476.5] } };
  const bars = payload?.bars;
  if (!row || !day(date) || payload?.symbol !== row.symbol || payload?.as_of_date !== date || !Array.isArray(bars) || bars.length < 10 ||
    bars.some((b, i) => !b || !day(b.date) || [0, 6].includes(new Date(b.date).getUTCDay()) || b.date > date || (i && b.date <= bars[i - 1].date) ||
      ![b.open, b.high, b.low, b.close].every(n => finite(n) && n > 0) || !finite(b.volume) || b.volume < 0 ||
      b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close)) || bars.at(-1)?.date !== date ||
    !finite(row.current_price) || Math.abs(row.current_price - bars.at(-1)?.close) > Math.max(.02, row.current_price * .0001)) {
    result.errors.push('銘柄・日付・価格が一致する10本以上の有効なOHLCVが必要'); return result;
  }
  if (!review || !['three-c', 'low-cheat', 'power-play', 'vcp'].includes(review.pattern) || typeof review.source !== 'string' || !review.source.trim() ||
    typeof review.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(review.reviewedAt) || !Number.isFinite(Date.parse(review.reviewedAt))) {
    result.errors.push('パターン・確認資料・確認日時を入力してください'); return result;
  }
  if (review.pattern === 'vcp') {
    if (!Array.isArray(review.intervals) || review.intervals.some(i => !i || typeof i !== 'object')) {
      result.errors.push('VCPの開始・終了日を持つ区間配列が必要'); return result;
    }
    const evidence = buildBookTechnicalEvidence(row, payload, date, { review: { source: review.source, reviewedAt: review.reviewedAt,
      intervals: Array.isArray(review.intervals) ? review.intervals.filter(i => i.startDate || i.endDate) : [] } });
    if (!evidence.valid || evidence.vcp.errors.length) {
      result.errors = [...evidence.errors, ...(evidence.vcp?.errors || [])]; return result;
    }
    const vcp = evidence.vcp, last = vcp.legs.at(-1);
    result.valid = true; result.review = { ...review, note: '入力者が指定した収縮区間。成立認定ではない' }; result.vcp = vcp;
    result.facts = { baseDepth: null, cheatDepth: last.depthPct, cheatSessions: last.sessions, dryRatio: null, fundamentalsRequired: true };
    result.rules = [rule('2〜6個の実測可能な収縮区間', vcp.enoughLegs, x => x), rule('高値→後続安値の順序', vcp.measurementsValid, x => x),
      rule('各収縮の深さが順に小さくなる', vcp.depthsContract, x => x), rule('各区間の平均出来高が減少する（代理比較）', vcp.volumeContracts, x => x, 'proxy')];
    result.unknowns.push('最終収縮が現在のピボットであるか、収縮以外の回復区間の需給、ステージは別確認');
    return result;
  }
  const names = ['advanceStart', 'baseStart', 'troughDate', 'cheatStart', 'cheatEnd'];
  const index = Object.fromEntries(names.map(k => [k, bars.findIndex(b => b.date === review[k])]));
  if (Object.values(index).some(i => i < 0) || !(index.advanceStart < index.baseStart && index.baseStart < index.troughDate &&
    index.troughDate <= index.cheatStart && index.cheatStart <= index.cheatEnd)) {
    result.errors.push('上昇起点 → ベース開始 → 底 → チート開始 → 終了の順に実在する日足を指定してください'); return result;
  }
  const breakout = review.breakoutDate ? bars.findIndex(b => b.date === review.breakoutDate) : null;
  if (breakout != null && breakout <= index.cheatEnd) { result.errors.push('ブレイク日はチート終了後の実在する日足が必要'); return result; }
  const tick = review.tickSize == null ? .01 : Number(review.tickSize);
  if (!finite(tick) || tick <= 0) { result.errors.push('正の呼値を指定してください'); return result; }
  result.valid = true;
  result.review = { ...review, note: '入力者による区間指定。自動検出や書籍認定ではない' };
  const base = bars.slice(index.baseStart, index.cheatEnd + 1), cheat = bars.slice(index.cheatStart, index.cheatEnd + 1);
  const impulseEnd = bars[index.baseStart - 1];
  const baseHigh = Math.max(impulseEnd.high, ...base.map(b => b.high)), baseLow = Math.min(...base.map(b => b.low));
  const cheatHigh = Math.max(...cheat.map(b => b.high)), cheatLow = Math.min(...cheat.map(b => b.low));
  const baseDepth = (baseHigh - baseLow) / baseHigh * 100, cheatDepth = (cheatHigh - cheatLow) / cheatHigh * 100;
  const recovery = baseHigh > bars[index.troughDate].low ? (bars[index.cheatStart].close - bars[index.troughDate].low) / (baseHigh - bars[index.troughDate].low) : null;
  const precedingVolume = bars.slice(Math.max(0, index.cheatStart - 50), index.cheatStart);
  const baseline = precedingVolume.length === 50 ? mean(precedingVolume.map(b => b.volume)) : null;
  const dryRatio = baseline > 0 ? mean(cheat.map(b => b.volume)) / baseline : null;
  const evaluationIndex = breakout ?? index.cheatEnd;
  const ma = lag => evaluationIndex + 1 - lag >= 200 ? mean(bars.slice(evaluationIndex - 199 - lag, evaluationIndex + 1 - lag).map(b => b.close)) : null;
  const sma200 = ma(0), sma200Prior21 = ma(21);
  const priorAdvance = (impulseEnd.close / bars[index.advanceStart].close - 1) * 100;
  const impulseSessions = index.baseStart - 1 - index.advanceStart;
  const baseWeeksProxy = base.length / 5;
  const context = review.context || {};
  result.facts = { baseHigh, baseLow, baseDepth, baseWeeksProxy, baseSessions: base.length, cheatHigh, cheatLow, cheatDepth,
    recoveryFraction: recovery, priorAdvancePct: priorAdvance, impulseSessions, cheatSessions: cheat.length, dryRatio,
    sma200, sma200Prior21, evaluationDate: bars[evaluationIndex].date, actualBreakoutHigh: breakout == null ? null : bars[breakout].high,
    lowCheatUpperBoundary: baseLow + (baseHigh - baseLow) / 3, fundamentalsRequired: review.pattern !== 'power-play' };
  result.rules.push(rule('指定した底がベース全体の安値と一致', bars[index.troughDate].low === baseLow, x => x));
  if (review.pattern === 'power-play') {
    result.rules.push(rule('8週以内（40営業日近似）の事前100%以上上昇', priorAdvance, x => x >= 100 - 1e-9 && impulseSessions <= 40),
      rule('通常3〜6週（15〜30営業日近似）の保ち合い', base.length, x => x >= 15 && x <= 30),
      rule('急騰終端高値を含む調整が25%以内', baseDepth, x => x <= 25 + 1e-9));
    result.unknowns.push('急騰時の非常な大商い・後期ステージ除外', '週足終値のタイトさ（10〜12日などの例外は別確認）');
  } else {
    const periodOK = review.advanceStart >= monthsBefore(review.baseStart, 36) && review.advanceStart <= monthsBefore(review.baseStart, 3);
    result.rules.push(rule('3〜36か月の先行上昇が25%以上', priorAdvance, x => x >= 25 && periodOK),
      rule('3〜45週（15〜225営業日近似）のベース', base.length, x => x >= 15 && x <= 225),
      rule('チートの値幅は10%以内', cheatDepth, x => x <= 10 + 1e-9));
    if (review.pattern === 'low-cheat') result.rules.push(rule('チート領域がベース下部3分の1', cheatHigh, x => x <= baseLow + (baseHigh - baseLow) / 3 + 1e-9));
    result.unknowns.push('回復1/3〜1/2、調整15〜40%・時に50%は文脈に応じた目安（60%超は深い調整）');
  }
  result.rules.push(rule('評価時の株価が上向きSMA200より上（履歴がある場合）', sma200 != null && sma200Prior21 != null ? bars[evaluationIndex].close > sma200 && sma200 > sma200Prior21 : null, x => x),
    rule('チート出来高が直前50日平均より少ない（代理比較）', dryRatio, x => x < 1, 'proxy'),
    rule('チート高値を上抜けた日足を確認', breakout == null ? null : bars[breakout].high > cheatHigh, x => x));
  for (const [key, label] of [['stageConfirmed', '目視：初期／後期ステージ'], ['supplyConfirmed', '目視：売り枯れと上値の売り圧力'], ['weeklyTightnessConfirmed', '目視：週足・狭い値幅']]) {
    result.rules.push(rule(label, context[key] === true ? true : null, x => x, 'reviewer-declaration'));
  }
  if (review.pattern === 'low-cheat') {
    const ipoIndex = day(review.ipoDate) ? bars.findIndex(b => b.date === review.ipoDate) : -1;
    result.rules.push(rule('IPO後のベース10営業日以上（IPOの場合）', ipoIndex >= 0 ? index.cheatEnd - Math.max(ipoIndex, index.baseStart) + 1 : null, x => x >= 10));
    result.facts.aboveIpoPrice = finite(review.ipoPrice) && review.ipoPrice > 0 ? cheatLow >= review.ipoPrice : null;
    result.unknowns.push('低いチートは高リスク。IPO価格維持・1〜2本の薄商いのはらみ足は望ましい特徴');
  }
  const entry = Math.round((cheatHigh + tick) * 1e8) / 1e8;
  const stop = Math.round((cheatLow - tick) * 1e8) / 1e8;
  result.plan = stop > 0 ? { entryTriggerExample: entry, structuralStopExample: stop, riskPerShare: entry - stop,
    riskPct: (entry - stop) / entry * 100, tickSize: tick, orderReady: false,
    basis: '指定チート高値＋1呼値／安値−1呼値の計算例。実際の呼値・ギャップ・滑り・決算と許容損失を確認。注文は送信しない' } : null;
  return result;
}
