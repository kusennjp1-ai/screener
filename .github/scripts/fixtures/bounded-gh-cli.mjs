// Test-only adapter for legacy offline gh fixture maps. Never performs I/O
// beyond their original stdout. Production transport does not import this file.
export function installBoundedFixtureTransport() {
  const args = process.argv.slice(2);
  if (!args.includes('--include')) return;
  // This pre-existing quota fixture has its own exact parser and raw headers.
  if (JSON.stringify(args) === JSON.stringify(['api','--hostname','github.com','--method','GET','--include',
    'rate_limit','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'])) return;
  if (args.length !== 7 || args[0] !== 'api' || args[2] !== '--hostname' ||
      args[3] !== 'github.com' || args[4] !== '--include' ||
      args[5] !== '--method' || args[6] !== 'GET') throw Error('Unexpected bounded fixture command');
  const url = new URL(args[1]);
  if (url.origin !== 'https://api.github.com' || url.username || url.password || url.hash ||
      !url.pathname.startsWith('/repos/kusennjp1-ai/screener/actions/')) throw Error('Unexpected bounded fixture origin');
  const rawPage = url.searchParams.get('page');
  if (url.searchParams.getAll('page').length > 1 ||
      (rawPage !== null && !/^[1-9][0-9]*$/.test(rawPage))) throw Error('Invalid bounded fixture page');
  const page = rawPage === null ? 1 : Number(rawPage);
  if (!Number.isSafeInteger(page) || page > 100 || url.searchParams.get('per_page') !== '100')
    throw Error('Invalid bounded fixture page size');
  const base = new URL(url); base.searchParams.delete('page');
  const endpoint = base.pathname.slice(1) + base.search;
  process.argv.splice(2, Infinity, 'api', '--paginate', '--slurp', endpoint);
  const write = process.stdout.write.bind(process.stdout);
  let emitted = false;
  process.stdout.write = (chunk, ...rest) => {
    if (emitted) throw Error('Repeated bounded fixture output');
    emitted = true;
    const value = JSON.parse(String(chunk));
    const pages = Array.isArray(value) ? value : [value];
    const key = ['workflow_runs', 'jobs', 'artifacts'].find(k =>
      pages.length > 0 && pages.every(p => p && Array.isArray(p[k])));
    if (!key) throw Error('Missing bounded fixture inventory');
    const rows = pages.flatMap(p => p[key]);
    for (const p of pages) if (p.total_count !== undefined && p.total_count !== rows.length)
      throw Error('Incomplete bounded fixture inventory');
    const last = Math.max(1, Math.ceil(rows.length / 100));
    if (page > last) throw Error('Bounded fixture page outside inventory');
    const body = { ...pages[0], total_count: rows.length, [key]: rows.slice((page - 1) * 100, page * 100) };
    let head = 'HTTP/2 200 OK\r\nContent-Type: application/json\r\n';
    if (page < last) {
      const next = new URL(base), end = new URL(base);
      next.searchParams.set('page', String(page + 1)); end.searchParams.set('page', String(last));
      head += 'Link: <' + next.href + '>; rel="next", <' + end.href + '>; rel="last"\r\n';
    }
    return write(head + '\r\n' + JSON.stringify(body), ...rest);
  };
}

export const boundedGhCliPrelude = '(' + installBoundedFixtureTransport.toString() + ')();\n';
