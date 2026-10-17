// Recalculation keeps a false safety flag after an error. Availability, rather
// than that flag, determines whether the detector actually measured readiness.
export function setupReadiness(row) {
  const calculation = row?.setup_recalculation;
  const unavailable = calculation?.status === 'unavailable';
  const value = unavailable || typeof row?.se_setup_ready !== 'boolean' ? null : row.se_setup_ready;
  const reason = typeof calculation?.reason === 'string' && calculation.reason.trim()
    ? calculation.reason : unavailable ? 'セットアップ再計算不可・理由未取得' : '';
  return { value, state: value === null ? 'unknown' : value ? 'pass' : 'fail', reason };
}
