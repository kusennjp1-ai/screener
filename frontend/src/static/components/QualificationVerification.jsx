import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Typography } from '@mui/material';
import { fetchStaticChartPayload } from '../chartClient';
import { auditDailyBars } from '../qualificationAudit';
import { diagnoseBookChart } from '../bookChartDiagnostics';
import { buildBookTechnicalEvidence } from '../bookTechnicalEvidence';
import { fetchStaticJson } from '../dataClient';
import { assess, entryChecks } from '../researchEngine';
import SepaReview from './SepaReview';
import BookPatternReview from './BookPatternReview';
import BookExitEvidence from './BookExitEvidence';
import FinancialHistory from './FinancialHistory';

export default function QualificationVerification({ row, entry, date, generation, method, onVerified }) {
  const query = useQuery({ queryKey: ['independentVerification', row.symbol, entry?.path, date, generation, method],
    enabled: false, retry: false, placeholderData: () => undefined,
    queryFn: async () => {
      const [payload, benchmark] = await Promise.all([fetchStaticChartPayload(entry.path), fetchStaticJson('book-benchmark.json').catch(() => null)]);
      const audit = auditDailyBars(row, payload, date);
      return { audit, bookDiagnostics: diagnoseBookChart(row, payload, date), bookTechnical: buildBookTechnicalEvidence(row, payload, date, { benchmark }), assessment: assess({ ...row, technical_audit: audit }, method) };
    } });
  const result = query.data;
  return <section aria-label="選出条件の再検証">
    <FinancialHistory row={row} date={date} />
    <Typography component="h3" variant="subtitle1" sx={{ mt: 2 }}>選出条件の再検証</Typography>
    <Typography sx={{ fontSize: 12, my: 1 }}>公開時に日足から再計算。トレンド8条件とデータ整合性を別々に確認します。252営業日を52週の近似とし、SMA200の方向は21営業日前との比較です。RS・財務値の提供元そのものの正確性は保証しません。</Typography>
    <Button variant="outlined" size="small" disabled={!entry?.path || query.isFetching} onClick={async () => {
      const response = await query.refetch();
      if (!response.isError && response.data) onVerified?.(row.symbol, response.data, date, generation);
    }}>{query.isFetching ? '日足を再検証中…' : '日足を取得して再検証'}</Button>
    {!entry?.path && <Typography sx={{ fontSize: 12 }}>独立検証用の日足が未配信です。</Typography>}
    {query.isError && <Alert severity="error">再検証に失敗しました。検証済みとして扱わないでください。</Alert>}
    {result && !query.isError && <Alert severity={result.audit.valid && result.assessment.qualified ? 'success' : 'warning'} sx={{ mt: 1 }}>
      {row.symbol} / {date}：{result.assessment.qualified ? 'この画面の選定条件を再確認' : '選定条件は未充足または未確認'}（{result.assessment.passed}/{result.assessment.total}）。
      {result.audit.errors.join(' / ')}
      {result.assessment.rules.filter(r => r.state !== 'pass').map(r => r.label).join(' / ')}
    </Alert>}
    <details style={{ marginTop: 12 }}><summary>買い判断に追加で必要な確認（日次）</summary>
      <ul>{entryChecks(row, method).map(r => <li key={r.label}>{r.label}：{r.state === 'pass' ? '適合' : r.state === 'fail' ? '不適合' : '未確認'}</li>)}</ul>
      <Typography sx={{ fontSize: 12 }}>スクリーニング通過は買いシグナルではありません。VCPは任意の形状条件で、トレンドテンプレート通過だけでは成立しません。決算予定とベースの妥当性、当日の執行条件は別途確認が必要です。</Typography>
    </details>
    {method.startsWith('minervini') && <SepaReview method={method} row={row} />}
    {method.startsWith('minervini') && <BookPatternReview key={`${row.symbol}-${date}`} row={row} entry={entry} date={date} />}
    {method.startsWith('minervini') && <BookExitEvidence key={`exit-${row.symbol}-${date}`} row={row} entry={entry} date={date} />}
  </section>;
}
