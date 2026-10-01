import { SECTORS, sectorKey } from '../../static/sectorDefinitions';

export const PATTERN_LABELS = {
  cup_with_handle: 'カップ・ウィズ・ハンドル', three_weeks_tight: '3週タイト',
  flat_base: 'フラットベース', double_bottom: 'ダブルボトム', high_tight_flag: 'ハイ・タイト・フラッグ',
  first_pullback: '初回の押し', nr7_inside_day: 'NR7・インサイドデイ', vcp: 'VCP',
};
export const patternLabel = value => value ? PATTERN_LABELS[value] || '分類未対応' : '—';
export const sectorLabel = value => SECTORS.find(sector => sector[0] === sectorKey(value))?.[1] || '分類未確認';
export const RATING_LABELS = {'Strong Buy':'強い候補','Buy':'候補','Watch':'監視','Hold':'保留','Avoid':'対象外','Sell':'売却注意','Insufficient Data':'データ不足','Error':'取得エラー','Pass':'見送り'};
export const ratingLabel = value => RATING_LABELS[value] || '未確認';
export const MARKET_LABELS = {US:'米国',HK:'香港',IN:'インド',JP:'日本',KR:'韓国',TW:'台湾',CN:'中国',CA:'カナダ',DE:'ドイツ',SG:'シンガポール',AU:'豪州',MY:'マレーシア'};
export const marketLabel = value => MARKET_LABELS[value] || '市場未確認';
