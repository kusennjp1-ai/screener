import { expect } from '@playwright/test';

// Inspect actual rendered prices, not just the presence of an SVG container.
export async function expectSvgChart(scope, { symbol, bars, rs = 'missing' }) {
  const svg = scope.locator('.leader-evidence-chart svg[role="img"]').first();
  await expect(svg).toBeVisible();
  for (const pane of ['price', 'volume', 'rs']) await expect(svg.locator(`[data-pane="${pane}"]`)).toHaveCount(1);
  const candles = await svg.locator('[data-pane="price"] g[data-date]').evaluateAll(nodes => nodes.map(node => ({
    date: node.dataset.date, close: Number(node.dataset.close), title: node.querySelector('title')?.textContent,
    body: [...node.querySelectorAll('rect,line')].every(shape => [...shape.attributes].filter(a => ['x','y','x1','y1','x2','y2','width','height'].includes(a.name)).every(a => Number.isFinite(Number(a.value)))),
  })));
  expect(candles.length).toBeGreaterThan(1);
  for (const candle of candles) {
    const bar = bars.find(bar => bar.date === candle.date);
    expect(bar, `${symbol} ${candle.date} is an actual supplied session`).toBeTruthy();
    expect(candle.close).toBe(bar.close);
    expect(candle.title).toBe(`${bar.date} 始値 ${bar.open} 高値 ${bar.high} 安値 ${bar.low} 終値 ${bar.close}`);
    expect(candle.body).toBe(true);
  }
  await expect(svg).toHaveAttribute('aria-label', `${symbol} 価格・出来高・RS 共通時間軸 ${candles[0].date}〜${candles.at(-1).date}`);
  const volumes = await svg.locator('[data-pane="volume"] rect[data-volume]').evaluateAll(nodes => nodes.map(node => ({ value: Number(node.dataset.volume), title: node.querySelector('title')?.textContent })));
  expect(volumes).toHaveLength(candles.length);
  volumes.forEach((volume,index) => { expect(volume.value).toBe(bars.find(bar=>bar.date===candles[index].date).volume); expect(volume.title).toContain(candles[index].date); });
  if (rs === 'missing') { await expect(svg.locator('[data-pane="rs"]')).toHaveText('データなし'); await expect(svg.locator('[data-series="rs"]')).toHaveCount(0); }
  else { expect(await svg.locator('[data-series="rs"]').count()).toBeGreaterThan(0); await expect(svg.locator('[data-pane="rs"]')).not.toContainText('データなし'); }
  return svg;
}
