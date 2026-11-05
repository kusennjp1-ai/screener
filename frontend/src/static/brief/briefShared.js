// Helpers shared by every brief model module (dates, the newest known value, sentence endings).
// Frozen in round 1: the briefModel.js barrel re-exports them, and each module imports them from here.
import { finite } from '../researchEngine';

export const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
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
