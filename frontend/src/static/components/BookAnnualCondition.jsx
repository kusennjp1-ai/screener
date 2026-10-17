import { bookAnnualEpsEvidence, bookAnnualEvidenceText, BOOK_ANNUAL_EPS_LABEL, BOOK_ANNUAL_EPS_NOTE } from '../bookAnnualEpsEvidence';

const labels = { pass: '数値比較は充足。利益の調整・株式単位等は要確認', fail: '数値比較は未充足', unknown: '未確認', not_applicable: '対象外' };
export default function BookAnnualCondition({ row, date, now, active = false }) {
  const evidence = bookAnnualEpsEvidence(row, { date, now });
  return <section className="book-annual-condition" aria-label="年次EPSの追加条件" data-condition-state={evidence.comparisonState}>
    <h3>{BOOK_ANNUAL_EPS_LABEL}</h3>
    <p>{active ? '追加絞り込み有効' : '参考比較・追加絞り込み無効'} · {labels[evidence.comparisonState]}</p>
    <p>各年増益：{labels[evidence.annualIncreaseState]} · 3年CAGR：{labels[evidence.cagrState]}</p>
    <p>{bookAnnualEvidenceText(evidence)}</p>
    <p>{BOOK_ANNUAL_EPS_NOTE}</p>
    <p>出典：{evidence.source.book} · PDF {evidence.source.pages}（提供PDFの位置）</p>
  </section>;
}
