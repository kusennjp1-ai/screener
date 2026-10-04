import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Typography } from '@mui/material';
import { fetchStaticChartPayload } from '../chartClient';
import { auditDailyBars } from '../qualificationAudit';
import { diagnoseBookChart } from '../bookChartDiagnostics';
import { buildBookTechnicalEvidence } from '../bookTechnicalEvidence';
import { fetchStaticJson } from '../dataClient';
import { assess } from '../researchEngine';
import SepaReview from './SepaReview';
import BookPatternReview from './BookPatternReview';
import BookExitEvidence from './BookExitEvidence';
import FinancialHistory from './FinancialHistory';
import BookFinancialReview from './BookFinancialReview';
import InstitutionalEvidence from './InstitutionalEvidence';

export default function QualificationVerification({ row, entry, date, generation, method, onVerified, includeFinancial = true, bookFinancialOpen = false, now }) {
  const query = useQuery({ queryKey: ['independentVerification', row.symbol, entry?.path, date, generation, method],
    enabled: false, retry: false, placeholderData: () => undefined,
    queryFn: async () => {
      const [payload, benchmark] = await Promise.all([fetchStaticChartPayload(entry.path), fetchStaticJson('book-benchmark.json').catch(() => null)]);
      const audit = auditDailyBars(row, payload, date);
      return { audit, bookDiagnostics: diagnoseBookChart(row, payload, date), bookTechnical: buildBookTechnicalEvidence(row, payload, date, { benchmark }), assessment: assess({ ...row, technical_audit: audit }, method, Date.now()) };
    } });
  const result = query.data;
  // Keep the independent technical audit, but never cache a current financial
  // decision across expiry or a newer projected row.
  const currentAssessment = result ? assess({ ...row, technical_audit: result.audit }, method, now) : null;
  return <section aria-label="選出条件の再検証">
    {includeFinancial && <FinancialHistory row={row} date={date} now={now} />}
    {includeFinancial && <InstitutionalEvidence row={row} date={date} />}
    <Typography component="h3" variant="subtitle1" sx={{ mt: 2 }}>選出条件の再検証</Typography>
    <Typography sx={{ fontSize: 12, my: 1 }}>公開時に日足から再計算。トレンド8条件とデータ整合性を別々に確認します。252営業日を52週の近似とし、SMA200の方向は21営業日前との比較です。RS・財務値の提供元そのものの正確性は保証しません。</Typography>
    <Button variant="outlined" size="small" disabled={!entry?.path || query.isFetching} onClick={async () => {
      const response = await query.refetch();
      if (!response.isError && response.data) onVerified?.(row.symbol, { ...response.data, assessment: assess({ ...row, technical_audit: response.data.audit }, method, Date.now()) }, date, generation);
    }}>{query.isFetching ? '日足を再検証中…' : '日足を取得して再検証'}</Button>
    {!entry?.path && <Typography sx={{ fontSize: 12 }}>独立検証用の日足が未配信です。</Typography>}
    {query.isError && <Alert severity="error">再検証に失敗しました。検証済みとして扱わないでください。</Alert>}
    {result && !query.isError && <Alert severity={result.audit.valid && currentAssessment.qualified ? 'success' : 'warning'} sx={{ mt: 1 }}>
      {row.symbol} / {date}：{currentAssessment.applicability_label || (currentAssessment.qualified ? 'この画面の選定条件を再確認' : '選定条件は未充足または未確認')}（{currentAssessment.passed}/{currentAssessment.total}）。
      {result.audit.errors.join(' / ')}
      {currentAssessment.rules.filter(r => r.state !== 'pass').map(r => r.label).join(' / ')}
    </Alert>}
    {method.startsWith('minervini') && <SepaReview method={method} row={row} bookFinancialOpen={bookFinancialOpen} date={date} now={now} />}
    {!method.startsWith('minervini') && <BookFinancialReview row={row} expanded={bookFinancialOpen} date={date} now={now} />}
    {method.startsWith('minervini') && <BookPatternReview key={`${row.symbol}-${date}`} row={row} entry={entry} date={date} />}
    {method.startsWith('minervini') && <BookExitEvidence key={`exit-${row.symbol}-${date}`} row={row} entry={entry} date={date} />}
  </section>;
}
