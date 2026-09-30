export const SECTORS = [
  ['Technology','情報技術','XLK'],['Communication Services','通信サービス','XLC'],['Consumer Cyclical','一般消費財','XLY'],
  ['Consumer Defensive','生活必需品','XLP'],['Healthcare','ヘルスケア','XLV'],['Financial','金融','XLF'],
  ['Industrials','資本財・工業','XLI'],['Basic Materials','素材','XLB'],['Energy','エネルギー','XLE'],['Utilities','公益','XLU'],['Real Estate','不動産','XLRE'],
];
export function sectorKey(value) {
  const key=value==='Financial Services'?'Financial':value;
  return SECTORS.some(s=>s[0]===key)?key:'Unknown';
}
