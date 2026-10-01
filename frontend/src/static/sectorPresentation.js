export const sectorNumber = value => Number.isFinite(value) ? value.toFixed(1) : '—';
export const sectorChange = value => Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(1)}%` : '未確認';
export const sectorHref = (group, method) => `#/?sector=${encodeURIComponent(group.key)}&view=charts&method=${method}`;
export const sectorValue = (group, period) => group.relative?.[period]?.value;
export function rankedSectors(groups, period) {
  return [...groups].sort((a,b) => (Number.isFinite(sectorValue(b,period)) ? sectorValue(b,period) : -Infinity) - (Number.isFinite(sectorValue(a,period)) ? sectorValue(a,period) : -Infinity));
}
export function sectorReadings(groups, period, method) {
  const known = groups.filter(group=>Number.isFinite(sectorValue(group, period)));
  const ordered = rankedSectors(known,period);
  const tailwind = ordered.filter(group=>sectorValue(group,period)>100);
  const headwind = ordered.filter(group=>sectorValue(group,period)<95).reverse();
  const improving = ordered.filter(group=>sectorValue(group,period)<100 && Number.isFinite(group.momentum21?.value) && group.momentum21.value>100).sort((a,b)=>b.momentum21.value-a.momentum21.value);
  const highPass = [...groups].filter(group=>Number.isFinite(group.rates?.[method]?.percent) && !group.small).sort((a,b)=>b.rates[method].percent-a.rates[method].percent);
  return {tailwind,headwind,improving,highPass,
    heading: !known.length ? '業種の相対指数は未確認。' : tailwind.length ? `追い風は${tailwind.slice(0,2).map(group=>group.label).join('と')}。` : 'SPYを上回る業種なし。',
    subheading: !known.length ? '期間内の価格データを確認中。' : improving.length ? `改善中は${improving.slice(0,2).map(group=>group.label).join('と')}。` : '指数100未満で改善中の業種なし。'};
}
// Display scale only. Clipping changes the bar length, never the printed value.
export function sectorBar(value) {
  if (!Number.isFinite(value)) return null;
  const end = (Math.max(80,Math.min(120,value))-80)/40*100;
  return {left: Math.min(50,end),width: Math.abs(end-50),end,positive:value>=100,clipped:value<80||value>120};
}
