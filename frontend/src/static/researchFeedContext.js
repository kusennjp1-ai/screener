import { SECTORS, sectorKey } from './sectorDefinitions';

const sectorNames = new Map([...SECTORS.map(([key, label]) => [key, label]), ['Unknown', '分類未確認']]);

// Count the already evaluated, currently filtered universe. This presentation
// never evaluates a financial rule or infers a historical event.
export function researchFeedContext(ranked) {
  const groups = new Map();
  let passed = 0, failed = 0, unknown = 0;
  for (const { row, assessment } of ranked) {
    const state = assessment?.qualified === true ? 'pass' : assessment?.failed > 0 ? 'fail' : 'unknown';
    if (state === 'pass') passed++;
    else if (state === 'fail') failed++;
    else unknown++;
    const key = sectorKey(row.gics_sector);
    if (!groups.has(key)) groups.set(key, { key, label: sectorNames.get(key), total: 0, passed: 0, unknown: 0 });
    const group = groups.get(key);
    group.total++;
    if (state === 'pass') group.passed++;
    if (state === 'unknown') group.unknown++;
  }
  return { total: ranked.length, passed, failed, unknown,
    groups: [...groups.values()].sort((a, b) => b.passed - a.passed || b.total - a.total || a.key.localeCompare(b.key)) };
}

