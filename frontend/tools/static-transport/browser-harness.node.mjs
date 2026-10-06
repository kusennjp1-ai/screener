import test from 'node:test';
import assert from 'node:assert/strict';
import { browserContracts, buildBrowserFixture, EXPECTED_CASES, startFixtureServer } from './browser-contract.mjs';

// Validates the shared harness with native Node web APIs and a local fixture
// server. This deliberately does not import Playwright or launch a browser.
test('browser harness fixtures and contract logic pass under Node web APIs', async () => {
  const fixture = await buildBrowserFixture(), server = await startFixtureServer(fixture);
  try {
    const result = await browserContracts({ ...fixture, moduleRoot: new URL('../../src/static/transport/', import.meta.url).href, baseURL: `${server.origin}/fixture/`, quiet: true });
    assert.equal(result.failed, 0, JSON.stringify(result.cases.filter(item => item.status === 'failed')));
    assert.equal(result.passed, EXPECTED_CASES);
    const http = result.cases.find(item => item.name.startsWith('native HTTP gzip/br wrappers'));
    assert.equal(http.details.nativeHTTP, true);
    assert.deepEqual(http.details.observed.map(item => item.encoding), ['gzip', 'br']);
    assert.ok(http.details.observed.every(item => item.verifiedResponses >= 4));
    assert.equal(http.details.mislabeledStoredGzipRejected, true);
    assert.equal(http.details.mutatedIdentityRejected, true);
  } finally { await server.close(); }
});
