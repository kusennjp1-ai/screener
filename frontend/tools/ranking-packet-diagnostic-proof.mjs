// Shared Node/browser verification. Hash one copy of the rows, while requiring
// every rank, portfolio candidate and temporal index to bind to those objects.
export function researchProofValue(bundle) {
  if (!Array.isArray(bundle.rows)) throw Error('Missing proof rows');
  const ids = new Map(bundle.rows.map((row, index) => [row, index]));
  if (ids.size !== bundle.rows.length) throw Error('Duplicate proof row objects');
  const idFor = row => {
    if (!ids.has(row)) throw Error('Lost shared research row identity');
    return ids.get(row);
  };
  const methods = ['minervini', 'minervini2', 'oneil', 'ibd'];
  if (Object.keys(bundle.rankings).sort().join(',') !== [...methods].sort().join(',')) throw Error('Incomplete proof methods');
  const rankings = Object.fromEntries(methods.map(method => {
    const ranked = bundle.rankings[method];
    if (ranked.length !== bundle.rows.length) throw Error('Incomplete proof ranking');
    const items = ranked.map(({row, assessment}) => ({id:idFor(row), assessment}));
    if (new Set(items.map(item => item.id)).size !== bundle.rows.length) throw Error('Duplicate proof ranking rows');
    return [method, items];
  }));
  if (bundle.temporal?.rows !== bundle.rows || bundle.temporal.date !== bundle.date
    || !Array.isArray(bundle.temporal.session_intervals) || !Array.isArray(bundle.temporal.readiness_boundaries)) throw Error('Lost shared temporal proof');
  return {...bundle, rankings, prepared:{...bundle.prepared,candidates:bundle.prepared.candidates.map(idFor)},
    temporal:{...bundle.temporal,rows:'verified-row-array-binding'}};
}

// Typed encoding distinguishes missing/undefined/null, nonfinite numbers, -0,
// strings and object shapes; unlike JSON alone it cannot normalize those values.
export function encodeProof(value) {
  if (value === null) return 'null;';
  if (value === undefined) return 'undefined;';
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  if (typeof value === 'number') return `number:${Object.is(value,-0) ? '-0' : String(value)};`;
  if (typeof value === 'boolean') return `boolean:${value};`;
  if (Array.isArray(value)) return `array:${value.length}:[${Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i) ? encodeProof(value[i]) : 'hole;').join('')}]`;
  if (typeof value !== 'object' || ![null,Object.prototype].includes(Object.getPrototypeOf(value))) throw Error('Unsupported diagnostic proof value');
  const keys=Object.keys(value).sort();
  return `object:${keys.length}:{${keys.map(key=>encodeProof(key)+encodeProof(value[key])).join('')}}`;
}

export async function fingerprintResearchBundle(bundle) {
  const proof=researchProofValue(bundle),encoded=new TextEncoder().encode(encodeProof(proof));
  const digest=await crypto.subtle.digest('SHA-256',encoded);
  return {sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),proof_bytes:encoded.byteLength,
    rows:bundle.rows.length,ranking_counts:Object.fromEntries(Object.entries(proof.rankings).map(([method,items])=>[method,items.length])),
    endpoints:Object.fromEntries(Object.entries(proof.rankings).map(([method,items])=>[method,{first:items[0]?.id??null,last:items.at(-1)?.id??null}])),
    all_rank_row_identities:true,prepared_row_identities:true,temporal_row_identity:true};
}
