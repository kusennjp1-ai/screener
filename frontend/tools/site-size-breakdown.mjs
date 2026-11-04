// Report where a site's bytes go. Read-only on DIST in both modes.
// Raw mode (a logical build): files the transport would pack are measured as
// gzip (level 6, as pack.mjs does); every other file counts at its raw size.
// Packed mode (a final Pages tree with static-data/_transport): exact lstat
// sizes and modelled GNU TAR bytes per logical family, through both transport
// layers (the outer codec and the nested financial audit codec).
// Usage: node tools/site-size-breakdown.mjs DIST [TOP]
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync, constants } from 'node:zlib';
import { isPackedData, MAX_SITE_BYTES, PREFIX } from '../src/static/transport/format.mjs';
import { exportFamilyOf, exportStatus, referencedExports } from './export-references.mjs';

export const AUDIT_PREFIX = 'static-data/_financial-audit-transport/';
export const TAR_LIMIT_BYTES = 1_000_000_000;
export const TOP_FILES = 40;
const BLOCK = 512, RECORD = 10240;

// Group by directory, keeping enough depth to tell data families apart.
export function groupOf(path) {
  const parts = path.split('/');
  const dirs = parts.slice(0, -1);
  if (dirs.length === 0) return path;
  return `${dirs.slice(0, dirs[0] === 'static-data' ? 3 : 2).join('/')}/`;
}

async function* walk(root, dir = root) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(root, path);
    else if (entry.isFile()) yield relative(root, path).split(sep).join('/');
  }
}

const encodingOf = group => group.packedFiles === group.files ? 'gzip' : group.packedFiles === 0 ? 'raw' : 'mixed';

export async function breakdown(root) {
  const groups = new Map();
  let total = 0, files = 0;
  for await (const path of walk(root)) {
    const packed = isPackedData(path);
    const bytes = packed
      ? gzipSync(await readFile(join(root, path)), { level: 6, strategy: constants.Z_DEFAULT_STRATEGY }).length
      : (await stat(join(root, path))).size;
    const key = groupOf(path);
    // The label is decided by every file in the group, not by the first one.
    const group = groups.get(key) || { group: key, files: 0, bytes: 0, packedFiles: 0 };
    group.files += 1; group.bytes += bytes; if (packed) group.packedFiles += 1; groups.set(key, group);
    total += bytes; files += 1;
  }
  for (const group of groups.values()) { group.encoding = encodingOf(group); group.packed = group.encoding === 'gzip'; }
  return { total, files, groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes) };
}

// Raw JSON bytes of one top-level field: "key":value plus separators.
const fieldBytes = (key, item) => Buffer.byteLength(JSON.stringify(item) ?? '') + Buffer.byteLength(key) + 4;

// Raw JSON bytes per top-level key across every file in one directory.
export async function fieldBreakdown(dir) {
  const fields = new Map();
  let files = 0;
  for await (const path of walk(dir)) {
    if (!path.endsWith('.json')) continue;
    let value;
    try { value = JSON.parse(await readFile(join(dir, path), 'utf8')); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    files += 1;
    for (const [key, item] of Object.entries(value)) fields.set(key, (fields.get(key) || 0) + fieldBytes(key, item));
  }
  return { files, fields: [...fields].map(([key, bytes]) => ({ key, bytes })).sort((a, b) => b.bytes - a.bytes) };
}

// GNU tar (default gnu format) as upload-pages-artifact runs it on ".": one
// 512-byte header per entry, data padded to 512, a ././@LongLink entry for a
// name over 100 bytes, two zero blocks, then padding to a 10240-byte record.
const blocks = bytes => Math.ceil(bytes / BLOCK) * BLOCK;
export function tarEntryBytes(name, size = 0) {
  const length = Buffer.byteLength(name);
  return BLOCK + blocks(size) + (length > 100 ? BLOCK + blocks(length + 1) : 0);
}
export const tarArchiveBytes = entryBytes => Math.ceil((entryBytes + 2 * BLOCK) / RECORD) * RECORD;
// check-pages-payload.py runs tar with --exclude=.[^/]* (and .git, .github).
const tarExcluded = path => path.split('/').some(part => part.startsWith('.'));

export async function isPackedDist(root) {
  try { return (await lstat(join(root, PREFIX))).isDirectory(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function scanTree(root) {
  const files = new Map(), dirs = [''];
  async function visit(directory) {
    const entries = (await readdir(join(root, directory), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1);
    for (const item of entries) {
      const path = directory ? `${directory}/${item.name}` : item.name;
      const info = await lstat(join(root, path));
      if (info.isDirectory()) { dirs.push(path); await visit(path); }
      else files.set(path, { bytes: info.size, regular: info.isFile() });
    }
  }
  await visit('');
  return { files, dirs };
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function readPinned(root, path, descriptor) {
  let bytes;
  try { bytes = await readFile(join(root, path)); }
  catch (error) { if (error.code === 'ENOENT') throw Error(`Missing referenced transport file: ${path}`); throw error; }
  if (bytes.length !== descriptor?.bytes || sha256(bytes) !== descriptor?.sha256) throw Error(`Transport metadata does not match its descriptor: ${path}`);
  return JSON.parse(bytes);
}

// Both layers: root, 256 shards, and each entry's assetPath -> logical path.
async function readLayer(root, base, expected) {
  if (!expected?.path) throw Error(`Missing ${base ? 'financial audit' : 'outer'} transport root descriptor`);
  const value = await readPinned(root, base + expected.path, expected);
  if (!Array.isArray(value.shards) || value.shards.length !== 256) throw Error('Transport root must list exactly 256 shards');
  const metadata = new Map([[base + expected.path, 'root']]);
  if (value.logicalInventory?.path) metadata.set(base + value.logicalInventory.path, 'logical inventory');
  if (value.physicalInventory?.path) metadata.set(base + value.physicalInventory.path, 'physical inventory');
  const entries = [];
  for (const shard of value.shards) {
    metadata.set(base + shard.path, 'shards');
    entries.push(...(await readPinned(root, base + shard.path, shard)).files);
  }
  return { metadata, entries };
}

const auditInternal = /^static-data\/research-details\/(source-projection|source-base|carry-projection)-([a-f0-9]{64})\.json$/;
const auditKind = path => /^static-data\/financial-corrections\/([a-z-]+?)-[a-f0-9]{64}\.json$/.exec(path)?.[1] || null;

function physicalMap(outer, audit) {
  const map = new Map();
  for (const [path, kind] of outer.metadata) map.set(path, { layer: 'outer', kind: 'metadata', metadata: kind, logical: [], decodedBytes: 0 });
  for (const entry of outer.entries) {
    const info = map.get(entry.assetPath) || { layer: 'outer', kind: entry.kind, logical: [], decodedBytes: 0 };
    info.logical.push(entry.path); info.decodedBytes += entry.decodedBytes; map.set(entry.assetPath, info);
  }
  if (audit) {
    // The outer codec stores the nested tree as identity files. Describe them by
    // what the nested codec says they are, mapped to canonical audit paths.
    for (const [path, kind] of audit.metadata) map.set(path, { layer: 'audit', kind: 'metadata', metadata: kind, logical: [], decodedBytes: 0 });
    for (const entry of audit.entries) {
      const physical = AUDIT_PREFIX + entry.assetPath, match = auditInternal.exec(entry.path);
      const logical = match ? `static-data/financial-corrections/${match[1]}-${match[2]}.json` : entry.path === 'static-data/manifest.json' ? null : AUDIT_PREFIX + entry.path;
      const info = map.get(physical)?.layer === 'audit' ? map.get(physical) : { layer: 'audit', kind: entry.kind, logical: [], decodedBytes: 0 };
      if (logical === null) info.special = `${AUDIT_PREFIX} manifest copy (audit codec)`;
      else info.logical.push(logical);
      info.decodedBytes += entry.decodedBytes; map.set(physical, info);
    }
  }
  return map;
}

async function readJsonIfPresent(root, path) {
  try { return JSON.parse(await readFile(join(root, path), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function context(root, publication, warnings) {
  const data = join(root, 'static-data');
  let references = null;
  try { references = await referencedExports(data); }
  catch (error) { warnings.push(`Export families left unclassified: ${error.message}`); }
  // Charts still named by the current charts index vs row symbols whose index
  // entry now points at a verified chart.
  const charts = { indexed: new Set(), verified: new Set(), available: false };
  const manifest = references?.manifest ?? await readJsonIfPresent(data, 'manifest.json');
  const chartsPath = (manifest?.markets?.US || manifest)?.assets?.charts?.path;
  if (chartsPath) {
    const index = await readJsonIfPresent(data, chartsPath);
    if (!index) warnings.push(`Charts index named by the manifest is missing: ${chartsPath}`);
    else {
      charts.available = true;
      for (const item of index.symbols || []) {
        if (typeof item?.path !== 'string') continue;
        charts.indexed.add(`static-data/${item.path}`);
        if (item.path.startsWith('verified-charts/')) charts.verified.add(item.symbol);
      }
    }
  }
  const active = publication?.financial_release?.path || null;
  let activeProjection = null;
  if (active) {
    const receipt = await readJsonIfPresent(root, active);
    if (!receipt) throw Error(`Missing referenced financial release receipt: ${active}`);
    activeProjection = receipt.evaluation_projection?.path || null;
  }
  return { references, charts, activeProjection };
}

function chartStatus(path, charts) {
  if (!charts.available) return 'unclassified';
  if (charts.indexed.has(path)) return 'still indexed';
  const symbol = decodeURIComponent(path.split('/').at(-1).replace(/\.json$/, ''));
  return charts.verified.has(symbol) ? 'superseded by verified-charts' : 'not indexed';
}

const hashedName = name => name.replace(/-[a-f0-9]{16}(?:[a-f0-9]{48})?(?=\.json(?:\.gz)?$)/, '-*');

/** The logical family of one canonical (logical) path. */
export function logicalFamily(path, ctx = {}) {
  if (!path.includes('/')) return path;
  if (!path.startsWith('static-data/')) return `${path.split('/')[0]}/`;
  const rest = path.slice('static-data/'.length);
  const exportFamily = exportFamilyOf(rest);
  if (exportFamily) {
    const status = ctx.references ? exportStatus(ctx.references, rest) : 'unclassified';
    if (exportFamily === 'candidate_history') {
      const which = status === 'referenced' ? (ctx.references.catalogSnapshots.has(rest) ? 'in catalog' : 'current, not in catalog')
        : status === 'lineage' ? 'performance lineage, not in catalog' : status;
      return `static-data/candidate-history/ snapshots (${which})`;
    }
    if (exportFamily === 'market_trends') return `static-data/${rest.replace(/-[a-f0-9]{64}\.json$/, '-*.json')} (${status})`;
    return `static-data/${hashedName(rest)} (${status})`;
  }
  let match;
  if ((match = /^markets\/([^/]+)\/charts\/(?!index\.json$)[^/]+\.json$/.exec(rest))) return `static-data/markets/${match[1]}/charts/ (${chartStatus(path, ctx.charts || {})})`;
  if ((match = /^markets\/([^/]+)\/scan\/chunks\//.exec(rest))) return `static-data/markets/${match[1]}/scan/chunks/`;
  if (rest.startsWith('markets/')) return path;
  if (rest.startsWith('financial-corrections/')) {
    const kind = auditKind(path) || 'other';
    if (kind === 'carry-projection' && ctx.activeProjection) return `static-data/financial-corrections/carry-projection (${path === ctx.activeProjection ? 'active' : 'earlier generations'})`;
    return `static-data/financial-corrections/${kind}`;
  }
  if (!rest.includes('/')) return `static-data/${hashedName(rest)}`;
  // Catalogs beside the export families keep their own names.
  if (/^(?:candidate-history|market-trends)\/[^/]+$/.test(rest)) return path;
  return `static-data/${rest.split('/')[0]}/`;
}

function familyFor(path, info, ctx) {
  if (path === 'publication.json') return 'publication.json';
  if (!info) return `${groupOf(path)} (not in either transport)`;
  if (info.special) return info.special;
  if (info.kind === 'metadata') return `${info.layer === 'audit' ? AUDIT_PREFIX : ''}${PREFIX} ${info.metadata} (${info.layer} codec)`;
  return logicalFamily(info.logical[0], ctx);
}

async function duplicates(root, files) {
  const bySize = new Map();
  for (const [path, file] of files) if (file.regular && file.bytes > 0) bySize.set(file.bytes, [...(bySize.get(file.bytes) || []), path]);
  const byHash = new Map();
  for (const [bytes, paths] of bySize) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      const hash = await fileHash(join(root, path)), key = `${hash}:${bytes}`;
      byHash.set(key, [...(byHash.get(key) || []), path]);
    }
  }
  return [...byHash].filter(([, paths]) => paths.length > 1).map(([key, paths]) => {
    const [hash, bytes] = key.split(':');
    return { sha256: hash, bytes: Number(bytes), count: paths.length, wasted: (paths.length - 1) * Number(bytes), paths: paths.sort() };
  }).sort((a, b) => b.wasted - a.wasted || (a.paths[0] < b.paths[0] ? -1 : 1));
}

// Decoded raw JSON bytes per row field of the packed scan chunks, plus a
// column-wise gzip estimate of what each field adds to the hosted bins.
async function scanChunkFields(root, physical) {
  const fields = new Map(), top = new Map();
  let chunks = 0, rows = 0, encoded = 0, decoded = 0;
  for (const [path, info] of physical) {
    if (info.kind !== 'gzip' || !info.logical.some(logical => /^static-data\/markets\/[^/]+\/scan\/chunks\/[^/]+\.json$/.test(logical))) continue;
    const bytes = await readFile(join(root, path)), raw = gunzipSync(bytes), value = JSON.parse(raw);
    chunks += 1; encoded += bytes.length; decoded += raw.length;
    const list = Array.isArray(value?.rows) ? value.rows : [];
    rows += list.length;
    for (const [key, item] of Object.entries(value || {})) if (key !== 'rows') top.set(key, (top.get(key) || 0) + fieldBytes(key, item));
    const keys = new Set(list.flatMap(row => row && typeof row === 'object' ? Object.keys(row) : []));
    for (const key of keys) {
      const field = fields.get(key) || { key, rows: 0, bytes: 0, gzipBytes: 0 };
      const column = [];
      for (const row of list) if (row && Object.hasOwn(row, key)) { field.rows += 1; field.bytes += fieldBytes(key, row[key]); column.push(row[key]); }
      field.gzipBytes += gzipSync(JSON.stringify(column), { level: 6 }).length;
      fields.set(key, field);
    }
  }
  return { chunks, rows, encoded, decoded, fields: [...fields.values()].sort((a, b) => b.bytes - a.bytes), chunkFields: [...top].map(([key, bytes]) => ({ key, bytes })).sort((a, b) => b.bytes - a.bytes) };
}

async function auditGenerations(root, publication, physical, files) {
  const declared = publication?.financial_audit_files;
  if (!declared || typeof declared !== 'object') return [];
  const hosted = new Map();
  for (const [path, info] of physical) for (const logical of info.logical) hosted.set(logical, files.get(path)?.bytes ?? null);
  const rows = [];
  for (const path of Object.keys(declared).filter(path => auditKind(path) === 'release').sort()) {
    const receipt = await readJsonIfPresent(root, path);
    if (!receipt) throw Error(`Missing referenced financial release receipt: ${path}`);
    const projection = receipt.evaluation_projection?.path || null;
    // Diagnostic only: an older carry moved to the public archive is not hosted.
    const archived = projection && !hosted.has(projection) ? publication?.financial_audit_archive?.files?.[projection] ?? null : null;
    rows.push({ receipt: path, receiptBytes: files.get(path)?.bytes ?? null, mode: receipt.mode ?? null, evaluatedAt: receipt.evaluated_at ?? null,
      generation: receipt.financial_generation ?? null, projection, projectionKind: projection ? auditKind(projection) : null,
      projectionBytes: projection ? hosted.get(projection) ?? null : null, active: path === publication.financial_release?.path,
      archived: Boolean(archived), archiveUrl: archived?.url ?? null });
  }
  return rows.sort((a, b) => String(a.evaluatedAt).localeCompare(String(b.evaluatedAt)) || (a.receipt < b.receipt ? -1 : 1));
}

/** Exact per-family bytes of a final packed Pages tree. Never writes to root. */
export async function packedBreakdown(root) {
  root = resolve(root);
  const warnings = [];
  const publication = await readJsonIfPresent(root, 'publication.json');
  if (!publication?.transport?.root) throw Error('Packed dist lacks a publication.json transport descriptor');
  const outer = await readLayer(root, '', publication.transport.root);
  const audit = publication.financial_audit_transport ? await readLayer(root, AUDIT_PREFIX, publication.financial_audit_transport.root) : null;
  const physical = physicalMap(outer, audit);
  const ctx = await context(root, publication, warnings);
  const { files, dirs } = await scanTree(root);
  const families = new Map(), rows = [];
  let fileBytes = 0, entryBytes = 0;
  const add = (family, encoding, bytes, tar, decoded) => {
    const row = families.get(family) || { family, files: 0, bytes: 0, tarBytes: 0, decodedBytes: 0, encodings: new Set() };
    if (encoding) { row.files += 1; row.encodings.add(encoding); }
    row.bytes += bytes; row.tarBytes += tar; row.decodedBytes += decoded; families.set(family, row);
  };
  for (const [path, file] of files) {
    const info = physical.get(path), family = familyFor(path, info, ctx);
    const encoding = info?.kind === 'gzip' ? 'gzip' : 'raw', tar = tarExcluded(path) ? 0 : tarEntryBytes(`./${path}`, file.bytes);
    const decoded = info?.kind === 'gzip' ? info.decodedBytes : file.bytes;
    add(family, encoding, file.bytes, tar, decoded);
    fileBytes += file.bytes; entryBytes += tar;
    rows.push({ path, bytes: file.bytes, tarBytes: tar, family, logical: info?.logical || [] });
  }
  if (!files.size) throw Error('Packed dist has no files');
  for (const path of physical.keys()) if (!files.has(path) && !physical.get(path).special) warnings.push(`Transport names a file absent from the tree: ${path}`);
  for (const dir of dirs) {
    if (dir && tarExcluded(dir)) continue;
    const tar = tarEntryBytes(dir ? `./${dir}/` : './', 0);
    add('(directory entries)', null, 0, tar, 0); entryBytes += tar;
  }
  const tarBytes = tarArchiveBytes(entryBytes);
  add('(end-of-archive blocks and record padding)', null, 0, tarBytes - entryBytes, 0);
  const familyRows = [...families.values()].map(({ encodings, ...row }) => ({ ...row, encoding: encodings.size === 0 ? '-' : encodings.size === 1 ? [...encodings][0] : 'mixed' }))
    .sort((a, b) => b.tarBytes - a.tarBytes || (a.family < b.family ? -1 : 1));
  const superseded = rows.filter(row => row.family.endsWith('(superseded)')).sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  return {
    mode: 'packed', files: files.size, directories: dirs.length, fileBytes, tarBytes,
    fileHeadroom: MAX_SITE_BYTES - fileBytes, tarHeadroom: TAR_LIMIT_BYTES - tarBytes,
    families: familyRows, superseded,
    topFiles: [...rows].sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1)).slice(0, TOP_FILES),
    duplicates: await duplicates(root, files),
    audit: await auditGenerations(root, publication, physical, files),
    scanChunks: await scanChunkFields(root, physical),
    warnings,
  };
}

const int = value => (value === null || value === undefined ? '-' : value.toLocaleString('en-US'));
const column = (value, width) => int(value).padStart(width);

export function formatPacked(result, top = 60) {
  const lines = [];
  lines.push(`Final Pages payload (packed transport, exact lstat bytes; TAR modelled as GNU tar on "."): ${int(result.files)} files, ${int(result.directories)} directories`);
  lines.push(`  file bytes ${int(result.fileBytes)} of ${int(MAX_SITE_BYTES)} (headroom ${int(result.fileHeadroom)})`);
  lines.push(`  TAR bytes  ${int(result.tarBytes)} of ${int(TAR_LIMIT_BYTES)} (headroom ${int(result.tarHeadroom)})`);
  for (const warning of result.warnings) lines.push(`::warning::${warning}`);
  lines.push(`Per logical family (top ${top} by TAR bytes): file bytes | TAR bytes | decoded bytes | files | encoding | family`);
  for (const row of result.families.slice(0, top)) {
    lines.push(`${column(row.bytes, 13)} ${column(row.tarBytes, 13)} ${column(row.decodedBytes, 13)} ${column(row.files, 6)} ${row.encoding.padEnd(5)} ${row.family}`);
  }
  if (result.families.length > top) {
    const rest = result.families.slice(top);
    lines.push(`${column(rest.reduce((s, r) => s + r.bytes, 0), 13)} ${column(rest.reduce((s, r) => s + r.tarBytes, 0), 13)} ${''.padStart(13)} ${column(rest.reduce((s, r) => s + r.files, 0), 6)}       (${rest.length} smaller families)`);
  }
  const supersededBytes = result.superseded.reduce((sum, row) => sum + row.bytes, 0), supersededTar = result.superseded.reduce((sum, row) => sum + row.tarBytes, 0);
  lines.push(`Superseded export files no manifest, workbench, catalog or performance cohort references: ${result.superseded.length} files, ${int(supersededBytes)} bytes, ${int(supersededTar)} TAR bytes`);
  for (const row of result.superseded) lines.push(`${column(row.bytes, 13)} ${column(row.tarBytes, 13)} ${row.path}`);
  if (result.audit.length) {
    lines.push(`Financial audit generations (${result.audit.length} release receipts, oldest first): evaluated_at | mode | generation | evaluation projection hosted bytes | receipt bytes`);
    for (const row of result.audit) {
      lines.push(`  ${String(row.evaluatedAt).padEnd(26)} ${String(row.mode).padEnd(10)} ${String(row.generation).slice(0, 12).padEnd(12)} ${String(row.projectionKind).padEnd(17)} ${column(row.projectionBytes, 12)} ${column(row.receiptBytes, 8)}${row.active ? '  (active)' : ''}${row.archived ? `  (archived ${row.archiveUrl})` : ''}`);
    }
  }
  lines.push(`Top ${result.topFiles.length} hosted files: bytes | TAR bytes | path [logical path] family`);
  for (const row of result.topFiles) {
    const logical = row.logical.length && row.logical[0] !== row.path ? ` [${row.logical.join(', ')}]` : '';
    lines.push(`${column(row.bytes, 13)} ${column(row.tarBytes, 13)} ${row.path}${logical} ${row.family}`);
  }
  const wasted = result.duplicates.reduce((sum, group) => sum + group.wasted, 0);
  lines.push(`Exact sha256 duplicates: ${result.duplicates.length} groups, ${int(wasted)} bytes beyond the first copy`);
  for (const group of result.duplicates.slice(0, 25)) {
    const paths = group.paths.slice(0, 4).join(' = ') + (group.count > 4 ? ` = ... (${group.count - 4} more)` : '');
    lines.push(`${column(group.bytes, 13)} x${group.count} ${group.sha256.slice(0, 12)} ${paths}`);
  }
  const scan = result.scanChunks;
  if (scan.chunks) {
    lines.push(`Scan chunks: ${scan.chunks} packed chunks, ${int(scan.rows)} rows, ${int(scan.encoded)} hosted gzip bytes, ${int(scan.decoded)} decoded bytes`);
    lines.push('Decoded row fields (top 40): raw bytes | share | column-gzip bytes (estimate) | rows | field');
    for (const field of scan.fields.slice(0, 40)) {
      lines.push(`${column(field.bytes, 13)} ${(field.bytes / Math.max(1, scan.decoded) * 100).toFixed(1).padStart(5)}% ${column(field.gzipBytes, 12)} ${column(field.rows, 7)} ${field.key}`);
    }
    for (const field of scan.chunkFields.slice(0, 10)) lines.push(`${column(field.bytes, 13)} (chunk-level) ${field.key}`);
  }
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, top = '30'] = process.argv.slice(2);
  if (!root) throw new Error('Usage: node tools/site-size-breakdown.mjs DIST [TOP]');
  const dist = resolve(root);
  const mb = value => (value / 1e6).toFixed(1).padStart(8);
  if (await isPackedDist(dist)) {
    // Warnings are part of the report (printed as ::warning:: lines); only a
    // thrown error means the breakdown itself is unavailable.
    const result = await packedBreakdown(dist);
    for (const line of formatPacked(result, Number(top))) console.log(line);
  } else {
    const result = await breakdown(dist);
    console.log(`Site size estimate: ${mb(result.total)} MB in ${result.files} files (budget ${MAX_SITE_BYTES / 1e6} MB; packed files as gzip, others raw)`);
    for (const group of result.groups.slice(0, Number(top))) {
      console.log(`${mb(group.bytes)} MB ${String(group.files).padStart(6)} files ${group.encoding.padEnd(5)} ${group.group}`);
    }
  }
  for (const dir of ['static-data/verified-charts', 'static-data/markets/us/charts']) {
    let fields;
    try { fields = await fieldBreakdown(join(dist, dir)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    console.log(`Raw bytes per field in ${dir} (${fields.files} files):`);
    for (const field of fields.fields.slice(0, 25)) console.log(`${mb(field.bytes)} MB ${field.key}`);
  }
}
