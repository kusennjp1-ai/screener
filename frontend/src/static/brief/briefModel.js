// Pure view model for the daily-brief screens. Every value comes from the
// published research rows and the existing rule functions; unknown stays unknown.
import { assess, entryPlan, finite, highDistance } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { signed, stateKey, STATES, times } from '../positionGeometry';
import { verifiedVolumeRatio } from '../qualificationAudit';

export const STOP_DEFAULT_PERCENT = 7;
export const STOP_MAX_PERCENT = 10;
export const BREAKOUT_VOLUME_RATIO = 1.4;
const ZONE_RANK = { zone: 0, wait: 1, ext: 3, low: 4, acq: 5, na: 6 };
const DAY = 86400000;

/** Trend-template rows (8 price/RS conditions) and the integrity rule, from the shared rule function. */
export function trendTemplate(row, now = Date.now()) {
  const result = assess(row, 'minervini', now);
  const rules = result.rules.slice(0, 8);
  return {
    rules,
    integrity: result.rules[8],
    passed: rules.filter(rule => rule.state === 'pass').length,
    failed: rules.filter(rule => rule.state === 'fail').length,
    unknown: rules.filter(rule => rule.state !== 'pass' && rule.state !== 'fail').length,
    qualified: result.qualified,
  };
}

/** The value behind a trend-template rule when the rule carries no evidence text of its own. */
export function ruleEvidence(rule) {
  if (rule?.evidence) return rule.evidence;
  if (!finite(rule?.value) || rule.unit !== '%') return '';
  const v = Math.abs(rule.value).toFixed(1);
  if (rule.label.startsWith('52週安値')) return `52週安値から +${v}%`;
  if (rule.label.startsWith('52週高値')) return rule.value === 0 ? '52週高値と同値' : `52週高値から −${v}%`;
  return `${rule.value < 0 ? '−' : ''}${v}%`;
}

export function earningsDays(row, date) {
  const value = row?.entry_evidence?.earnings?.date;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || typeof date !== 'string') return null;
  const days = Math.round((Date.parse(value) - Date.parse(date)) / DAY);
  return Number.isFinite(days) && days >= 0 ? { date: value, days } : null;
}

/** One candidate as the brief shows it. */
export function candidateView(item, date) {
  const row = item?.row || item;
  const plan = entryPlan(row, null, 'minervini');
  const key = stateKey(plan.state);
  const volume = verifiedVolumeRatio(row, date);
  return {
    symbol: row.symbol,
    name: row.company_name || row.name || '',
    sector: row.gics_sector || row.sector || '',
    price: finite(plan.price) ? plan.price : null,
    pivot: finite(plan.pivot) ? plan.pivot : null,
    upper: finite(plan.upper) ? plan.upper : null,
    distance: finite(plan.distance) ? plan.distance : null,
    state: key,
    stateLabel: STATES[key]?.[0] || plan.state || '判定不可',
    stateGlyph: STATES[key]?.[1] || '?',
    volumeRatio: finite(volume) ? volume : null,
    rs: finite(row.rs_rating) ? row.rs_rating : null,
    fromHigh: finite(highDistance(row)) ? highDistance(row) : null,
    rsLineHigh: row.se_rs_line_new_high === true,
    qualified: Boolean(item?.assessment?.qualified),
    passed: item?.assessment?.passed ?? null,
    failed: item?.assessment?.failed ?? null,
    unknown: item?.assessment?.unknown ?? null,
    earnings: earningsDays(row, date),
    pivotSource: canonicalPivot(row).reason,
    row,
  };
}

/** Buy zone first, then within 5% below the pivot, then by the shared assessment score and RS. */
export function briefOrder(a, b) {
  const near = view => view.state === 'wait' && finite(view.distance) && view.distance >= -5 ? 1 : view.state === 'wait' ? 2 : ZONE_RANK[view.state] ?? 6;
  return near(a) - near(b) || (b.passed ?? -1) - (a.passed ?? -1) || (b.rs ?? -1) - (a.rs ?? -1) || a.symbol.localeCompare(b.symbol);
}

// One eligibility rule for Today's focus rows, their counts and the list's zone/near filters.
const inZone = view => view.state === 'zone';
const nearPivot = view => view.state === 'wait' && finite(view.distance) && view.distance >= -5;
const focusPool = (ranked, date) => (ranked || []).filter(item => item?.assessment?.qualified).map(item => candidateView(item, date))
  .filter(view => inZone(view) || nearPivot(view));

/** Today's focus list: qualified, liquid Minervini candidates in the buy zone or within 5% below the pivot. */
export function focusCandidates(ranked, date, limit = 5) {
  return focusPool(ranked, date).sort(briefOrder).slice(0, limit);
}

/** The whole focus pool, not the top-`limit` slice Today shows: in the buy zone, near the pivot, and both. */
export function focusCounts(ranked, date) {
  const pool = focusPool(ranked, date), zone = pool.filter(inZone).length;
  return { zone, near: pool.length - zone, total: pool.length };
}

export const LIST_FILTERS = {
  zone: { label: '買いゾーン', test: view => view.qualified && inZone(view) },
  near: { label: 'ピボット接近', test: view => view.qualified && nearPivot(view) },
  all: { label: '選定すべて', test: view => view.qualified },
  one: { label: 'あと1条件', test: view => !view.qualified && view.failed === 1 && view.unknown === 0 },
};
/** Case-insensitive ticker or company-name match. */
export const matchesSearch = (view, query) => !query || `${view.symbol} ${view.name}`.toUpperCase().includes(query.trim().toUpperCase());
export const LIST_SORTS = {
  priority: { label: '優先度', compare: briefOrder },
  rs: { label: 'RS推計', compare: (a, b) => (b.rs ?? -1) - (a.rs ?? -1) || briefOrder(a, b) },
  pivot: { label: 'ピボットに近い順', compare: (a, b) => (finite(a.distance) ? Math.abs(a.distance) : 99) - (finite(b.distance) ? Math.abs(b.distance) : 99) || briefOrder(a, b) },
  volume: { label: '出来高比', compare: (a, b) => (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1) || briefOrder(a, b) },
  high: { label: '52週高値に近い順', compare: (a, b) => (a.fromHigh ?? 999) - (b.fromHigh ?? 999) || briefOrder(a, b) },
};

/** What changed for a watched stock, in the order a trader acts on it. */
export function watchEvent(view) {
  if (view.state === 'zone' && finite(view.volumeRatio) && view.volumeRatio >= BREAKOUT_VOLUME_RATIO) return { kind: 'breakout', tone: 'zone', title: 'ピボットを出来高を伴って上抜け' };
  if (view.state === 'zone') return { kind: 'zone', tone: 'zone', title: '買いゾーン内' };
  if (view.state === 'wait' && finite(view.distance) && view.distance >= -5) return { kind: 'near', tone: 'wait', title: `ピボットまで あと${Math.abs(view.distance).toFixed(1)}%` };
  if (view.state === 'ext') return { kind: 'ext', tone: 'ext', title: '買いゾーンを超過' };
  if (view.state === 'wait') return { kind: 'base', tone: 'neutral', title: '土台を形成中' };
  return { kind: 'unknown', tone: 'neutral', title: view.stateLabel };
}

/** Position plan from the planned entry (pivot, or price once above it). Stops are capped below 10%. */
export function positionPlan(view, { stopPercent = STOP_DEFAULT_PERCENT, account = 50000, riskPercent = 1.25 } = {}) {
  const pct = Math.min(STOP_MAX_PERCENT - 0.5, Math.max(1, stopPercent));
  const entry = finite(view?.pivot) && finite(view?.price) ? Math.max(view.pivot, view.price) : null;
  if (!finite(entry) || entry <= 0) return null;
  const stop = entry * (1 - pct / 100), risk = entry - stop;
  const riskDollars = finite(account) && account > 0 && finite(riskPercent) && riskPercent > 0 ? account * riskPercent / 100 : null;
  const shares = riskDollars ? Math.floor(riskDollars / risk) : null;
  return { entry, stop, stopPercent: pct, risk, r2: entry + 2 * risk, r3: entry + 3 * risk, riskDollars, shares,
    cost: shares === null ? null : shares * entry, weight: shares === null ? null : shares * entry / account * 100 };
}

/**
 * Thresholds of the long-history deterioration notes. They are this app's own (labelled 独自判定 on
 * screen); the market tab prints its 基準 lines from these same numbers so the two cannot drift.
 */
export const ENV_RULES = Object.freeze({ templateSessions: 10, templateMinBase: 20, templateDropPercent: 20, leaderHealthBelow: 50, breakoutHoldBelow: 40 });

/**
 * Each deterioration rule on the newest long-history point (environmentPoint rows), in a fixed order:
 * { key, judged, fired, text } where text is set when the rule fired and judged is false when an
 * input of the newest session is missing (then nothing is said about that rule).
 */
export function environmentRules(rows) {
  const last = rows?.at(-1), before = rows?.at(-1 - ENV_RULES.templateSessions), rules = [];
  const rule = (key, judged, fired, text) => rules.push({ key, judged, fired: judged && fired, ...(judged && fired ? { text } : {}) });
  const templateJudged = Boolean(last) && finite(last.trendTemplateCount) && finite(before?.trendTemplateCount) && before.trendTemplateCount >= ENV_RULES.templateMinBase;
  const change = templateJudged ? (last.trendTemplateCount / before.trendTemplateCount - 1) * 100 : null;
  rule('template', templateJudged, change !== null && change <= -ENV_RULES.templateDropPercent, change === null ? null : `トレンドテンプレート達成数が${ENV_RULES.templateSessions}営業日で${Math.abs(change).toFixed(0)}%減少`);
  const stageJudged = Boolean(last) && finite(last.stage4Percent) && finite(last.stage2Percent);
  rule('stage', stageJudged, stageJudged && last.stage4Percent > last.stage2Percent, stageJudged ? `ステージ4（${last.stage4Percent.toFixed(0)}%）がステージ2（${last.stage2Percent.toFixed(0)}%）を上回る` : null);
  const leadersJudged = Boolean(last) && finite(last.leaderHealthPercent);
  rule('leaders', leadersJudged, leadersJudged && last.leaderHealthPercent < ENV_RULES.leaderHealthBelow, leadersJudged ? `20営業日前のTT達成銘柄のうち、50日線より上は${last.leaderHealthPercent.toFixed(0)}%` : null);
  const breakoutJudged = Boolean(last) && finite(last.breakoutHoldPercent);
  rule('breakout', breakoutJudged, breakoutJudged && last.breakoutHoldPercent < ENV_RULES.breakoutHoldBelow, breakoutJudged ? `ブレイクアウトの成功率が${last.breakoutHoldPercent.toFixed(0)}%に低下` : null);
  return rules;
}

/**
 * Deterioration notes from the derived long-history points (environmentPoint rows): the rules of
 * environmentRules that fired. Unknown inputs yield no note.
 */
export function environmentWarnings(rows) {
  return environmentRules(rows).filter(rule => rule.fired).map(({ key, text }) => ({ key, text }));
}

/**
 * Weinstein stage for the latest bar with the scanner's rules (backend stage_analysis.py):
 * 200-day SMA change over 20 bars (flat within ±1%), 60-bar least-squares close slope
 * (±0.05% per day) and close versus the 200-day SMA. The swing-pattern exception
 * (below a falling 200-day SMA without a downtrend) is not replayed and counts as 4.
 */
export function stageFromBars(bars) {
  const closes = (bars || []).map(b => b?.close).filter(finite);
  if (closes.length < 219 || closes.length !== (bars || []).length) return null;
  const mean = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += closes[i]; return s / (to - from); };
  const n = closes.length, ma = mean(n - 200, n), past = mean(n - 219, n - 19);
  const change = (ma - past) / past * 100;
  const rising = change >= 1, falling = change <= -1, flat = Math.abs(change) < 1;
  const window = closes.slice(-60), xm = 29.5, ym = window.reduce((a, b) => a + b, 0) / 60;
  let sxy = 0, sxx = 0;
  window.forEach((y, x) => { sxy += (x - xm) * (y - ym); sxx += (x - xm) ** 2; });
  const daily = sxy / sxx / ym * 100, up = daily > 0.05, down = daily < -0.05, above = closes.at(-1) > ma;
  if (above && rising && up) return 2;
  if (!above && falling && down) return 4;
  if (above && (flat || falling)) return 3;
  if (above && rising) return 3;
  if (flat || (!above && rising)) return 1;
  return above ? 3 : 4;
}

/** RS line (price ÷ S&P 500) at or above its high of the prior 251 sessions; null when the history is too short. */
export function rsLineNewHigh(rsLine, bars) {
  const dates = new Set((bars || []).map(b => b.date));
  const values = (rsLine || []).filter(p => dates.has(p.time || p.date) && finite(p.value)).map(p => p.value);
  if (values.length < 252) return null;
  const last = values.at(-1), prior = values.slice(-252, -1);
  return last >= Math.max(...prior);
}

/** VCP footprint text from measured legs, e.g. "VCP 14週 24/3 4T". */
export function footprint(evidence, bars) {
  const legs = evidence?.vcp?.legs || [];
  if (legs.length < 2 || !evidence.vcp.measurementsValid) return null;
  const first = legs[0].startDate, last = bars?.at?.(-1)?.date || legs.at(-1).endDate;
  const weeks = Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / DAY / 7));
  return { weeks, deepest: legs[0].depthPct, shallowest: legs.at(-1).depthPct, count: legs.length,
    // Only progressively shallower contractions are called a VCP; otherwise say what was measured.
    text: `${evidence.vcp.depthsContract === true ? 'VCP' : '収縮'} ${weeks}週 ${Math.round(legs[0].depthPct)}/${Math.round(legs.at(-1).depthPct)} ${legs.length}T${evidence.vcp.depthsContract === false ? '（縮小途切れ）' : evidence.vcp.depthsContract === true ? '' : '（縮小は未確認）'}`,
    contracting: evidence.vcp.depthsContract, volumeContracting: evidence.vcp.volumeContracts };
}

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

/**
 * Where today's qualified candidates cluster. Uses the industry group when most rows carry one,
 * otherwise the GICS sector, and says which. Groups need at least two qualified stocks.
 */
export function leadingGroups(ranked, limit = 3) {
  const qualified = (ranked || []).filter(item => item?.assessment?.qualified).map(item => item.row || {});
  if (!qualified.length) return null;
  const named = key => qualified.filter(row => typeof row[key] === 'string' && row[key].trim()).length;
  const field = named('ibd_industry_group') * 2 >= qualified.length ? 'ibd_industry_group' : named('gics_sector') * 2 >= qualified.length ? 'gics_sector' : null;
  if (!field) return null;
  const counts = new Map();
  for (const row of qualified) { const name = typeof row[field] === 'string' ? row[field].trim() : ''; if (name) counts.set(name, (counts.get(name) || 0) + 1); }
  const groups = [...counts].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name, count]) => ({ name, count }));
  return { kind: field === 'ibd_industry_group' ? '業種' : 'セクター', groups, total: qualified.length, unnamed: qualified.length - named(field) };
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
 * Volume on up closes divided by volume on down closes over the last `sessions` bars
 * (an accumulation/distribution reading). Unchanged closes are skipped; any missing
 * close or volume in the window makes it unknown.
 */
export function upDownVolume(bars, sessions = 50) {
  const list = bars || [];
  if (list.length < sessions + 1) return null;
  let up = 0, down = 0;
  for (let i = list.length - sessions; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (!finite(a?.close) || !finite(b?.close) || !finite(b?.volume) || b.volume < 0) return null;
    if (b.close > a.close) up += b.volume; else if (b.close < a.close) down += b.volume;
  }
  return down > 0 ? { ratio: up / down, sessions } : null;
}

/** Verdict tone shared by the market card and today's summary. */
export function marketTone(market) {
  if (!market || market.state === 'unknown') return 'neutral';
  if (/上昇トレンド/.test(market.label)) return 'zone';
  if (/圧力/.test(market.label)) return 'ext';
  return 'neg';
}

const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
/** 'YYYY-MM-DD' as M/D, with the year when it differs from the reference date's year. */
export function shortDate(iso, reference) {
  if (!isoDay(iso)) return '日付未確認';
  const [y, m, d] = iso.split('-').map(Number);
  return `${isoDay(reference) && reference.slice(0, 4) !== iso.slice(0, 4) ? `${y}/` : ''}${m}/${d}`;
}

/**
 * The newest row whose field (or every one of several fields) is a finite number, with its own
 * session: { value, date, index, row } (value is an object of the fields when several are asked).
 * An older value keeps its date so it is never shown as today's; no row → null.
 */
export function latestKnown(rows, field) {
  const fields = Array.isArray(field) ? field : [field], list = rows || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const row = list[i];
    if (row && fields.every(key => finite(row[key]))) return { value: Array.isArray(field) ? Object.fromEntries(fields.map(key => [key, row[key]])) : row[field], date: row.date ?? null, index: i, row };
  }
  return null;
}

/** A reader's reason is already a sentence (useMarketTrends' long_history_error); only add the full stop when it lacks one. */
export const sentence = text => /[。．.]$/.test(String(text)) ? String(text) : `${text}。`;

/** A reason wrapped in （…） loses its own full stop, so it never reads 「（…。）」. */
export const bare = text => String(text).replace(/[。．.]+$/, '');

/**
 * Why the market-trends asset failed, in short Japanese: kind fetch (network, HTTP, the manifest itself),
 * integrity (hash, transport or reference mismatch) or reader (readMarketTrends' own sentence).
 * A raw English message, path or hash is never shown; tile is the two-word form for a tile.
 */
export function trendsFailure(trends) {
  if (trends?.failureKind === 'manifest') return { kind: 'fetch', reason: '公開情報を読み込めません', tile: '公開情報エラー' };
  const error = trends?.failureReason, message = typeof error?.message === 'string' ? error.message : '';
  if (!error) return { kind: 'integrity', reason: '公開データの参照情報が一致しません', tile: '整合性エラー' };
  const status = /^Failed to load static data: .* \((\d{3})\)$/.exec(message)?.[1] || /^Transport HTTP failure: (\d{3})$/.exec(message)?.[1];
  if (status) return { kind: 'fetch', reason: status === '404' ? '配信ファイルが見つかりません' : `配信サーバーの応答 ${status}`, tile: '配信エラー' };
  if (error.name === 'AbortError' || (error.name === 'TypeError' && /fetch|network|load failed/i.test(message))) return { kind: 'fetch', reason: '通信エラー', tile: '通信エラー' };
  if (/^Unsupported transport/.test(message)) return { kind: 'fetch', reason: 'このブラウザでは読み込めません', tile: '非対応ブラウザ' };
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(message)) return { kind: 'reader', reason: message, tile: '整合性エラー' };
  return { kind: 'integrity', reason: null, tile: '整合性エラー' };
}

/** State of the market-trends asset: loading | error (with trendsFailure's kind, reason and tile) | none (not published) | ready. */
export function trendsStatus(trends) {
  if (trends?.loading) return { state: 'loading', reason: null };
  if (trends?.error) return { state: 'error', ...trendsFailure(trends) };
  if (!trends?.data) return { state: 'none', reason: null };
  return { state: 'ready', reason: null };
}

/** The error sentence for the market-trends asset (status from trendsStatus). */
export function trendsAlert(status) {
  if (status.kind === 'reader') return sentence(status.reason);
  if (status.kind === 'fetch') return `市場推移データを取得できません（${bare(status.reason)}）。`;
  return `市場推移データの整合性を確認できません${status.reason ? `（${bare(status.reason)}）` : ''}。`;
}

/**
 * One index's 25-session distribution-day count with its own session: today's value, else the
 * exporter's last observation (an index series that ends early), else the last finite point.
 */
export function distributionCount(index) {
  if (!index) return null;
  if (finite(index.latest?.value) && isoDay(index.latest.date)) return { value: index.latest.value, date: index.latest.date };
  if (finite(index.lastObserved?.value) && isoDay(index.lastObserved.date)) return { value: index.lastObserved.value, date: index.lastObserved.date };
  const points = Array.isArray(index.points) ? index.points : [];
  for (let i = points.length - 1; i >= 0; i--) if (finite(points[i]?.value) && isoDay(points[i].date)) return { value: points[i].value, date: points[i].date };
  return null;
}

// Wording only; the rule itself is computed by the exporter (parity with backend market_regime.py FTD_* constants).
// The decline is the backend's: peak close to the close of the lowest-low session, which the tile names, since a
// later close can sit lower. The post-FTD count is the distribution days still active (25-session window).
export const FTD_TEXT = Object.freeze({ minDay: 4, maxDay: 15, gain: '+1.2%', decline: '6%' });
/**
 * Compact tile text for one index's follow-through state (this app's own judgement):
 * { b, em, asOf } where asOf is set when the judgement is older than the analysis date.
 * A missing field (older publication) or an unavailable input never becomes a state.
 */
export function followThroughView(ft, date) {
  if (ft === undefined) return { b: '未集計', em: '旧形式の公開データ', asOf: null };
  if (!ft || typeof ft !== 'object') return { b: '算出不可', em: '判定データを読み取れません', asOf: null };
  if (ft.available !== true) return { b: '算出不可', em: typeof ft.reason === 'string' && ft.reason ? ft.reason : '指数データを確認できません', asOf: null };
  const asOf = isoDay(ft.asOf) && isoDay(date) && ft.asOf < date ? shortDate(ft.asOf, date) : null;
  const at = value => shortDate(value, date), whole = value => Number.isSafeInteger(value) && value >= 0;
  // A decline under the 6% line is never rounded up onto it (5.96% reads −5.96%, not −6.0% beside 「6%未満」).
  const under6 = value => Number(value.toFixed(2)) < 6 ? value.toFixed(2) : (Math.floor(value * 100) / 100).toFixed(2);
  const fall = finite(ft.declinePct) ? (value => `−${ft.state === 'no_correction' && Number(value.toFixed(1)) >= 6 ? under6(value) : value.toFixed(1)}%`)(Math.abs(ft.declinePct)) : null;
  const join = parts => parts.filter(Boolean).join('・');
  const { ftd, attempt, low, peak } = ft;
  switch (ft.state) {
    case 'confirmed': return { b: isoDay(ftd?.date) ? `確認 ${at(ftd.date)}` : '確認', asOf, tone: 'zone',
      em: join([finite(ftd?.gainPct) ? `+${ftd.gainPct.toFixed(1)}%` : null, whole(ftd?.attemptDay) ? `反発${ftd.attemptDay}日目` : null, whole(ftd?.distributionSince) ? `FTD後の有効な分配日${ftd.distributionSince}` : null]) };
    case 'rally_attempt': return { b: whole(attempt?.day) ? `反発${attempt.day}日目` : '反発中', asOf,
      em: join([isoDay(low?.date) ? `安値${at(low.date)}` : null, `${FTD_TEXT.minDay}日目以降の${FTD_TEXT.gain}上昇待ち`]) };
    case 'correction': return { b: '調整中', asOf, em: fall ? `高値${isoDay(peak?.date) ? at(peak.date) : ''}から${fall}` : `${FTD_TEXT.decline}以上の下落` };
    case 'attempt_expired': return { b: `${FTD_TEXT.maxDay}日以内のFTDなし`, asOf, em: join([isoDay(low?.date) ? `安値${at(low.date)}を維持` : null, whole(attempt?.day) ? `反発${attempt.day}日目` : null]) };
    case 'ftd_failed': return { b: isoDay(ft.failedDate) ? `FTD失敗 ${at(ft.failedDate)}` : 'FTD失敗', asOf, tone: 'ext', em: isoDay(ftd?.date) ? `${at(ftd.date)}のFTD当日の安値を終値で下回る` : 'FTD当日の安値を終値で下回る' };
    // The window opens on the peak: an older high is unseen, so "no FTD needed" is not established.
    case 'no_correction': if (ft.peakAtWindowStart === true) return { b: '判定保留', asOf, em: '集計期間の初日が高値・それ以前は期間外' };
      return { b: '不要', asOf, em: fall ? `安値日の終値で高値から${fall}（${FTD_TEXT.decline}未満）` : `${FTD_TEXT.decline}以上の調整なし` };
    default: return { b: '判定不明', em: `未対応の状態（${String(ft.state)}）`, asOf };
  }
}

// The fundamentals card's view model lives beside the rules so node tools can use it too.
export { code33Parts, code33Explain, fundamentalTiles, fundamentalsSource, quarterReason, secStatus } from '../fundamentalsExplain.js';
