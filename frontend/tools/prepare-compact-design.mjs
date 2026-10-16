import { copyFile, mkdir, readdir, stat, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMPACT_TOTAL_LIMIT = 128 * 1024 * 1024;
export const COMPACT_FILE_LIMIT = 32 * 1024 * 1024;
export const DIAGNOSTIC_FILE_LIMIT = 16 * 1024 * 1024;
export const COMPACT_REPORTS = ['report.json', 'summary.md', 'financial-carry-evidence.json'];
export const COMPACT_DIAGNOSTICS = [
  'diagnostic-initial-1440.cpuprofile', 'diagnostic-method-1440.cpuprofile',
  'diagnostic-initial-1440.trace.json', 'diagnostic-method-1440.trace.json',
  'radar-diagnostic/report.json',
  'radar-diagnostic/radar-1440.cpuprofile', 'radar-diagnostic/radar-1440.trace.json',
  'radar-diagnostic/radar-390.cpuprofile', 'radar-diagnostic/radar-390.trace.json',
];

// Stage a bounded download; the complete evidence artifact remains unchanged.
// All existing reports and screenshots are retained together or staging fails.
// Optional diagnostics may be omitted with an explicit reason, never replacing
// acceptance evidence or changing any performance/screenshot/financial gate.
export async function prepareCompactDesign(source, target, limits = {}) {
  const totalLimit = limits.total ?? COMPACT_TOTAL_LIMIT;
  const fileLimit = limits.file ?? COMPACT_FILE_LIMIT;
  const diagnosticLimit = limits.diagnostic ?? DIAGNOSTIC_FILE_LIMIT;
  if (![totalLimit, fileLimit, diagnosticLimit].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('Invalid compact artifact limits');
  const directoryExists = async path => {
    try {
      const info = await lstat(path);
      if (!info.isDirectory()) throw Error(`Compact evidence directory must not be a symlink or other file: ${path}`);
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  await directoryExists(source);
  await directoryExists(target);
  // Early build failures may have no report directory. Preserve the upload's
  // existing missing-files warning behavior rather than inventing a new failure.
  const entries = await readdir(source, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const screenshots = entries.filter(entry => entry.name.endsWith('.png')).map(entry => entry.name).sort();
  const files = [], omitted = []; let bytes = 0;
  const inspect = async path => {
    try {
      const parents = path.split('/').slice(0, -1);
      for (let end = 1; end <= parents.length; end++) if (!await directoryExists(resolve(source, ...parents.slice(0, end)))) return null;
      const info = await lstat(resolve(source, path), { bigint: false });
      if (!info.isFile()) throw Error(`Compact evidence is not a file: ${path}`);
      return info;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  for (const path of [...COMPACT_REPORTS, ...screenshots]) {
    const info = await inspect(path); if (!info) continue;
    if (info.size > fileLimit || bytes + info.size > totalLimit) throw Error(`Required compact evidence exceeds size limit: ${path}`);
    files.push({ path, bytes: info.size }); bytes += info.size;
  }
  for (const path of COMPACT_DIAGNOSTICS) {
    const info = await inspect(path); if (!info) continue;
    if (info.size > diagnosticLimit || bytes + info.size > totalLimit) { omitted.push({ path, reason: 'size_limit', bytes: info.size }); continue; }
    files.push({ path, bytes: info.size }); bytes += info.size;
  }
  // Refuse to reuse a nonempty directory, which could add unbounded stale files.
  await mkdir(target, { recursive: true });
  await directoryExists(target);
  if ((await readdir(target)).length) throw Error('Compact artifact target must be empty');
  for (const file of files) {
    const destination = resolve(target, file.path); await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(source, file.path), destination);
    if ((await stat(destination)).size !== file.bytes) throw Error(`Compact evidence changed during copy: ${file.path}`);
  }
  return { bytes, files, omitted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) throw Error('Usage: prepare-compact-design.mjs SOURCE TARGET');
  console.log(JSON.stringify(await prepareCompactDesign(source, target), null, 2));
}
