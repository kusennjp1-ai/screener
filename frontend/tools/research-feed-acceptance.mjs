// Browser observations for the research task. Keep this separate from timing:
// scrolling into view must never manufacture first-viewport acceptance.
export const FEED_REVIEW_VIEWPORTS = [{ width: 1440, height: 760 }, { width: 360, height: 844 }, { width: 360, height: 568 }];
export const FEED_REVIEW_METHODS = ['minervini', 'minervini2', 'oneil', 'ibd'];

export function researchFeedMetrics() {
  const rect = node => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
  };
  const shown = node => {
    if (!node || node.closest('[hidden],[aria-hidden="true"]')) return false;
    const box = rect(node);
    if (!box.width || !box.height) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  const header = document.querySelector('.leader-header'), nav = document.querySelector('.leader-mobile-nav');
  const top = shown(header) ? rect(header).bottom : 0, bottom = shown(nav) ? rect(nav).top : innerHeight;
  const firstViewport = node => {
    if (!shown(node)) return false;
    const box = rect(node);
    if (box.top < top - .1 || box.bottom > bottom + .1 || box.left < -.1 || box.right > innerWidth + .1) return false;
    for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent), clip = rect(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (box.top < clip.top - .1 || box.bottom > clip.bottom + .1)) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (box.left < clip.left - .1 || box.right > clip.right + .1)) return false;
    }
    const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    return Boolean(hit && (node.contains(hit) || hit.contains(node)));
  };
  const observe = node => node ? { text: node.textContent.trim(), shown: shown(node), firstViewport: firstViewport(node), rect: rect(node) } : null;
  const metrics = root => ['eps_growth_yy', 'sales_growth_yy', 'annual_eps_growth_3y'].flatMap(id => {
    const node = root?.querySelector(`[data-metric="${id}"]`);
    return node ? [{ id, state: node.dataset.state, actual: observe(node.querySelector('.financial-summary-result strong')),
      status: observe(node.querySelector('.financial-summary-result > span')), role: observe(node.querySelector('.financial-evidence-role')),
      condition: observe(node.querySelector('.financial-growth-condition')), period: observe(node.querySelector('.financial-growth-period')),
      source: observe(node.querySelector('.financial-growth-source')) }] : [];
  });
  const card = document.querySelector('.candidate-feed-card'), summary = document.querySelector('.research-detail .financial-evidence-summary');
  const chart = document.querySelector('.research-detail .research-chart'), trace = card?.querySelector('.feed-price-trace img');
  const blockers = [...document.querySelectorAll('.research-detail [aria-label="日次の未達・未確認"] > span')].map(node => ({
    state: node.dataset.state, ...observe(node), label: node.textContent.replace(/^(?:× 未達|\? 未確認)\s*·\s*/, '').trim(),
  }));
  return { viewport: { width: innerWidth, height: innerHeight }, scrollY, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    method: document.querySelector('.research-list .method-tabs [aria-pressed="true"]')?.textContent.trim() || null,
    feed: { symbol: card?.querySelector('.candidate-name strong')?.textContent.trim() || null, metrics: metrics(card),
      next: observe(card?.querySelector('.feed-next-check > span')), other: observe(card?.querySelector('.feed-other-checks')),
      trace: trace ? { shown: shown(trace), loaded: trace.complete && trace.naturalWidth > 0, alt: trace.alt } : null,
      traceUnavailable: observe(card?.querySelector('.feed-trace-unavailable')) },
    detail: { symbol: document.querySelector('.symbol-title h2')?.textContent.trim() || null, metrics: metrics(summary),
      summary: observe(summary), chart: observe(chart), evidenceBeforeChart: Boolean(summary && chart && summary.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING),
      entry: observe(document.querySelector('.research-detail .entry-evidence')), blockers,
      completeDaily: /日次モデルの条件をすべて通過/.test(document.querySelector('.research-detail .entry-evidence')?.textContent || '') },
  };
}

export function checkResearchFeedMetrics(metrics, check, key, { surface = 'feed', firstViewport = true } = {}) {
  check(!metrics.horizontalOverflow, `${key}: horizontal body overflow`);
  const evidence = metrics[surface];
  check(Boolean(evidence?.symbol), `${key}: ${surface} symbol is missing`);
  const ids = surface === 'detail' ? ['eps_growth_yy', 'sales_growth_yy', 'annual_eps_growth_3y'] : ['eps_growth_yy', 'sales_growth_yy'];
  for (const id of ids) {
    const row = evidence?.metrics.find(row => row.id === id);
    check(Boolean(row), `${key}: ${id} evidence is missing`);
    if (!row) continue;
    check(['pass', 'fail', 'unknown', 'reference'].includes(row.state), `${key}: ${id} has no explicit evidence state`);
    for (const field of ['actual', 'status', 'role', 'condition', 'period', 'source']) {
      check(Boolean(row[field]?.shown && row[field].text), `${key}: ${id} ${field} is hidden or empty`);
      if (surface === 'feed' && firstViewport && ['actual', 'status', 'role', 'condition'].includes(field)) {
        check(row[field]?.firstViewport === true, `${key}: first-card ${id} ${field} is outside the unobscured first viewport`);
      }
    }
    check(['必須', '参考'].includes(row.role?.text), `${key}: ${id} required/reference role is ambiguous`);
    check(!['—', '–', '-', 'N/A'].includes(row.actual?.text), `${key}: ${id} must state actual evidence or explicitly 未確認`);
    if (row.actual?.text === '未確認') check(row.state === 'unknown', `${key}: ${id} unknown actual must not qualify`);
  }
  if (surface === 'feed') {
    check(Boolean(evidence?.next?.shown && evidence.next.text), `${key}: named next check is missing`);
    check(Boolean(evidence?.trace?.shown && evidence.trace.loaded && evidence.trace.alt) || Boolean(evidence?.traceUnavailable?.shown && /未確認/.test(evidence.traceUnavailable.text)), `${key}: price trace must load or explicitly state unavailable`);
  } else {
    check(Boolean(evidence?.summary?.shown && evidence.chart?.shown && evidence.evidenceBeforeChart && evidence.summary.rect.bottom <= evidence.chart.rect.top + .1), `${key}: complete financial evidence must precede the full chart`);
    check(Boolean(evidence?.entry?.shown && (evidence.blockers.length || evidence.completeDaily)), `${key}: named daily blockers or an explicit completed-daily state are missing`);
    for (const blocker of evidence?.blockers || []) check(Boolean(blocker.shown && blocker.label && ['fail', 'unknown'].includes(blocker.state)), `${key}: daily blocker name/state is missing`);
  }
}

export function checkFeedDetailConsistency(feed, detail, check, key) {
  check(feed.symbol === detail.symbol, `${key}: selected detail differs from the chosen feed symbol`);
  for (const expected of feed.metrics) {
    const actual = detail.metrics.find(row => row.id === expected.id);
    check(Boolean(actual) && actual.state === expected.state, `${key}: ${expected.id} state changed between feed and detail`);
    for (const field of ['actual', 'role', 'condition', 'period', 'source']) check(actual?.[field]?.text === expected[field]?.text, `${key}: ${expected.id} ${field} differs between feed and detail`);
  }
  const named = `${feed.next?.text || ''} ${feed.other?.text || ''}`;
  for (const blocker of detail.blockers) check(named.includes(`${blocker.label}：${blocker.state === 'unknown' ? '未確認' : '未達'}`), `${key}: feed omits daily blocker ${blocker.label} or its state`);
  if (detail.blockers.length > 1) check(Boolean(feed.other?.shown && feed.other.text), `${key}: parallel blockers must remain named on the feed`);
}

// Handles the emitted CSV's quoted commas, escaped quotes and line breaks.
export function parseResearchCsv(text) {
  const rows = [], row = [];
  let value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\uFEFF' && i === 0) continue;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\r' || char === '\n')) {
      row.push(value); value = '';
      if (char !== ',') { rows.push([...row]); row.length = 0; if (char === '\r' && text[i + 1] === '\n') i++; }
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  if (quoted) throw Error('Unterminated CSV field');
  const [header, ...data] = rows;
  if (!header?.includes('symbol') || !header.includes('method')) throw Error('Research CSV identity columns are missing');
  return data.map(values => Object.fromEntries(header.map((name, index) => [name, values[index]])));
}
