import { describe, expect, it } from 'vitest';
import { classifyResourceUrl, fontResourceEvidence } from './radar-font-resources.mjs';

describe('Radar font resource evidence from CDP events', () => {
  it('classifies missing and invalid URLs without throwing or treating them as fonts', () => {
    for (const value of [undefined, null, '']) expect(classifyResourceUrl(value)).toBe('missing_url');
    for (const value of ['not a URL', '/relative', {}]) expect(classifyResourceUrl(value)).toBe('invalid_url');
    expect(classifyResourceUrl('https://fonts.gstatic.com/s/font.woff2')).toBe('font_service');
    expect(classifyResourceUrl('https://fonts.googleapis.com/css2?family=Geist+Mono')).toBe('font_service');
    expect(classifyResourceUrl('https://fonts.gstatic.com.example.com/font.woff2')).toBe('other');
  });
  it('recovers the actual failed-run completion inputs from response metadata and retains raw events', () => {
    const resources = [
      { event: 'response', id: '3329.531', type: 'Other', url: 'http://127.0.0.1:41757/', status: 200, timestamp: 200.788138 },
      { event: 'finished', id: '3329.531', encoded_bytes: 0, timestamp: 200.787259 },
      { event: 'response', id: '3329.532', type: 'Stylesheet', url: 'http://127.0.0.1:41757/radar-benchmark.css', status: 200, timestamp: 200.790153 },
      { event: 'finished', id: '3329.532', encoded_bytes: 47760, timestamp: 200.789251 },
    ];
    const original = structuredClone(resources), result = fontResourceEvidence(resources);
    expect(resources).toEqual(original);
    expect(result.url_recoveries.map(resource => [resource.id, resource.type, resource.url_source])).toEqual([
      ['3329.531', 'Other', 'response'], ['3329.532', 'Stylesheet', 'response'],
    ]);
    expect(result.hash_resources).toEqual([]); expect(result.unresolved_resources).toEqual([]);
    expect(result.url_issues).toEqual([]); expect(result.font_failures).toEqual([]);
  });
  it('still hashes a finished font with a recovered URL even when the response arrives later in the list', () => {
    const result = fontResourceEvidence([
      { event: 'finished', id: 'font', encoded_bytes: 1200 },
      { event: 'response', id: 'font', type: 'Font', url: 'https://fonts.gstatic.com/s/font.woff2', status: 200 },
    ]);
    expect(result.hash_resources).toHaveLength(1);
    expect(result.hash_resources[0]).toMatchObject({ id: 'font', url: 'https://fonts.gstatic.com/s/font.woff2', type: 'Font', url_source: 'response' });
    expect(result.unresolved_resources).toEqual([]);
  });
  it('retains network and HTTP font failures, including failures without URLs or request events', () => {
    const result = fontResourceEvidence([
      { event: 'failed', id: 'unknown-font', type: 'Font', error: 'net::ERR_FAILED' },
      { event: 'response', id: 'http-font', type: 'Font', url: 'https://fonts.gstatic.com/font.woff2', status: 404 },
      { event: 'response', id: 'font-css', type: 'Stylesheet', url: 'https://fonts.googleapis.com/css2?family=Geist', status: 503 },
      { event: 'failed', id: 'bad-url', type: 'Font', url: 'invalid', error: 'net::ERR_FAILED' },
    ]);
    expect(result.font_failures.map(resource => resource.id)).toEqual(['unknown-font', 'http-font', 'font-css', 'bad-url']);
    expect(result.unresolved_resources.map(resource => resource.id)).toEqual(['unknown-font', 'bad-url']);
  });
  it('leaves an unknown completion or failure unresolved instead of assuming font success', () => {
    const result = fontResourceEvidence([
      { event: 'finished', id: 'unknown' }, { event: 'failed', id: 'unknown-failure', error: 'net::ERR_FAILED' },
      { event: 'finished', id: 'known-other', type: 'Other' },
    ]);
    expect(result.unresolved_resources.map(resource => resource.id)).toEqual(['unknown', 'unknown-failure']);
    expect(result.url_issues).toHaveLength(3); expect(result.hash_resources).toEqual([]);
  });
  it('recovers missing metadata from requests but preserves invalid explicit URLs for review', () => {
    const result = fontResourceEvidence([
      { event: 'request', id: 'font', type: 'Font', url: 'https://fonts.gstatic.com/font.woff2' },
      { event: 'finished', id: 'font' }, { event: 'failed', id: 'font', url: 'invalid', error: 'net::ERR_FAILED' },
    ]);
    expect(result.hash_resources[0].url_source).toBe('request');
    expect(result.font_failures[0]).toMatchObject({ url: 'invalid', type: 'Font', url_classification: 'invalid_url' });
    expect(result.unresolved_resources).toHaveLength(1);
  });
});
