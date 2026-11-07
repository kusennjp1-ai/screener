// The market tab's long-history takeaway and the sector ranks: read only by the lazily loaded market screen
// (MarketScreen.jsx, MarketSectors.jsx), so this module ships in its chunk, never with Today. Every value comes from
// the published long history; nothing here adds a threshold, a status or a verdict.
import { environmentPoint } from '../marketLongHistory';
import { SECTORS } from '../sectorDefinitions';
import { latestKnown, shortDate } from './briefModel';
import { MONTH, num, SURVIVORSHIP_NOTE, YEAR } from './marketTabModel';

const finite = Number.isFinite;
const sectorNames = Object.fromEntries(SECTORS.map(([, label, symbol]) => [symbol, label]));

/**
 * One line on what the long history says, from the data only: the leader count against a year earlier
 * and its one-year range, and the leading sectors of the newest complete frame, then the survivorship caveat
 * (always). A value older than the analysis date `date` carries its own session (「9/30時点」), so a lagging
 * history never reads as today's.
 */
export function historyTakeaway(history, date = null) {
  if (!history) return null;
  const rows = (history.breadth || []).map(environmentPoint);
  const field = rows.some(row => 'trendTemplateCount' in row) ? ['trendTemplateCount', 'TT達成数'] : ['leaderCount', '先導株数（価格条件）'];
  const hit = latestKnown(rows, field[0]), parts = [];
  const olderThan = value => Boolean(value && date && value < date);
  if (hit && hit.index >= YEAR - 1) {
    const window = rows.slice(hit.index - (YEAR - 1), hit.index + 1).map(row => row[field[0]]).filter(finite), before = rows[hit.index - (YEAR - 1)]?.[field[0]];
    const when = olderThan(hit.date) ? `${shortDate(hit.date, date)}時点・` : '';
    // Without a year-earlier value the count is named by its own session, never 「現在」.
    const from = finite(before) ? `1年前の${num(before)}から` : `${shortDate(hit.date, date || hit.date)}時点で`;
    if (window.length >= 200) parts.push(`${field[1]}は${from}${num(hit.value)}銘柄（${finite(before) ? when : ''}1年の範囲 ${num(Math.min(...window))}〜${num(Math.max(...window))}）`);
  }
  const frame = (history.sectorRotation?.frames || []).at(-1);
  if (frame?.ranks?.length === 11) parts.push(`セクターの上位は${[...frame.ranks].sort((a, b) => a.rank - b.rank).slice(0, 3).map(row => sectorNames[row.symbol] || row.symbol).join('・')}${olderThan(frame.date) ? `（${shortDate(frame.date, date)}時点）` : ''}`);
  // The breadth series below are today's names traced back: said with every takeaway, whatever it holds.
  parts.push(`参加度・リーダーの推移は${SURVIVORSHIP_NOTE}`);
  return `${parts.join('。')}。`;
}

const completeFrame = frame => frame?.ranks?.length === 11 && frame.ranks.every(row => Number.isSafeInteger(row.rank) && finite(row.relativeIndex));
/**
 * Sector ETFs ranked by this app's own relative strength (126-session price relative to SPY) on the newest
 * frame, each with its value as published (100 = the same move as SPY), its bar width against the widest
 * gap from 100, and its rank a month (21 frames) earlier. An incomplete frame invents no ranks.
 */
export function sectorRanks(history, date) {
  const frames = history?.sectorRotation?.frames || [];
  const current = frames.at(-1) || null, before = frames.length > MONTH ? frames[frames.length - 1 - MONTH] : null;
  if (!completeFrame(current)) return { complete: false, date: current?.date || null, older: Boolean(current?.date && date && current.date < date), rows: [] };
  const prior = completeFrame(before) ? new Map(before.ranks.map(row => [row.symbol, row.rank])) : null;
  const spread = Math.max(1, ...current.ranks.map(row => Math.abs(row.relativeIndex - 100)));
  return { complete: true, date: current.date, older: Boolean(date && current.date < date), beforeDate: prior ? before.date : null,
    rows: current.ranks.slice().sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol)).map(row => {
      const was = prior?.get(row.symbol), move = Number.isSafeInteger(was) ? was - row.rank : null;
      return { symbol: row.symbol, name: sectorNames[row.symbol] || row.symbol, rank: row.rank, value: row.relativeIndex, text: num(row.relativeIndex, 1),
        up: row.relativeIndex >= 100, width: 50 * Math.abs(row.relativeIndex - 100) / spread, was: Number.isSafeInteger(was) ? was : null, move };
    }) };
}
