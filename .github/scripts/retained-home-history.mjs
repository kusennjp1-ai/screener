// Finite, offline DXY history recovery. This does not authorize publication or
// treat a predecessor's close as a current home-card value.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {priceObservationDigest} from './price-observations.mjs';

export const RETAINED_HOME_SCHEMA = 'retained-home-history-v1';
export const RETAINED_HOME_KEY = JSON.stringify(['US','home','TVC:DXY']);
const HOME_PATH = 'markets/us/home.json';
const SYMBOL = 'TVC:DXY';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => sha(canonical(value));
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = ['change_1d','currency','display_name','history','latest_close','latest_date','symbol'];

function boundHome(bytes, expected, path, label) {
  assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, `${label}: exact home bytes required`);
  const raw = Buffer.from(bytes);
  assert(raw.length > 0 && raw.length <= 2 * 1024 * 1024, `${label}: home byte limit exceeded`);
  assert(validHash(expected) && sha(raw) === expected, `${label}: home SHA256 mismatch`);
  assert.equal(path,HOME_PATH,`${label}: unreviewed home path`);
  const raw_utf8 = raw.toString('utf8');
  assert(Buffer.from(raw_utf8).equals(raw),`${label}: invalid UTF-8 home bytes`);
  return {path,bytes:raw.length,sha256:expected,raw_utf8};
}

function readHome(binding, date, label) {
  assert(record(binding) && typeof binding.raw_utf8 === 'string',`${label}: missing exact home evidence`);
  assert.deepEqual(boundHome(Buffer.from(binding.raw_utf8),binding.sha256,binding.path,label),binding,`${label}: home byte binding mismatch`);
  const home = JSON.parse(binding.raw_utf8);
  assert.equal(home.schema_version,'static-site-v2',`${label}: unsupported home schema`);
  assert.equal(home.market,'US',`${label}: home market mismatch`);
  assert.equal(home.as_of_date,date,`${label}: home date mismatch`);
  assert(typeof home.generated_at === 'string' && Number.isFinite(Date.parse(home.generated_at)),`${label}: invalid original capture clock`);
  assert(Array.isArray(home.key_markets),`${label}: missing home instruments`);
  const identities = new Set();
  for (const item of home.key_markets) {
    assert(record(item) && typeof item.symbol === 'string' && item.symbol && !identities.has(item.symbol),`${label}: duplicate/invalid home identity`);
    identities.add(item.symbol);
  }
  const item = home.key_markets.find(value => value.symbol === SYMBOL);
  assert(item,`${label}: DXY instrument missing`);
  assert.deepEqual(Object.keys(item).sort(),fields,`${label}: unreviewed DXY field`);
  assert.equal(item.currency,'USD',`${label}: DXY currency mismatch`);
  assert.equal(item.display_name,'US Dollar Index',`${label}: DXY identity mismatch`);
  return {home,item};
}

function checkedManifest(source) {
  assert(typeof source?.manifest_json === 'string' && validHash(source.manifest_sha256), 'Missing candidate manifest binding');
  assert.equal(sha(source.manifest_json),source.manifest_sha256,'Candidate home manifest SHA256 mismatch');
  const manifest = JSON.parse(source.manifest_json), market = manifest.markets?.US;
  assert(day(market?.as_of_date),'Invalid candidate home target');
  assert.equal(market.pages?.home?.path,HOME_PATH,'Unreviewed candidate home path');
  if(manifest.pages?.home)assert.equal(manifest.pages.home.path,HOME_PATH,'Conflicting root/US home alias');
  return manifest;
}

function retainedItem(patch, prior, candidate) {
  assert(Array.isArray(prior.item.history) && prior.item.history.length > 1 && prior.item.history.length <= 30,'Prior DXY history must contain 2..30 observed closes');
  let previous = null;
  for (const point of prior.item.history) {
    assert(record(point) && Object.keys(point).sort().join(',') === 'close,date','Unreviewed DXY history point');
    assert(day(point.date) && (!previous || previous < point.date),'Invalid/unordered DXY history dates');
    assert(typeof point.close === 'number' && Number.isFinite(point.close) && point.close > 0,'Invalid DXY observed close');
    assert(point.date <= patch.previous_as_of_date && point.date < patch.target_as_of_date,'DXY history exceeds its original session');
    previous = point.date;
  }
  assert.equal(previous,patch.observation_date,'Prior DXY actual observation mismatch');
  assert.equal(prior.item.latest_date,previous,'Prior DXY display date differs from observed history');
  assert.equal(prior.item.latest_close,prior.item.history.at(-1).close,'Prior DXY display close differs from observed history');
  assert.equal(patch.prior_actual_observation_date,previous,'DXY history lacks predecessor actual-observation authority');
  assert.equal(patch.prior_known_observation_date,previous,'DXY history cannot repair the known-date ledger');
  assert.deepEqual(candidate.item.history,[],'DXY recovery only supports the reviewed missing history');
  for (const field of ['latest_date','latest_close','change_1d'])assert.equal(candidate.item[field],null,`Candidate DXY ${field} differs from the reviewed absence`);
  for (const field of ['symbol','currency','display_name'])assert.equal(candidate.item[field],prior.item[field],`Changed DXY ${field}`);
  return {...clone(prior.item),latest_close:null,change_1d:null,
    retained_price_history:{status:'stale_reference_only',observation_date:previous,target_as_of_date:patch.target_as_of_date,
      original_as_of_date:prior.home.as_of_date,original_generated_at:prior.home.generated_at,
      source_home_path:patch.prior_home.path,source_home_sha256:patch.prior_home.sha256,
      snapshot_path:patch.snapshot_path}};
}

/** Inputs must already have independently verified archive provenance. Hashes
 * here bind the entire source homes, including whitespace and original clocks. */
export function prepareRetainedHomeHistory({priorPublication,candidateSource,priorHomeBytes,priorHomeSha256,candidateHomeBytes,candidateHomeSha256,
  priorHomePath=HOME_PATH,candidateHomePath=HOME_PATH}) {
  assert.equal(priorPublication?.schema,1,'Unsupported predecessor receipt');
  const manifest = checkedManifest(candidateSource);
  assert.equal(priceObservationDigest(candidateSource.price_observations),candidateSource.price_observations_sha256,'Candidate home observation binding mismatch');
  assert(!Object.hasOwn(candidateSource.price_observations,RETAINED_HOME_KEY),'Candidate DXY already has an actual observation');
  const prior_home = boundHome(priorHomeBytes,priorHomeSha256,priorHomePath,'prior');
  const candidate_home = boundHome(candidateHomeBytes,candidateHomeSha256,candidateHomePath,'candidate');
  const patch = {schema_version:RETAINED_HOME_SCHEMA,publication_authority:false,scope:'offline_prepare_only',
    key:RETAINED_HOME_KEY,symbol:SYMBOL,reason:'missing_history',
    previous_as_of_date:priorPublication.verification_universe?.as_of_date,target_as_of_date:manifest.markets.US.as_of_date,
    observation_date:priorPublication.price_observations?.[RETAINED_HOME_KEY],
    prior_actual_observation_date:priorPublication.price_observations?.[RETAINED_HOME_KEY],
    prior_known_observation_date:priorPublication.known_price_dates?.[RETAINED_HOME_KEY],
    prior_publication_sha256:digest(priorPublication),source_manifest_sha256:candidateSource.manifest_sha256,
    source_manifest_json:candidateSource.manifest_json,source_observations_sha256:candidateSource.price_observations_sha256,
    prior_home,candidate_home,snapshot_path:`retained-price-repair-audit/home/${prior_home.sha256}-prior-home.json`,
    rejected_snapshot_path:`retained-price-repair-audit/home/${candidate_home.sha256}-candidate-home.json`};
  const prior = readHome(prior_home,patch.previous_as_of_date,'prior'), candidate = readHome(candidate_home,patch.target_as_of_date,'candidate');
  patch.item = retainedItem(patch,prior,candidate);
  patch.patch_sha256 = digest(patch);
  return validateRetainedHomeHistory(patch,{priorPublication,candidateSource});
}

/** Revalidate after loading a prepared file. Optional inputs additionally bind
 * the patch to its enclosing recovery plan and current restored source bytes. */
export function validateRetainedHomeHistory(patch,{priorPublication,candidateSource,candidateHomeBytes,targetAsOfDate}={}) {
  assert(record(patch),'Missing home-history patch');
  const {patch_sha256,...body} = patch;
  assert(validHash(patch_sha256) && digest(body) === patch_sha256,'Home-history patch changed');
  assert.equal(patch.schema_version,RETAINED_HOME_SCHEMA);assert.equal(patch.publication_authority,false);
  assert.equal(patch.scope,'offline_prepare_only');assert.equal(patch.key,RETAINED_HOME_KEY);assert.equal(patch.symbol,SYMBOL);assert.equal(patch.reason,'missing_history');
  assert(day(patch.previous_as_of_date) && day(patch.target_as_of_date) && patch.previous_as_of_date < patch.target_as_of_date,'Home recovery must advance the snapshot');
  for(const field of ['prior_publication_sha256','source_manifest_sha256','source_observations_sha256'])assert(validHash(patch[field]),`Invalid home-history binding: ${field}`);
  assert.equal(checkedManifest({manifest_json:patch.source_manifest_json,manifest_sha256:patch.source_manifest_sha256}).markets.US.as_of_date,patch.target_as_of_date,'Home recovery target changed');
  const prior = readHome(patch.prior_home,patch.previous_as_of_date,'prior'), candidate = readHome(patch.candidate_home,patch.target_as_of_date,'candidate');
  assert.equal(patch.snapshot_path,`retained-price-repair-audit/home/${patch.prior_home.sha256}-prior-home.json`);
  assert.equal(patch.rejected_snapshot_path,`retained-price-repair-audit/home/${patch.candidate_home.sha256}-candidate-home.json`);
  assert.deepEqual(patch.item,retainedItem(patch,prior,candidate),'Home recovery changed retained history or current display state');
  if(priorPublication){
    assert.equal(digest(priorPublication),patch.prior_publication_sha256,'Home predecessor receipt changed');
    assert.equal(priorPublication.price_observations?.[RETAINED_HOME_KEY],patch.observation_date);
    assert.equal(priorPublication.known_price_dates?.[RETAINED_HOME_KEY],patch.observation_date);
  }
  if(candidateSource){
    checkedManifest(candidateSource);
    assert.equal(candidateSource.manifest_json,patch.source_manifest_json,'Home candidate manifest changed');
    assert.equal(priceObservationDigest(candidateSource.price_observations),patch.source_observations_sha256,'Home candidate observations changed');
    assert.equal(candidateSource.price_observations_sha256,patch.source_observations_sha256,'Home candidate observation binding changed');
    assert(!Object.hasOwn(candidateSource.price_observations,RETAINED_HOME_KEY),'Candidate DXY already has an actual observation');
  }
  if(candidateHomeBytes)assert.deepEqual(boundHome(candidateHomeBytes,patch.candidate_home.sha256,patch.candidate_home.path,'candidate'),patch.candidate_home,'Restored home differs from reviewed candidate');
  if(targetAsOfDate !== undefined)assert.equal(patch.target_as_of_date,targetAsOfDate,'Home target differs from recovery');
  return patch;
}

/** Allows separately validated group/scan-summary edits to be composed. The
 * complete key-market array must still equal the original candidate evidence. */
export function applyRetainedHomeHistory(home,patch) {
  validateRetainedHomeHistory(patch,{targetAsOfDate:home?.as_of_date});
  const original = JSON.parse(patch.candidate_home.raw_utf8);
  assert.equal(home.market,original.market,'Home market changed during recovery');
  assert.equal(home.generated_at,original.generated_at,'Home capture clock changed during recovery');
  assert.deepEqual(home.freshness,original.freshness,'Home freshness changed during recovery');
  assert.deepEqual(home.key_markets,original.key_markets,'Home instruments differ from reviewed candidate');
  return {...clone(home),key_markets:home.key_markets.map(item => item.symbol === SYMBOL ? clone(patch.item) : clone(item))};
}
