import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import './researchFreshness.css';

export default function ResearchFreshnessNotice({ date, freshness, publicationStale = false, generatedAt, checkedAt }) {
  const priceWarning = freshness.state !== 'recent';
  if (!priceWarning && !publicationStale) return null;
  const priceExplanation = freshness.state === 'old'
    ? `分析基準日 ${date}（米国東部で${freshness.days}暦日前）。`
    : freshness.state === 'recent' ? `分析基準日 ${date}。`
      : `分析基準日 ${date || '未確認'}：未確認、または未来の日付です。`;
  // Keep the original price-only notice unchanged. Publication age is a
  // separate warning, never evidence that source prices or captures renewed.
  if (publicationStale) {
    // Match formatPublished: older exporter timestamps without an offset are UTC.
    // This only formats evidence; ResearchPage retains its existing stale decision.
    const publicationTimestamp = typeof generatedAt === 'string' && generatedAt
      ? /(?:Z|[+-]\d{2}:?\d{2})$/.test(generatedAt) ? generatedAt : `${generatedAt}Z`
      : undefined;
    const publicationTime = Date.parse(publicationTimestamp);
    const priceSummary = freshness.state === 'old' ? `（${freshness.days}暦日前）`
      : freshness.state === 'future' ? '（未来の日付）'
        : freshness.state === 'unknown' ? '（日付未確認）' : '';
    return <div className="research-freshness-notice research-freshness-combined" role="alert" aria-label="分析データの鮮度">
      <details>
        <summary><WarningAmberIcon aria-hidden="true"/><span>分析基準日 {date || '未確認'}{priceSummary} · 公開データ要確認</span><span className="freshness-disclosure">詳細 <span aria-hidden="true">⌄</span></span></summary>
        <div className="freshness-explanation">
          <p>{priceExplanation}更新日時と価格の基準日は別です。</p>
          <p>公開データの鮮度を確認してください。選定とチャートは日次データです。</p>
          <p>{Number.isFinite(publicationTime) ? '公開生成時刻をもとに鮮度を再確認してください。' : '公開生成時刻を確認できません。'}この画面では現在有効なセッション資料を確認できません。</p>
          <dl>
            <dt>公開生成時刻（UTC）</dt><dd>{Number.isFinite(publicationTime) ? <time dateTime={new Date(publicationTime).toISOString()}>{new Date(publicationTime).toISOString()}</time> : '未確認'}</dd>
            <dt>画面の鮮度確認時刻（UTC）</dt><dd>{Number.isFinite(checkedAt) ? <time dateTime={new Date(checkedAt).toISOString()}>{new Date(checkedAt).toISOString()}</time> : '未確認'}</dd>
          </dl>
          <p>公開・確認時刻は、価格や財務資料の取得時刻を更新しません。財務資料の期限切れ・未確認は合格に数えません。</p>
        </div>
      </details>
    </div>;
  }
  return <div className="research-freshness-notice" role="alert" aria-label="分析データの鮮度">
    <WarningAmberIcon aria-hidden="true" />
    <span>{priceExplanation}更新日時と価格の基準日は別です。</span>
  </div>;
}
