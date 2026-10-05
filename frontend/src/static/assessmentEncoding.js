// Only a transport representation. Unknown counts and the rule version survive;
// the existing rule engine remains the authority used by publication checks.
export function encodeAssessment(summary) {
  if (summary.method_status) return { ...summary };
  return [summary.passed,summary.failed,summary.unknown,summary.total,summary.templateMismatch?1:0];
}
export function decodeAssessment(value) {
  if (!Array.isArray(value)) {
    if (!value || ['passed','failed','unknown','total'].some(key=>!Number.isInteger(value[key])||value[key]<0) ||
      value.total===0 || value.passed+value.failed+value.unknown+(value.notApplicable || 0)!==value.total ||
      (value.method_status !== undefined && !['not_applicable','quarantined'].includes(value.method_status)) ||
      (value.notApplicable !== undefined && (!Number.isInteger(value.notApplicable) || value.notApplicable < 0)) ||
      value.qualified!==(!value.method_status && value.passed===value.total) || value.score!==Math.round(value.passed/value.total*100) || typeof value.templateMismatch!=='boolean') return null;
    return value;
  }
  if (value.length!==5 || value.some(n=>!Number.isInteger(n)||n<0) || value[0]+value[1]+value[2]!==value[3] || value[3]===0 || value[4]>1) return null;
  const [passed,failed,unknown,total,mismatch]=value;
  return {passed,failed,unknown,total,templateMismatch:Boolean(mismatch),qualified:passed===total,score:Math.round(passed/total*100)};
}
