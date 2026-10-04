import { expect, it } from 'vitest';
import { eventFeedPreviewFixture } from './event-feed-preview-fixture.mjs';
import { createPriceTrace } from './export-price-traces.mjs';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';

it('labels every synthetic row and reproduces each mini chart from the matching fixture OHLCV', () => {
  const fixture = eventFeedPreviewFixture();
  const data = JSON.parse(fixture.resources.get('research-preview.json').body);
  expect(data.rows.map(row => row.symbol)).toEqual(fixture.symbols);
  for (const row of data.rows) {
    expect(row.company_name).toContain('検査用データ');
    const chart = JSON.parse(fixture.resources.get(row.chart_path).body);
    expect(chart.symbol).toBe(row.symbol);expect(chart.as_of_date).toBe(fixture.date);
    expect(chart.bars.at(-1).close).toBe(row.current_price);
    expect(createPriceTrace(row, chart, fixture.date).svg).toBe(fixture.resources.get(`${data.price_traces.root}/${row.symbol}.svg`).body);
  }
});

it('uses normal guarded preparation and retains required annual unknown instead of fabricating complete financial proof', () => {
  const fixture = eventFeedPreviewFixture(), data = JSON.parse(fixture.resources.get('research-preview.json').body);
  const prepared = prepareResearchBundle([data], fixture.date, { now: fixture.now, generation: 'synthetic-event-feed-preview-v1' });
  expect(prepared.rows).toHaveLength(3);
  expect(prepared.rows.every(row => row.priceTrace.status === 'available')).toBe(true);
  expect(prepared.rankings.oneil.every(item => item.assessment.qualified === false && item.assessment.unknown > 0)).toBe(true);
});
