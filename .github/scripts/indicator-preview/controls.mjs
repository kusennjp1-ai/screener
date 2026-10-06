import { readFile } from 'node:fs/promises';
const expected = Object.freeze({
  schema: 'market-indicator-preview-input-v1', repository: 'kusennjp1-ai/screener',
  branch: 'preview/market-indicator-histories', base_url: 'https://kusennjp1-ai.github.io/screener/',
  publication_sha256: '0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a',
  source_release: { number: 99, run_id: 37456692717, run_attempt: 1 }, publication_authority: 'none',
});
export function verifyPreviewPin(value) {
  if (!value || Object.keys(value).sort().join() !== Object.keys(expected).sort().join() ||
    Object.entries(expected).some(([key, item]) => key === 'source_release'
      ? !value.source_release || Object.keys(value.source_release).sort().join() !== Object.keys(item).sort().join() || Object.entries(item).some(([name, field]) => value.source_release[name] !== field)
      : value[key] !== item)) throw Error('Preview input pin differs from the admitted #99 source');
  return value;
}
export async function loadPreviewPin() {
  return verifyPreviewPin(JSON.parse(await readFile(new URL('../../market-indicator-preview-input.json', import.meta.url), 'utf8')));
}
export function requireAdmittedPreview(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== expected.repository || env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REF !== `refs/heads/${expected.branch}` || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT || '')) throw Error('Browser execution is restricted to admitted GitHub Actions jobs on the exact preview branch');
  if (['INDICATOR_INPUT_DIRECTORY', 'INDICATOR_INPUT_BASE_URL', 'INDICATOR_PUBLICATION_SHA256'].some(key => env[key])) throw Error('CI preview source overrides are prohibited; use the checked-in pin');
}
export async function previewInputOptions(env) {
  const pin = await loadPreviewPin();
  if (env.GITHUB_ACTIONS === 'true') { requireAdmittedPreview(env); return { baseURL: pin.base_url, publicationSha256: pin.publication_sha256 }; }
  // Local read-only adapter tests may use a separately verified restored
  // directory. They do not become a #99 browser or publication certification.
  if (env.INDICATOR_INPUT_DIRECTORY && !env.INDICATOR_INPUT_BASE_URL) return { directory: env.INDICATOR_INPUT_DIRECTORY, publicationSha256: env.INDICATOR_PUBLICATION_SHA256 };
  if (env.INDICATOR_INPUT_BASE_URL || env.INDICATOR_PUBLICATION_SHA256) throw Error('Unpinned URL/hash overrides are prohibited');
  return { baseURL: pin.base_url, publicationSha256: pin.publication_sha256 };
}
