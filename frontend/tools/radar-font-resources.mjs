// Network.loadingFinished has no URL or type of its own. Keep the raw events,
// then correlate with either requestWillBeSent or responseReceived by request ID.
const fontHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export function classifyResourceUrl(value) {
  if (value == null || value === '') return 'missing_url';
  if (typeof value !== 'string') return 'invalid_url';
  try { return fontHosts.has(new URL(value).hostname) ? 'font_service' : 'other'; }
  catch { return 'invalid_url'; }
}

export function fontResourceEvidence(resources) {
  const metadata = new Map();
  for (const resource of resources) {
    if (!['request', 'response'].includes(resource.event)) continue;
    const previous = metadata.get(resource.id) || {};
    const classification = classifyResourceUrl(resource.url);
    metadata.set(resource.id, { ...previous,
      ...(resource.type ? { type: resource.type } : {}),
      ...(['font_service', 'other'].includes(classification) ? { url: resource.url, url_source: resource.event } : {}) });
  }
  const classified = resources.map(resource => {
    const related = metadata.get(resource.id) || {};
    const recover = classifyResourceUrl(resource.url) === 'missing_url' && related.url;
    const url = recover ? related.url : resource.url;
    return { ...resource, url, type: resource.type || related.type,
      url_classification: classifyResourceUrl(url), url_source: recover ? related.url_source : 'event' };
  });
  const isFont = resource => resource.type === 'Font' || resource.url_classification === 'font_service';
  const urlIssues = classified.filter(resource => ['missing_url', 'invalid_url'].includes(resource.url_classification));
  return {
    hash_resources: classified.filter(resource => resource.event === 'finished' && resource.url_classification === 'font_service'),
    font_failures: classified.filter(resource => isFont(resource) &&
      (resource.event === 'failed' || resource.event === 'response' && resource.status >= 400)),
    // Unknown type + unknown URL cannot safely be assumed to be unrelated to fonts.
    unresolved_resources: urlIssues.filter(resource => resource.type === 'Font' || !resource.type),
    url_issues: urlIssues,
    url_recoveries: classified.filter(resource => resource.url_source !== 'event'),
  };
}
