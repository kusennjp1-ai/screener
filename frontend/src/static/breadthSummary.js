import { finite, snapshotFreshness } from './researchEngine.js';
const count = n => finite(n) && n >= 0;
export function breadthSummary(current, now = Date.now()) {
  const ratio = count(current.ratio_10day) ? current.ratio_10day : null;
  const fresh = snapshotFreshness(current.date, now);
  const up = count(current.stocks_up_4pct) ? current.stocks_up_4pct : null;
  const down = count(current.stocks_down_4pct) ? current.stocks_down_4pct : null;
  const valid = ratio !== null && up !== null && down !== null;
  const tone = !valid ? 'unknown' : ratio > 1 ? 'positive' : ratio < 1 ? 'caution' : 'neutral';
  return { ratio, up, down, fresh, tone,
    title: !valid ? '市場の広がりは未確認' : ratio > 1 ? '上昇の広がりが優勢' : ratio < 1 ? '下落の広がりに注意' : '上昇・下落が拮抗',
    note: !valid ? '必要な指標が揃っていません。欠損をゼロとして判断しません。' : ratio > 1 ? '直近10日では、大きく上昇した銘柄数が下落銘柄数を上回っています。' : ratio < 1 ? '直近10日では、大きく下落した銘柄数が上昇銘柄数を上回っています。' : '直近10日の上昇・下落銘柄数は同程度です。',
    net: up !== null && down !== null ? up - down : null,
    share: up !== null && down !== null && up + down > 0 ? up / (up + down) : null };
}

export function recentBreadth(rows, range, date) {
  const day = Date.parse(date);
  if (!Number.isFinite(day)) return [];
  const earliest = day - (range === '3M' ? 90 : 31) * 86400000;
  const map = new Map();
  for (const r of rows || []) {
    const time = Date.parse(r.date);
    if (Number.isFinite(time) && time >= earliest && time <= day) map.set(r.date, r);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
