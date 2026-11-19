// The market gate (plan S1-P2): one model of the market verdict for every surface that states it — the phone's bar line and
// the wide bar's chip (marketBand), Today's gate card (marketGate: its head, figure, definition, basis, conditions, sign line
// and fold summary), the conditions that would reopen or close the guide (resumeConditions) and the gate's facts with their
// kinds (gateFacts). Everything is read from modelMarket's verdict (label, cap, regime), marketLines' two lines, capText, the
// market tab's verdictWaiting and verdictBasis, and the 地合い card's shared values: nothing here adds a state, a threshold,
// a score or a gate, and nothing reads the clock (the last closed session, `target`, is always an argument).
import { capText, MARKET_CAPS } from '../portfolioPlan';
import { ftdPrevious, gspcFtdDisagrees, marketTileNote, marketTileSuffix, marketTone, sameDayFollowThrough, trendsStatus, BREAKOUT_HOLD_NAME, FTD_PREVIOUS_NAME, MARKET_TILE_SUFFIX } from './briefEnvironment';
import { isoDay, shortDate } from './briefShared';
import { barDay } from './briefNav';
import { distributionGrade, marketCardView, num, verdictBasis, verdictBasisShort, verdictWaiting, DISTRIBUTION_TEXT } from './marketTabModel';
import { gateReads, publishedMarketContext, REGIME_NAMES, STOCK_SIDE_HEAD } from './marketGateFacts';

/** What every band line and the gate name first. */
export const BAND_SUBJECT = '地合い';
/** The kinds a gate fact can carry (plan S1-P2; the 1440 pane's 「種別」 column), and the mark of a fact without a value. */
export const GATE_KINDS = Object.freeze(['実測', '独自判定', '独自設定', '実測・基準は独自設定', '実測・参考', '独自集計（RS推計を含む）', '独自定義']);
export const NO_KIND = '—';
/** The gate's four groups of facts, in their order (the last one is the market tab's 銘柄側 head). */
export const GATE_GROUPS = Object.freeze({ verdict: '判定', index: '根拠（指数側）', breadth: '広がり（参考）', stock: STOCK_SIDE_HEAD });
/**
 * Each fact's kind, fixed by key (plan S3-P2's table; a vitest pins it). The SPY regime count's kind is 「実測・基準は独自設定」:
 * the table's 「実測（基準と段階は独自設定）」 is not one of the seven kinds, and its threshold and its display grades are both the
 * app's own setting. The conditions are 独自設定 and the signs 独自判定 (their own lists, not facts).
 */
export const FACT_KINDS = Object.freeze({ verdict: '独自判定', guide: '独自設定', spyLines: '実測', spyDistribution: '実測・基準は独自設定', indexDistribution: '実測・参考',
  extremes: '実測・参考', above200: '実測・参考', above50: '実測・参考', tt: '独自集計（RS推計を含む）', breakout: '実測・基準は独自設定', health: '独自定義' });
export const CONDITION_KIND = '独自設定', SIGN_KIND = '独自判定';
/** The sign line's head: what it says moves nothing. */
export const SIGN_TITLE = '上昇再開のサイン（参考・目安は動きません）';
/**
 * The backend regime's distribution count at which an intact uptrend reads 上昇に圧力 (market_regime.py DIST_UNDER_PRESSURE; a
 * test reads the backend's value, never a retyped one).
 */
export const REGIME_DISTRIBUTION_PRESSURE = 4;

// The regimes whose cap is above 0 (confirmed_uptrend, uptrend_under_pressure), in MARKET_CAPS' order: the regime condition.
const OPEN_REGIMES = Object.keys(MARKET_CAPS).filter(key => key !== 'otherwise' && MARKET_CAPS[key] > 0);
const WORDS = Object.freeze({ met: '達成', unmet: '未達', unknown: '未確認' });
/** The three conditions in modelMarket's rule order: the 200-day line, the 50-day line, then the regime. */
export const CONDITION_LABELS = Object.freeze({ above200: 'SPY終値が200日線の上', above50: 'SPY終値が50日線の上', regime: `局面判定が${OPEN_REGIMES.map(key => REGIME_NAMES[key]).join('／')}` });
const LINE_NAMES = Object.freeze({ above200: '200日線', above50: '50日線' });

// A newer session's verdict needs the caller's `target` (marketUpdateState's, from its own clock), never one guessed here.
function requireTarget(target, name) {
  if (target === undefined) throw new TypeError(`${name}: target is required (the last session the calendar says has closed, or null)`);
}
/** The gate's state: loading, unknown (no verdict, or one modelMarket could not judge), waiting (D18), open or closed. */
function gateState(market, { loading, date, target }) {
  if (!market) return { state: loading ? 'loading' : 'unknown', waiting: null };
  if (market.state === 'unknown') return { state: 'unknown', waiting: null };
  const waiting = verdictWaiting({ market, date, target });
  return { state: waiting ? 'waiting' : market.cap > 0 ? 'open' : 'closed', waiting };
}
const judged = state => state === 'open' || state === 'closed' || state === 'waiting';
/** The regime's label without its 独自判定 mark (the fact's kind says it): 「50日線割れ（弱含み）」, 「上昇トレンド」. */
const bareLabel = label => label.replace(/（(?:(.+)・)?独自判定）$/, (_, inner) => inner ? `（${inner}）` : '');

/**
 * The band (plan S1-P2's table, D2, D18): one value the phone's bar line, the wide bar's chip, the call card's 地合い line and
 * the accessible sentence are all read from.
 *  - `market` is modelMarket's verdict (null before the bundle, or when it failed); `loading` whether it is still coming.
 *  - `date` is the verdict's analysis date, `target` the last session the exchange calendar says has closed (marketUpdateState's
 *    target, or null when unknown): required, so the waiting form is the market tab's own (verdictWaiting).
 *  - `late` is the bar's freshnessLine value: only a stale publication's age (tone 'warn') is carried, as `age`; it never changes
 *    the answer. `suffix` is the 地合い tile's sign word (marketTileSuffix), carried as `sign` for a judged market.
 * Lines: `line1` 「地合い 検討可・目安 最大50%」 / 「地合い 買いは控える・目安 0%」 / 「地合い 10/2時点の判定・更新待ち」 /
 * 「地合い 未確認・買いは見送り」 / 「地合い 読込中」; `kinds` the bar's line-2 labels in a long and a short form (null for a state);
 * `line1Labelled` the same answer with each label inline (the late form, when line 2 holds the age); `chip` the wide form with
 * the regime's label; `name` the full sentence. The unknown and loading forms carry no figure and no 「%」.
 */
export function marketBand(market, { loading = false, late = null, suffix = null, date = null, target } = {}) {
  requireTarget(target, 'marketBand');
  const { state, waiting } = gateState(market, { loading, date, target });
  const known = judged(state), guide = known ? capText(market.cap) : null;
  const answer = { loading: '読込中', unknown: '未確認・買いは見送り', waiting: waiting?.short, open: '検討可', closed: '買いは控える' }[state];
  const guideNote = state === 'waiting' ? `${shortDate(date, date)}時点・独自設定` : '独自設定';
  const line1 = known && state !== 'waiting' ? `${BAND_SUBJECT} ${answer}・目安 ${guide}` : `${BAND_SUBJECT} ${answer}`;
  const line1Labelled = !known ? line1 : state === 'waiting' ? `${BAND_SUBJECT} ${answer}（独自判定）` : `${BAND_SUBJECT} ${answer}（独自判定）・目安 ${guide}（独自設定）`;
  const kinds = !known ? null : state === 'waiting' ? { long: '判定＝独自判定', short: '独自判定' } : { long: '判定＝独自判定・目安＝独自設定', short: '独自判定・独自設定' };
  const chip = !known ? line1 : state === 'waiting' ? `${BAND_SUBJECT} ${answer}（独自判定）・新規買いの目安 ${guide}（${guideNote}）` : `${BAND_SUBJECT} ${market.label}・新規買いの目安 ${guide}（独自設定）`;
  const spoken = { waiting: answer, open: '新規の買いを検討できる', closed: '新規の買いは控える' }[state];
  const name = state === 'loading' ? line1 : state === 'unknown' ? `${BAND_SUBJECT} ${market?.label || '市場未確認'}・新規の買いは見送り`
    : `${BAND_SUBJECT} ${market.label}・${spoken}・新規買いの目安 ${guide}（${guideNote}）`;
  return { state, subject: BAND_SUBJECT, answer, label: known ? market.label : null, guide, guideLabel: known ? `新規買いの目安（${guideNote}）` : null,
    kinds, line1, line1Labelled, chip, name, tone: marketTone(market), age: late?.tone === 'warn' ? late.age : null, sign: known ? suffix ?? null : null, waiting };
}

/**
 * The conditions in modelMarket's rule order (D14): the 200-day line, the 50-day line (`lines`: marketLines' reading of the
 * same rows) and the regime (modelMarket's `regime`, null when the rows carry none or disagree). Each is met, unmet or unknown;
 * an unknown market's conditions are all unknown, never 達成 or 未達. All three are met exactly when the cap is above 0 (a
 * property test). On a 0% day they are 「買いの再開の条件」, on an open day 「目安が動く条件」. `first` holds the lines of the
 * first fold (each unmet or unknown condition by name, the two lines named together; 「再開の条件：未確認」 when nothing is
 * known), `fold` the met ones. No count of conditions is ever printed.
 */
export function resumeConditions(market, lines) {
  const known = Boolean(market) && market.state !== 'unknown';
  const line = value => !known || typeof value !== 'boolean' ? 'unknown' : value ? 'met' : 'unmet';
  const regime = !known || !market.regime ? 'unknown' : OPEN_REGIMES.includes(market.regime) ? 'met' : 'unmet';
  // A regime outside REGIME_NAMES is never printed by its key: the line then says 未達 alone.
  const now = regime === 'unmet' ? REGIME_NAMES[market.regime] ?? null : null;
  const conditions = [
    { key: 'above200', label: CONDITION_LABELS.above200, state: line(lines?.above200), now: null },
    { key: 'above50', label: CONDITION_LABELS.above50, state: line(lines?.above50), now: null },
    { key: 'regime', label: CONDITION_LABELS.regime, state: regime, now },
  ].map(condition => ({ ...condition, word: WORDS[condition.state] }));
  const lineText = state => { const hit = conditions.filter(c => c.key in LINE_NAMES && c.state === state);
    return hit.length ? `SPY終値が${hit.map(c => LINE_NAMES[c.key]).join('・')}の上：${WORDS[state]}` : null; };
  const regimeText = `${CONDITION_LABELS.regime}：${WORDS[regime]}${now ? `（いま ${now}）` : ''}`;
  const allUnknown = conditions.every(c => c.state === 'unknown');
  return { title: known && market.cap > 0 ? '目安が動く条件' : '買いの再開の条件', kind: CONDITION_KIND, conditions, met: conditions.every(c => c.state === 'met'), allUnknown,
    first: allUnknown ? ['再開の条件：未確認'] : [lineText('unmet'), lineText('unknown'), regime === 'met' ? null : regimeText].filter(Boolean),
    fold: allUnknown ? [] : [lineText('met'), regime === 'met' ? regimeText : null].filter(Boolean) };
}

/** Whether the index records are of an older session than the analysis date (a series one session behind). */
function signsBehind(trends, date) {
  const asset = trends.data;
  if (isoDay(asset.as_of_date) && asset.as_of_date < date) return true;
  return ['^GSPC', '^IXIC'].some(symbol => { const ft = (asset.indices || []).find(item => item?.symbol === symbol)?.followThrough; return isoDay(ft?.asOf) && ft.asOf < date; });
}

/**
 * The gate's sign line (one line, never merged with another), from the 地合い tile's own reading (marketTileSuffix and
 * marketTileNote, the same input): { type, suffix, text, sentence } or null.
 *  - 'ftd': an FTD-upgraded regime under a line, confirmed by the same day's ^GSPC record: 「FTD確認済み（参考・目安は 0%のまま：
 *    SPYが50日線の下）」, 「前回のFTD 8/13（…）」 when the FTD is older than FTD_RECENT_SESSIONS;
 *  - 'rally' (反発n日目, cap 0) and 'nasdaq' (NAS調整中, an open guide): the tile's word, its sentence for the fold;
 *  - 'withheld': no same-day record because the series is behind the analysis date: 「未確認（10/2分は再集計待ち）」.
 * An unknown market, or a series that is not ready, has none.
 */
export function gateSign({ market = null, trends = null, manifest = null, date = null, lines = null } = {}) {
  if (!market || market.state === 'unknown') return null;
  const input = { market, trends, manifest }, suffix = marketTileSuffix(input);
  if (suffix === MARKET_TILE_SUFFIX.ftd) {
    const ft = sameDayFollowThrough(trends, manifest, '^GSPC');
    const name = ftdPrevious(ft) && isoDay(ft.ftd?.date) ? `${FTD_PREVIOUS_NAME} ${shortDate(ft.ftd.date, date)}` : MARKET_TILE_SUFFIX.ftd;
    const under = lines?.above200 === false ? LINE_NAMES.above200 : lines?.above50 === false ? LINE_NAMES.above50 : null;
    return { type: 'ftd', suffix, text: `${name}（参考・目安は ${capText(market.cap)}のまま${under ? `：SPYが${under}の下` : ''}）`, sentence: null };
  }
  if (suffix) return { type: suffix === MARKET_TILE_SUFFIX.nasdaq ? 'nasdaq' : 'rally', suffix, text: suffix, sentence: marketTileNote(input) };
  if (trendsStatus(trends).state === 'ready' && isoDay(date) && signsBehind(trends, date)) return { type: 'withheld', suffix: null, text: `未確認（${shortDate(date, date)}分は再集計待ち）`, sentence: null };
  return null;
}

/**
 * Today's gate card (plan S1-P2's table, S1-P4), from the same inputs as the band plus `lines` (marketLines), the market-trends
 * query (`trends`), the published manifest (`manifest`: the manifest itself, brief.manifest.data) and the 地合い card's view
 * (`view`, marketCardView's: its basis conflict and Today's note). Returns:
 *  - `band` (marketBand, with the sign word), `state`;
 *  - `head`: the kicker 「地合い・10/2（金）引け」 with the late age apart (tone 'warn'), the headline and its kind, the wide
 *    headline (the waiting lead at >= 1024), the figure with its label and its definition (none when unknown or loading);
 *  - `basis`: verdictBasis's words with 実測, and 「（指数の履歴と不一致・下に詳細）」 on a basis or FTD conflict: `text` the short
 *    form (verdictBasisShort; the phone's first fold, ledger step 3), `full` the market tab's own words (the fold, and the line
 *    at 1024px and wider);
 *  - `conditions` (resumeConditions), `sign` (gateSign, with its title and its kind 独自判定), `summary` (the fold's summary), `todayNote` (the card's).
 */
export function marketGate({ market = null, loading = false, lines = null, date = null, target, late = null, trends = null, manifest = null, view = null } = {}) {
  requireTarget(target, 'marketGate');
  const sign = gateSign({ market, trends, manifest, date, lines });
  const band = marketBand(market, { loading, late, suffix: sign?.suffix ?? null, date, target });
  const { state, waiting, guide } = band, known = judged(state);
  const headline = { loading: null, unknown: '買いは見送り', waiting: waiting?.short, open: '新規の買いを検討できる', closed: '買いは控える' }[state];
  const basis = known ? verdictBasis(market, date) : null;
  const conflict = known && (Boolean(view?.conflict) || (market.ftdUpgraded === true && gspcFtdDisagrees(trends) === true));
  const note = conflict ? '（指数の履歴と不一致・下に詳細）' : '';
  return {
    state, band,
    head: { kicker: `${BAND_SUBJECT}${isoDay(date) ? `・${barDay(date)}引け` : ''}`, age: band.age, ageTone: band.age ? 'warn' : null,
      headline, headlineKind: known ? '独自判定' : null, headlineWide: waiting ? waiting.lead : headline,
      figure: guide, figureLabel: band.guideLabel, definition: known ? `${guide}＝新規建ての上限（口座比・独自設定）` : null },
    basis: basis ? { text: `${verdictBasisShort(market, date)}${note}`, full: `${basis.text}${note}`, kind: '実測', conflict } : null,
    conditions: state === 'loading' ? null : resumeConditions(market, lines),
    sign: sign ? { ...sign, title: SIGN_TITLE, kind: SIGN_KIND } : null,
    summary: { loading: null, unknown: '根拠（未確認の項目）', closed: '根拠と再開の条件', open: '根拠と目安が動く条件', waiting: '根拠と目安が動く条件' }[state],
    todayNote: view?.dating?.todayNote ?? null,
  };
}

/**
 * The gate's facts (plan S1-P2, S3-P2): rows `{ key, group, label, value, reading, kind, asOf }`, each in exactly one of
 * GATE_GROUPS, with FACT_KINDS' kind when it has a value and NO_KIND when it has none. A missing value carries its own absent
 * words (読み込み中…, 未収録, 未配信, 確認できません …), never 0 and never a figure. `brief` is useBriefData's shape (market,
 * marketLoading, trends, manifest, date); `lines` is marketLines'; `target` as for marketBand; `view` an already computed
 * marketCardView with `facts: gateReads` (else it is computed here).
 */
export function gateFacts(brief, { lines = null, target, view = null } = {}) {
  requireTarget(target, 'gateFacts');
  const { market = null, marketLoading = false, trends = null, date = null } = brief;
  const manifest = brief.manifest?.data ?? null;
  const card = view?.gate ? view : marketCardView({ market, marketLoading, trends, date, update: { target }, facts: gateReads });
  const reads = card.gate, band = marketBand(market, { loading: marketLoading, date, target }), known = judged(band.state);
  const rows = [];
  const fact = (key, group, label, value, { reading = null, valued = true, asOf = null, ...rest } = {}) =>
    rows.push({ key, group, label, value, reading, kind: valued ? FACT_KINDS[key] : NO_KIND, asOf, ...rest });
  const unjudged = band.state === 'loading' ? '読込中' : '未確認';

  // 判定: the verdict with its label, and the guide with its definition.
  const headline = band.state === 'waiting' ? band.answer : band.state === 'open' ? '新規の買いを検討できる' : '買いは控える';
  fact('verdict', GATE_GROUPS.verdict, '判定', known ? `${bareLabel(market.label)}・${headline}` : band.state === 'loading' ? '読込中' : `${market?.label || '市場未確認'}・買いは見送り`, { valued: known });
  fact('guide', GATE_GROUPS.verdict, '新規買いの目安', known ? band.guide : unjudged, { valued: known, reading: known ? `${band.guide}＝新規建ての上限（口座比）` : null,
    asOf: band.state === 'waiting' ? shortDate(date, date) : null });

  // 根拠（指数側）: SPY at scan time, the regime's own SPY count, the two indices' counts and the new highs and lows.
  const linesKnown = known && typeof lines?.above50 === 'boolean' && typeof lines?.above200 === 'boolean';
  fact('spyLines', GATE_GROUPS.index, 'SPY終値（スキャン時点）', linesKnown ? `200日線の${lines.above200 ? '上' : '下'}・50日線の${lines.above50 ? '上' : '下'}` : unjudged, { valued: linesKnown });
  // The regime's block only when its regime is the verdict's rows' (regimeCause's rule): a market without one borrows none.
  const context = publishedMarketContext(manifest?.markets?.US ?? null, { date });
  const block = known && context && market.regime && context.regime === market.regime ? context : null;
  const spyCount = block && Number.isSafeInteger(block.distribution_days) ? block.distribution_days : null;
  const grade = spyCount === null ? null : distributionGrade(spyCount);
  fact('spyDistribution', GATE_GROUPS.index, '分配日（局面判定が数えるSPY）', spyCount !== null ? `${num(spyCount)}日` : known ? '未収録' : unjudged, { valued: spyCount !== null,
    reading: `${REGIME_DISTRIBUTION_PRESSURE}日以上で${REGIME_NAMES.uptrend_under_pressure}（独自設定）`,
    tier: grade ? `${grade === 'caution' ? '注意' : '参考'}（${DISTRIBUTION_TEXT[grade]}）` : null });
  const [todayDist, , , todayExtremes] = card.today;
  fact('indexDistribution', GATE_GROUPS.index, '指数の分配日（^GSPC・^IXIC）', todayDist.valued ? todayDist.pairs.map(pair => `${pair.name} ${pair.value}`).join('・') : todayDist.b,
    { valued: Boolean(todayDist.valued), reading: '判定には使わない別集計', asOf: todayDist.asOf ?? null });
  fact('extremes', GATE_GROUPS.index, '新高値／新安値', reads.highsLows ? `新高値 ${num(reads.highsLows.value.newHighs)}・新安値 ${num(reads.highsLows.value.newLows)}` : todayExtremes.b,
    { valued: Boolean(reads.highsLows), asOf: reads.extremesAsOf ?? null });

  // 広がり（参考）: the share above the 200-day line, and above the 50-day line when the publication carries it.
  fact('above200', GATE_GROUPS.breadth, '200日線より上', reads.a200.b, { valued: Boolean(reads.a200.valued), asOf: reads.a200.asOf ?? null });
  if (reads.a50.valued) fact('above50', GATE_GROUPS.breadth, '50日線より上', reads.a50.b, { asOf: reads.a50.asOf ?? null });

  // 銘柄側（参考・目安は変えません）: TT達成, the breakout row and the leaders' health, with no colour and no ▲ (no tone here).
  const ttTerm = reads.stockSide?.terms[0];
  fact('tt', GATE_GROUPS.stock, 'TT達成', reads.tt.b, { valued: Boolean(reads.tt.valued), asOf: reads.tt.asOf ?? null,
    reading: ['8条件（RS推計70以上を含む）', reads.tt.valued ? ttTerm?.extra : null].filter(Boolean).join('・') });
  // A rate with the breakouts it held and judged (「75%（6/8件）」: a rate exists only with both counts whole); a sample too small
  // for a rate, its count and why (the row's own note); else the row's absent words.
  const breakout = reads.breakout, rate = breakout.valued ? reads.counts.breakout : null;
  const breakoutValue = rate && rate.held !== null && rate.judged ? `${breakout.b}（${num(rate.held)}/${num(rate.judged)}件）` : breakout.b;
  fact('breakout', GATE_GROUPS.stock, BREAKOUT_HOLD_NAME, breakoutValue, { valued: Boolean(breakout.valued), asOf: breakout.asOf ?? null, reading: rate ? null : breakout.note ?? null });
  // A rate with the cohort's names above the 50-day line (「70%（21/30銘柄）」); a cohort too small for a rate, its size and why.
  const health = reads.health.item, cohort = health.valued ? reads.counts.health : null;
  const healthValue = cohort && cohort.above !== null && cohort.cohort ? `${health.b}（${num(cohort.above)}/${num(cohort.cohort)}銘柄）` : health.b;
  fact('health', GATE_GROUPS.stock, health.label, healthValue, { valued: Boolean(health.valued), asOf: health.asOf ?? null, reading: health.note ?? null });
  return rows;
}
