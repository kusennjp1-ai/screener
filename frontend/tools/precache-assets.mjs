// Keep every static route ready offline, including lazily loaded pages, while
// avoiding downloads for the separate backend application in a Pages build.
export function precacheAssets(bundle, { staticSite = false } = {}) {
  if (!staticSite) return Object.keys(bundle);
  const selected = new Set(Object.entries(bundle).filter(([,item]) => item.type !== 'chunk').map(([name]) => name));
  const visit = name => {
    if (selected.has(name)) return;
    const chunk = bundle[name];
    if (!chunk || chunk.type !== 'chunk') throw Error(`Unknown precache chunk: ${name}`);
    selected.add(name);
    for (const child of chunk.imports || []) if (bundle[child]) visit(child);
    for (const child of chunk.dynamicImports || []) {
      if (!bundle[child]) throw Error(`Unknown dynamic precache chunk: ${child}`);
      // Rollup may merge a dynamic entry with shared exports and clear its
      // facadeModuleId. moduleIds still identifies the backend boundary.
      const target = bundle[child];
      const modules = [target.facadeModuleId, ...(target.moduleIds || [])];
      if (modules.some(id => id?.replaceAll('\\','/').endsWith('/src/ServerApp.jsx'))) continue;
      visit(child);
    }
  };
  const entries=Object.entries(bundle).filter(([,item])=>item.type==='chunk'&&item.isEntry);
  if (!entries.length) throw Error('Precache entry chunk is missing');
  for (const [name] of entries) visit(name);
  return Object.keys(bundle).filter(name=>selected.has(name));
}
