import { validEvidenceDay } from '../evidenceTime';
import MetricDisclosure from './MetricDisclosure';

const text = value => typeof value === 'string' && value.trim() ? value : null;
const correspondence = (expected, actual) => !expected || !actual ? '未確認' : expected === actual ? '一致' : '不一致';

// Display the supplied envelope only. Never fill an observed date/version from
// the screen context or use this comparison to change an existing rule state.
export default function EvidenceContext({ date, generation, evidence, label, compareGeneration = false, compact = false }) {
  const expectedDate = validEvidenceDay(date) ? date : null;
  const actualDate = validEvidenceDay(evidence?.as_of_date) ? evidence.as_of_date : null;
  const expectedGeneration = text(generation), actualGeneration = text(evidence?.generation);
  const dateMatch = correspondence(expectedDate, actualDate);
  const generationMatch = correspondence(expectedGeneration, actualGeneration);
  return <div role="group" aria-label={`${label}の参照情報`} className={compact ? 'compact-evidence-context' : 'evidence-context'}>
    <p>{label}の対象日 {actualDate || '未確認'} ／ 日付の対応 <strong>{dateMatch}</strong>{compareGeneration && <> ／ 配信版の対応 <strong>{generationMatch}</strong></>}</p>
    <MetricDisclosure summary="配信版・照合情報">
      <p>分析基準日 {expectedDate || '未確認'} ／ 画面の配信版 {expectedGeneration || '未確認'}</p>
      {compareGeneration && <p>{label}の配信版 {actualGeneration || '未確認'}</p>}
      {compareGeneration && <p>配信版は画面と表示用データの対応を示します。提供元の版や取得日時とは別です。</p>}
    </MetricDisclosure>
  </div>;
}
