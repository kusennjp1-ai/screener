import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import './researchFreshness.css';

export default function ResearchFreshnessNotice({ date, freshness }) {
  return <div className="research-freshness-notice" role="alert" aria-label="分析データの鮮度">
    <WarningAmberIcon aria-hidden="true" />
    <span>{freshness.state === 'old'
      ? `分析基準日 ${date}（米国東部で${freshness.days}暦日前）。`
      : `分析基準日 ${date || '未確認'}：未確認、または未来の日付です。`}
      更新日時と価格の基準日は別です。</span>
  </div>;
}
