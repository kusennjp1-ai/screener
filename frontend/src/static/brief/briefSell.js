// Sell-side checks for the daily-brief screens, from certified daily bars: the climax and breakdown
// checks, the book's combined warning, the chart marks and the sell chip. Unknown stays unknown.
import { finite } from '../researchEngine';
import { signed, times } from '../positionGeometry';
import { BREAKOUT_VOLUME_RATIO } from './briefCandidate';
import { shortDate } from './briefShared';

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
  // The strength (climax) checks judge only a stock that is extended: beyond the buy zone and at least
  // this far above its pivot (独自判定, shown on screen). Below it a breakout's own big day is a buy point.
  climaxFromPivotPercent: 20,
};

const STRENGTH = [
  ['day-up', '起点以来で最大の1日の上昇（直近5営業日）'],
  ['week-up', '起点以来で最大の5営業日の上昇（直近5営業日）'],
  ['up-days', rules => `直近${rules.upDaysWindow}営業日のうち${rules.upDaysMin}日以上が上昇`],
  ['climax', rules => `${rules.climaxSessions}営業日以内に +${rules.climaxPercent}%以上の急騰`],
];
const label = (entry, rules) => typeof entry === 'function' ? entry(rules) : entry;
const ratioText = ratio => `${ratio.toFixed(1)}倍`;

/**
 * Whether the strength checks may run for this stock today, and from where. They run only when the
 * stock is beyond the buy zone (`view.state === 'ext'`) and its close is at least
 * `rules.climaxFromPivotPercent` above the pivot. Their origin is the start of the current run of closes
 * above that pivot (dated breakouts come later). Otherwise they are 'na' with the reason.
 */
function climaxGate(list, view, rules) {
  const pivot = view?.pivot, distance = view?.distance;
  if (!view || !finite(distance) || !finite(pivot) || pivot <= 0) return { on: false, reason: 'ピボット比が未確認のため判定しません' };
  if (view.state === 'wait' || distance < 0) return { on: false, reason: 'ピボットより下（ブレイク前）のため判定しません' };
  if (view.state !== 'ext' || distance < rules.climaxFromPivotPercent) return { on: false, reason: `ブレイク後の上昇が小さいため判定しません（ピボット比 ${signed(distance)}・判定は +${rules.climaxFromPivotPercent}%以上）` };
  const n = list.length;
  if (!(list[n - 1].close > pivot)) return { on: false, reason: '日足の終値がピボットを上回っていないため判定しません' };
  let origin = n - 1;
  while (origin > 0 && list[origin - 1].close > pivot) origin--;
  return { on: true, origin, pivot, distance };
}

/**
 * The 50-day line as a state, not an event. Below the line, the break day is the session after the last
 * close at or above it (within the bars given, up to 252): 'hit' when that day traded at least
 * `rules.breakVolumeRatio` times the prior 50-day average volume, 'caution' when it traded less or when no
 * close above the line is found, 'unknown' when its volume (or the 50 before it) is missing. Back above the
 * line: 'clear'.
 */
function ma50State(list, rules) {
  const n = list.length;
  const sma = i => { let s = 0; for (let k = i - 49; k <= i; k++) s += list[k].close; return s / 50; };
  const base = { key: 'ma50', label: `出来高を伴う50日線割れ（${ratioText(rules.breakVolumeRatio)}以上）` };
  const line = sma(n - 1), position = (list[n - 1].close / line - 1) * 100;
  if (list[n - 1].close >= line) return { ...base, state: 'clear', detail: `終値は50日線から ${signed(position)}` };
  let above = -1;
  for (let i = n - 2; i >= 49; i--) if (list[i].close >= sma(i)) { above = i; break; }
  if (above < 0) return { ...base, state: 'caution', detail: `50日線の下（直近${n - 49}営業日に50日線より上の終値なし・大商いの割れは未確認）・終値は50日線から ${signed(position)}` };
  const at = above + 1, sessions = n - at, day = shortDate(list[at].date, list[n - 1].date);
  const prior = at >= 50 ? list.slice(at - 50, at).map(bar => bar.volume) : [];
  const average = prior.length === 50 && prior.every(finite) ? prior.reduce((a, b) => a + b, 0) / 50 : null;
  if (!finite(list[at].volume) || !(average > 0)) return { ...base, date: list[at].date, state: 'unknown', detail: `${day} に50日線を割れ、以降50日線の下（${sessions}営業日）。割れた日の出来高（または直前50日の出来高）が未取得` };
  const ratio = list[at].volume / average;
  if (ratio >= rules.breakVolumeRatio) return { ...base, date: list[at].date, ratio, sessions, state: 'hit', detail: `${day} に出来高 ${ratioText(ratio)}で割れ、以降50日線の下（${sessions}営業日）` };
  return { ...base, date: list[at].date, ratio, sessions, state: 'caution', detail: `50日線の下（大商いの割れは未確認）・${day} に出来高 ${ratioText(ratio)}で割れ、以降${sessions}営業日` };
}

/**
 * Sell checks for the latest bars. Each check is 'hit', 'clear', 'caution' (the 50-day line only: below
 * it without a confirmed heavy-volume break), 'unknown' (an input is missing) or 'na' (not judged, with
 * the reason). `view` (the candidate: state, pivot, distance) gates the strength checks; without it they
 * are 'na'. Returns null when the bars cannot be judged.
 */
export function sellSignals(bars, rules = SELL_RULES, { view = null } = {}) {
  const list = (bars || []).slice(-252);
  if (list.length < 60 || list.some(b => !finite(b?.close) || !finite(b?.low) || b.close <= 0 || b.low <= 0)) return null;
  const n = list.length, recent = n - rules.recentSessions, last = list[n - 1];
  const change = i => (list[i].close / list[i - 1].close - 1) * 100;

  // The weakness side keeps its advance: from the lowest low of the last year.
  let start = 0;
  for (let i = 1; i < n; i++) if (list[i].low < list[start].low) start = i;
  const advance = { startDate: list[start].date, low: list[start].low, gainPct: (last.close / list[start].low - 1) * 100, sessions: n - 1 - start };
  const inAdvance = advance.gainPct >= rules.advanceMinPercent && advance.sessions >= rules.advanceMinSessions;

  const strength = [], weakness = [];
  const gate = climaxGate(list, view, rules);
  const na = (key, text, detail) => ({ key, label: text, state: 'na', detail });
  if (gate.on) {
    const o = gate.origin;
    let up = null, week = null;
    for (let i = o + 1; i < n; i++) if (up === null || change(i) > change(up)) up = i;
    for (let j = Math.max(o + 5, 5); j < n; j++) { const v = (list[j].close / list[j - 5].close - 1) * 100; if (!week || v > week.v) week = { j, v }; }
    const short = '起点以降の日足が不足のため判定しません';
    strength.push(up === null ? na('day-up', label(STRENGTH[0][1], rules), short)
      : { key: 'day-up', label: label(STRENGTH[0][1], rules), date: list[up].date, state: up >= recent && change(up) > 0 ? 'hit' : 'clear', detail: `最大は ${list[up].date} の ${signed(change(up))}` });
    strength.push(week ? { key: 'week-up', label: label(STRENGTH[1][1], rules), date: list[week.j].date, state: week.j >= recent && week.v > 0 ? 'hit' : 'clear', detail: `最大は ${list[week.j].date} までの ${signed(week.v)}` }
      : na('week-up', label(STRENGTH[1][1], rules), short));
    const span = Array.from({ length: rules.upDaysWindow }, (_, k) => n - rules.upDaysWindow + k).filter(i => i > 0);
    const ups = span.filter(i => change(i) > 0).length;
    strength.push({ key: 'up-days', label: label(STRENGTH[2][1], rules), date: last.date, state: ups >= rules.upDaysMin ? 'hit' : 'clear', detail: `上昇 ${ups}日 / ${span.length}日` });
    const window = list.slice(Math.max(o, n - 1 - rules.climaxSessions), n - 1).map(b => b.close);
    if (window.length) {
      const run = (last.close / Math.min(...window) - 1) * 100;
      strength.push({ key: 'climax', label: label(STRENGTH[3][1], rules), date: last.date, state: run >= rules.climaxPercent ? 'hit' : 'clear', detail: `直近${rules.climaxSessions}営業日（起点以降）の最安終値から ${signed(run)}` });
    } else strength.push(na('climax', label(STRENGTH[3][1], rules), short));
  } else for (const [key, text] of STRENGTH) strength.push(na(key, label(text, rules), gate.reason));

  if (inAdvance) {
    let down = start + 1;
    for (let i = start + 1; i < n; i++) if (change(i) < change(down)) down = i;
    weakness.push({ key: 'day-down', label: '起点以来で最大の1日の下落（直近5営業日）', date: list[down].date, state: down >= recent && change(down) < 0 ? 'hit' : 'clear', detail: `最大は ${list[down].date} の ${signed(change(down))}` });
  } else weakness.push(na('day-down', '起点以来で最大の1日の下落（直近5営業日）', `起点（直近1年の安値）から +${rules.advanceMinPercent}%・${rules.advanceMinSessions}営業日以上の上昇局面でのみ判定`));
  weakness.push(ma50State(list, rules));

  const run = gate.on ? { startDate: list[gate.origin].date, startClose: list[gate.origin].close, pivot: gate.pivot, distance: gate.distance, sessions: n - 1 - gate.origin } : null;
  return tally({ advance: inAdvance ? advance : null, run, runReason: gate.on ? null : gate.reason, strength, weakness });
}

/** The counts every caller reads: all hits (the sell card), the weakness side (the watch's 注意) and the strength side. */
function tally(sells) {
  const hit = checks => checks.filter(c => c.state === 'hit').length;
  const strengthHits = hit(sells.strength), weaknessHits = hit(sells.weakness);
  return { ...sells, hits: strengthHits + weaknessHits, strengthHits, weaknessHits, cautions: sells.weakness.filter(c => c.state === 'caution').length };
}

/**
 * The book's combined warning (diagnoseBookChart.priceWarnings: below the 20-day line, three
 * lower lows and heavy volume) as one more weakness check, so both screens judge it the same way.
 */
export function bookWarningCheck(diagnostics) {
  const text = '20日線割れ・3日連続の安値切り下げ・大商い（書籍の複合警告）';
  const w = diagnostics?.valid ? diagnostics.priceWarnings : null;
  if (!w) return { key: 'book', label: text, state: 'unknown', detail: '検証済みの日足による書籍診断が未取得' };
  const parts = [`20日線${w.below20 ? '割れ' : 'の上'}`, `3日連続の安値切り下げ ${w.threeLowerLows ? 'あり' : 'なし'}`, `出来高 ${finite(w.currentVolumeRatio) ? times(w.currentVolumeRatio) : '未確認'}`];
  if (w.combinedWarning === true && w.recoveryInUpperHalf) parts.push('引けは値幅の上半分（買い支えを確認）');
  return { key: 'book', label: text, date: diagnostics.as_of_date, state: w.combinedWarning === true ? 'hit' : w.combinedWarning === false ? 'clear' : 'unknown', detail: parts.join('・') };
}

/** Sell checks plus the book's combined warning; null stays null. */
export function withBookWarning(sells, diagnostics) {
  if (!sells) return null;
  return tally({ ...sells, weakness: [...sells.weakness, bookWarningCheck(diagnostics)] });
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
 * combined warning. Null when the bars cannot be judged. `view` (the candidate) gates the strength checks.
 */
export function stockSells({ judged, diagnostics, view }) {
  return withBookWarning(sellSignals(judged, SELL_RULES, { view }), diagnostics);
}

/** A watched stock's 50-day check when it fired (its detail leads the watch row), else null. */
export const ma50Hit = sells => sells?.weakness?.find(check => check.key === 'ma50' && check.state === 'hit') || null;

/** Weakness signals: a broken buy setup for a stock not held, a sell signal for one held (独自判定). */
export const WEAKNESS_CHIP = '買いの前提が崩れた／保有なら売りのサイン（独自判定）';
/** Strength (climax) signals mean something only for a holding, and no holding is registered. */
export const HOLDING_CHIP = '保有している場合の売りのサイン（保有未登録）';

/**
 * The sell chip a list row, a Today watch row or the stock conclusion shows for a sell result:
 * { text, tone, title } or null (nothing to say). Weakness hits come first ('ext', drawn with ▲); climax
 * hits alone are a holding's signal and stay neutral; a 50-day caution is 'wait'. A result that could not
 * be checked says so, with the 12-stock limit as visible text and any other reason as the title.
 * A result without the strength/weakness split (an older shape) keeps the plain count.
 */
export function sellChipView(sell) {
  if (!sell) return null;
  if (sell.unknown) return { text: `売りのサイン 未確認${sell.limit ? `（上限${sell.limit}銘柄）` : ''}`, tone: '', title: sell.reason || undefined };
  const fired = checks => (checks || []).filter(c => c.state === 'hit').map(c => c.label).join('・');
  if (!Array.isArray(sell.weakness)) return sell.hits ? { text: `売りのサイン ${sell.hits}件`, tone: 'ext', title: undefined } : null;
  if (sell.weaknessHits) return { text: WEAKNESS_CHIP, tone: 'ext', title: fired(sell.weakness) };
  if (sell.strengthHits) return { text: HOLDING_CHIP, tone: '', title: fired(sell.strength) };
  const caution = sell.weakness.find(c => c.state === 'caution');
  if (caution) return { text: '50日線の下（大商いの割れは未確認）', tone: 'wait', title: caution.detail };
  return null;
}
