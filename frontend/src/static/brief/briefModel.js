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

/** Today's focus list: qualified, liquid Minervini candidates in the buy zone or within 5% below the pivot. */
export function focusCandidates(ranked, date, limit = 5) {
  return (ranked || []).filter(item => item?.assessment?.qualified).map(item => candidateView(item, date))
    .filter(view => view.state === 'zone' || (view.state === 'wait' && finite(view.distance) && view.distance >= -5))
    .sort(briefOrder).slice(0, limit);
}

export const LIST_FILTERS = {
  zone: { label: '買いゾーン', test: view => view.qualified && view.state === 'zone' },
  near: { label: 'ピボット接近', test: view => view.qualified && view.state === 'wait' && finite(view.distance) && view.distance >= -5 },
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
 * Deterioration notes from the derived long-history points (environmentPoint rows).
 * Thresholds are this app's own (labelled 独自判定 on screen); unknown inputs yield no note.
 */
export function environmentWarnings(rows) {
  const last = rows?.at(-1), before = rows?.at(-11), notes = [];
  if (!last) return notes;
  if (finite(last.trendTemplateCount) && finite(before?.trendTemplateCount) && before.trendTemplateCount >= 20) {
    const change = (last.trendTemplateCount / before.trendTemplateCount - 1) * 100;
    if (change <= -20) notes.push({ key: 'template', text: `トレンドテンプレート達成数が10営業日で${Math.abs(change).toFixed(0)}%減少` });
  }
  if (finite(last.stage4Percent) && finite(last.stage2Percent) && last.stage4Percent > last.stage2Percent) notes.push({ key: 'stage', text: `ステージ4（${last.stage4Percent.toFixed(0)}%）がステージ2（${last.stage2Percent.toFixed(0)}%）を上回る` });
  if (finite(last.leaderHealthPercent) && last.leaderHealthPercent < 50) notes.push({ key: 'leaders', text: `20営業日前のTT達成銘柄のうち、50日線より上は${last.leaderHealthPercent.toFixed(0)}%` });
  if (finite(last.breakoutHoldPercent) && last.breakoutHoldPercent < 40) notes.push({ key: 'breakout', text: `ブレイクアウトの成功率が${last.breakoutHoldPercent.toFixed(0)}%に低下` });
  return notes;
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

// The fundamentals card's view model lives beside the rules so node tools can use it too.
export { code33Parts, code33Explain, fundamentalTiles, fundamentalsSource, quarterReason, secStatus } from '../fundamentalsExplain.js';
