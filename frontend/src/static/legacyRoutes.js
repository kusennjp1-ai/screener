const SYMBOL = /^[A-Za-z0-9.^-]{1,15}$/;

/**
 * Addresses of the retired screens (bookmarks, the installed app's start URL, older
 * notifications) open the matching brief screen instead of an empty page.
 */
export function legacyTarget(pathname = '/', search = '') {
  const symbol = new URLSearchParams(search).get('symbol');
  if (symbol && SYMBOL.test(symbol)) return `/brief/stock/${encodeURIComponent(symbol.toUpperCase())}`;
  if (/^\/(breadth|groups|themes)(\/|$)/.test(pathname)) return '/brief/market';
  if (/^\/(compare|scan)(\/|$)/.test(pathname)) return '/brief/list';
  return '/brief';
}
