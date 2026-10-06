// Supply real streaming bootstrap bytes for legacy-site UI fixtures. Keep the
// existing fetch spy and asset responses so routing/network assertions retain
// their meaning; absence of publication.json is an explicit HTTP 404.
const prepared = new WeakSet();
export function prepareLegacyStaticFetch(fetcher) {
  if (prepared.has(fetcher)) return;
  const read = fetcher.getMockImplementation();
  fetcher.mockImplementation(async (url, ...options) => {
    const path = new URL(url, location.href).pathname;
    if (path.endsWith('/publication.json')) return { ok: false, status: 404 };
    const response = await read(url, ...options);
    if (path.endsWith('/static-data/manifest.json') && response.ok && !response.body) {
      const bytes = new Uint8Array(new TextEncoder().encode(JSON.stringify(await response.json())));
      return { ...response, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
    }
    return response;
  });
  prepared.add(fetcher);
}
