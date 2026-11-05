// Sell-side checks for the daily-brief screens, from certified daily bars: the climax and breakdown
// checks, the book's combined warning, the chart marks and the sell chip. Unknown stays unknown.
import { finite } from '../researchEngine';
import { signed, times } from '../positionGeometry';
import { BREAKOUT_VOLUME_RATIO } from './briefCandidate';

// Sell-side checks after an advance. The ideas (selling into strength on a climax run,
// selling into weakness on a heavy-volume 50-day break) follow Minervini's sell rules;
// every number below is this app's own threshold and is labelled 独自判定 on screen.
export const SELL_RULES = {
  recentSessions: 5,
  advanceMinPercent: 30,
  advanceMinSessions: 20,
  upDaysWindow: 10,
  upDaysMin: 8,
  climaxPercent: 25,
  climaxSessions: 15,
  breakVolumeRatio: BREAKOUT_VOLUME_RATIO,
};

/**
 * Sell checks for the latest bars. Each check is 'hit', 'clear', 'unknown' (an input is
 * missing) or 'na' (no advance to judge). Returns null when the bars cannot be judged.
 */
export function sellSignals(bars, rules = SELL_RULES) {
  const list = (bars || []).slice(-252);
  if (list.length < 60 || list.some(b => !finite(b?.close) || !finite(b?.low) || b.close <= 0 || b.low <= 0)) return null;
  const n = list.length, recent = n - rules.recentSessions, last = list[n - 1];
  let start = 0;
  for (let i = 1; i < n; i++) if (list[i].low < list[start].low) start = i;
  const advance = { startDate: list[start].date, low: list[start].low, gainPct: (last.close / list[start].low - 1) * 100, sessions: n - 1 - start };
  const inAdvance = advance.gainPct >= rules.advanceMinPercent && advance.sessions >= rules.advanceMinSessions;
  const change = i => (list[i].close / list[i - 1].close - 1) * 100;
  const na = (key, label) => ({ key, label, state: 'na', detail: `起点（直近1年の安値）から +${rules.advanceMinPercent}%・${rules.advanceMinSessions}営業日以上の上昇局面でのみ判定` });
  const strength = [], weakness = [];

  if (inAdvance) {
    let up = start + 1, down = start + 1, week = null;
    for (let i = start + 1; i < n; i++) { if (change(i) > change(up)) up = i; if (change(i) < change(down)) down = i; }
    for (let j = start + 5; j < n; j++) { const v = (list[j].close / list[j - 5].close - 1) * 100; if (!week || v > week.v) week = { j, v }; }
    strength.push({ key: 'day-up', label: '起点以来で最大の1日の上昇', date: list[up].date, state: up >= recent && change(up) > 0 ? 'hit' : 'clear', detail: `最大は ${list[up].date} の ${signed(change(up))}` });
    strength.push(week ? { key: 'week-up', label: '起点以来で最大の5営業日の上昇', date: list[week.j].date, state: week.j >= recent && week.v > 0 ? 'hit' : 'clear', detail: `最大は ${list[week.j].date} までの ${signed(week.v)}` } : na('week-up', '起点以来で最大の5営業日の上昇'));
    const span = Array.from({ length: rules.upDaysWindow }, (_, k) => n - rules.upDaysWindow + k).filter(i => i > 0);
    const ups = span.filter(i => change(i) > 0).length;
    strength.push({ key: 'up-days', label: `直近${rules.upDaysWindow}営業日のうち${rules.upDaysMin}日以上が上昇`, date: last.date, state: ups >= rules.upDaysMin ? 'hit' : 'clear', detail: `上昇 ${ups}日 / ${span.length}日` });
    const base = Math.min(...list.slice(Math.max(start, n - 1 - rules.climaxSessions), n - 1).map(b => b.close));
    const run = (last.close / base - 1) * 100;
    strength.push({ key: 'climax', label: `${rules.climaxSessions}営業日以内に +${rules.climaxPercent}%以上の急騰`, date: last.date, state: run >= rules.climaxPercent ? 'hit' : 'clear', detail: `直近${rules.climaxSessions}営業日の最安終値から ${signed(run)}` });
    weakness.push({ key: 'day-down', label: '起点以来で最大の1日の下落', date: list[down].date, state: down >= recent && change(down) < 0 ? 'hit' : 'clear', detail: `最大は ${list[down].date} の ${signed(change(down))}` });
  } else {
    for (const [key, label] of [['day-up', '起点以来で最大の1日の上昇'], ['week-up', '起点以来で最大の5営業日の上昇'], ['up-days', `直近${rules.upDaysWindow}営業日のうち${rules.upDaysMin}日以上が上昇`], ['climax', `${rules.climaxSessions}営業日以内に +${rules.climaxPercent}%以上の急騰`]]) strength.push(na(key, label));
    weakness.push(na('day-down', '起点以来で最大の1日の下落'));
  }

  // A close that crosses below the 50-day SMA on at least 1.4x the prior 50-day average volume.
  const sma = i => { let s = 0; for (let k = i - 49; k <= i; k++) s += list[k].close; return s / 50; };
  const breakLabel = `出来高を伴う50日線割れ（${times(rules.breakVolumeRatio)}以上）`;
  // n >= 60, so every recent session has 50 prior sessions for both averages.
  let found = null, missing = false;
  for (let i = Math.max(recent, 50); i < n; i++) {
    if (!(list[i].close < sma(i) && list[i - 1].close >= sma(i - 1))) continue;
    const prior = list.slice(i - 50, i).map(b => b.volume);
    if (!finite(list[i].volume) || prior.some(v => !finite(v))) { missing = true; continue; }
    const ratio = list[i].volume / (prior.reduce((a, b) => a + b, 0) / 50);
    if (ratio >= rules.breakVolumeRatio) found = { date: list[i].date, ratio };
  }
  const position = (last.close / sma(n - 1) - 1) * 100;
  weakness.push(found ? { key: 'ma50', label: breakLabel, date: found.date, state: 'hit', detail: `${found.date} 出来高 ${times(found.ratio)}` }
    : { key: 'ma50', label: breakLabel, state: missing ? 'unknown' : 'clear', detail: missing ? '割れた日の出来高が未取得' : `終値は50日線から ${signed(position)}` });
  return { advance: inAdvance ? advance : null, strength, weakness, hits: [...strength, ...weakness].filter(c => c.state === 'hit').length };
}

/**
 * The book's combined warning (diagnoseBookChart.priceWarnings: below the 20-day line, three
 * lower lows and heavy volume) as one more weakness check, so both screens judge it the same way.
 */
export function bookWarningCheck(diagnostics) {
  const label = '20日線割れ・3日連続の安値切り下げ・大商い（書籍の複合警告）';
  const w = diagnostics?.valid ? diagnostics.priceWarnings : null;
  if (!w) return { key: 'book', label, state: 'unknown', detail: '検証済みの日足による書籍診断が未取得' };
  const parts = [`20日線${w.below20 ? '割れ' : 'の上'}`, `3日連続の安値切り下げ ${w.threeLowerLows ? 'あり' : 'なし'}`, `出来高 ${finite(w.currentVolumeRatio) ? times(w.currentVolumeRatio) : '未確認'}`];
  if (w.combinedWarning === true && w.recoveryInUpperHalf) parts.push('引けは値幅の上半分（買い支えを確認）');
  return { key: 'book', label, date: diagnostics.as_of_date, state: w.combinedWarning === true ? 'hit' : w.combinedWarning === false ? 'clear' : 'unknown', detail: parts.join('・') };
}

/** Sell checks plus the book's combined warning; null stays null. */
export function withBookWarning(sells, diagnostics) {
  if (!sells) return null;
  const weakness = [...sells.weakness, bookWarningCheck(diagnostics)];
  return { ...sells, weakness, hits: [...sells.strength, ...weakness].filter(c => c.state === 'hit').length };
}

/** Dates with a sell signal, for chart marks: 'strength' (climax) or 'weakness' (breakdown). */
export function sellMarks(sells) {
  if (!sells) return [];
  const marks = new Map();
  for (const [kind, checks] of [['strength', sells.strength], ['weakness', sells.weakness]]) {
    for (const check of checks) if (check.state === 'hit' && typeof check.date === 'string' && !marks.has(check.date)) marks.set(check.date, kind);
  }
  return [...marks].map(([date, kind]) => ({ date, kind })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Every sell check one stock gets: the checks on its certified bars (`judged`, or null) plus the book's
 * combined warning. Null when the bars cannot be judged. `view` is the candidate (step 0: not read).
 */
export function stockSells({ judged, diagnostics, view }) {
  void view;
  return withBookWarning(sellSignals(judged), diagnostics);
}

/**
 * The sell chip a list row, a Today watch row or the stock conclusion shows for a sell result:
 * { text, tone, title } or null (nothing to say). A result that could not be checked carries its reason
 * as the title; callers draw the ▲ glyph for tone 'ext'.
 */
export function sellChipView(sell) {
  if (sell?.hits) return { text: `売りのサイン ${sell.hits}件`, tone: 'ext', title: undefined };
  if (sell?.unknown) return { text: '売りのサイン 未確認', tone: '', title: sell.reason || undefined };
  return null;
}
