import { Alert } from '@mui/material';
import './researchFreshnessNotice.css';

// Presentation only: ResearchPage supplies the existing independent publication
// and price-snapshot checks. Neither check describes financial-source freshness.
export default function ResearchFreshnessNotice({ stale, freshness, date, generatedAt }) {
  const priceWarning = freshness && freshness.state !== 'recent';
  if (!stale && !priceWarning) return null;
  const published = Number.isFinite(Date.parse(generatedAt)) ? `${new Date(generatedAt).toISOString().slice(0,16).replace('T',' ')} UTC` : '時刻未確認';
  const price = freshness?.state === 'old' ? `${date}（${freshness.days}暦日前）`
    : freshness?.state === 'future' ? `${date}（未来日・要確認）`
      : freshness?.state === 'unknown' ? '基準日未確認'
        : `${date || '未確認'}${freshness ? '' : '（取得中）'}`;
  return <Alert severity="warning" className="research-freshness-notice">
    <details><summary><span><b>公開</b> {published}{stale ? ' · 要再確認' : ''}</span><span><b>価格</b> {price} <span aria-hidden="true">⌄</span></span></summary>
      {stale && <p>公開データの鮮度を確認してください。選定とチャートは日次データです。</p>}
      {priceWarning && <p>{freshness.state === 'old' ? `分析基準日は米国東部の日付から${freshness.days}暦日前です。更新日時と価格の基準日は別です。` : '分析基準日が未確認、または未来の日付です。'}</p>}
      <p>公開時刻：{generatedAt || '未確認'}。財務の提供元・取得時刻は各指標の根拠で別に確認します。</p>
    </details>
  </Alert>;
}
