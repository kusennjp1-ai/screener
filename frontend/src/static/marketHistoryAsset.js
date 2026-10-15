import { MARKET_HISTORY_VERSION, validHistoryDate } from './marketIndicatorHistory.js';

export const MARKET_HISTORY_SNAPSHOT_VERSION = 'market-indicator-snapshot-v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, keys) => record(value) && keys.every(key => Object.hasOwn(value, key));
const fail = message => { throw new Error(message); };

// The transport verifies these exact bytes against sha256. This reader verifies
// the decoded identity; it neither fetches nor grants publication authority.
export function validateMarketHistoryAssetReference(reference, { market, asOfDate } = {}) {
  if (!own(reference, ['path', 'sha256', 'schema_version', 'market', 'as_of_date']) ||
      typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256) ||
      reference.path !== `market-history/snapshots/${reference.sha256}.json` ||
      reference.schema_version !== MARKET_HISTORY_SNAPSHOT_VERSION) {
    fail('保存履歴の参照形式を確認できません。');
  }
  if (market !== 'US' || reference.market !== market || !validHistoryDate(asOfDate) || reference.as_of_date !== asOfDate) {
    fail('保存履歴の市場または分析基準日が一致しません。');
  }
  return reference;
}

export function readMarketHistoryAsset(snapshot, { reference, market, asOfDate } = {}) {
  validateMarketHistoryAssetReference(reference, { market, asOfDate });
  if (!own(snapshot, ['schema_version', 'market', 'as_of_date', 'history', 'provenance']) ||
      snapshot.schema_version !== MARKET_HISTORY_SNAPSHOT_VERSION) fail('保存履歴の形式を確認できません。');
  if (snapshot.market !== market || snapshot.as_of_date !== asOfDate) fail('保存履歴の市場または分析基準日が一致しません。');
  if (!own(snapshot.history, ['version', 'series']) || snapshot.history.version !== MARKET_HISTORY_VERSION ||
      !Array.isArray(snapshot.history.series) || !record(snapshot.provenance)) fail('保存履歴の観測または出典を確認できません。');
  for (let index = 0; index < snapshot.history.series.length; index++) {
    if (!Object.hasOwn(snapshot.history.series, index) || !record(snapshot.history.series[index]) ||
        snapshot.history.series[index].market !== market) fail('保存履歴の系列に異なる市場または不明な観測が含まれています。');
  }
  return { history: snapshot.history, provenance: snapshot.provenance };
}
