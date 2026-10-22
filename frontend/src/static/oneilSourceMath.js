import { reportedGrowth, reportedGrowthAtLeast } from './reportedGrowth.js';

// Arithmetic only, never evidence admission. Callers must validate the source
// contract before supplying values. No scalar/history fallback lives here.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const state = value => value === null ? 'unknown' : value ? 'pass' : 'fail';
export const sourceAnd = states => states.includes('fail') ? 'fail' : states.length && states.every(value => value === 'pass') ? 'pass' : 'unknown';
export const sourceOr = states => states.includes('pass') ? 'pass' : states.length && states.every(value => value === 'fail') ? 'fail' : 'unknown';
const dense = (values, size) => Array.isArray(values) && values.length === size &&
  Array.from({ length: size }, (_, index) => Object.hasOwn(values, index)).every(Boolean);

export function sourceAnnualMath(values) {
  const reason = !dense(values, 4) || !values.every(finite) ? 'missing_annual_eps'
    : values.some(value => value <= 0) ? 'nonpositive_annual_eps' : null;
  if (reason) return { state: 'unknown', reason, cagr: { state: 'unknown', value: null, reason }, eachYear: { state: 'unknown', comparisons: [], reason } };
  // CAGR >= 25% for exactly three annual intervals is equivalent to total
  // growth >= 95.3125%. This exact decimal floor is (1.25^3 - 1) * 100;
  // reportedGrowthAtLeast uses decimal BigInt fractions, with no epsilon.
  const cagrPass = reportedGrowthAtLeast(values[0], values[3], 95.3125);
  const displayed = Math.expm1((Math.log(values[3]) - Math.log(values[0])) / 3) * 100;
  const cagr = { state: state(cagrPass), value: finite(displayed) ? displayed : null, reason: null };
  const comparisons = values.slice(1).map((latest, index) => ({ previous: values[index], latest,
    growth: reportedGrowth(values[index], latest), state: state(latest > values[index]), reason: null }));
  const eachYear = { state: sourceAnd(comparisons.map(comparison => comparison.state)), comparisons, reason: null };
  return { state: sourceAnd([cagr.state, eachYear.state]), reason: null, cagr, eachYear };
}

// The same round-trippable decimal policy as reportedGrowth.js. Compare
// rational rates directly: rounded/display rates can falsely show acceleration.
const decimal = value => {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  return { coefficient: BigInt(integer + fraction), exponent: Number(exponent) - fraction.length };
};
const fraction = pair => {
  if (!pair || !Object.hasOwn(pair, 'previous') || !Object.hasOwn(pair, 'latest') ||
      !finite(pair.previous) || pair.previous <= 0 || !finite(pair.latest)) return null;
  const previous = decimal(pair.previous), latest = decimal(pair.latest);
  const exponent = Math.min(previous.exponent, latest.exponent);
  const denominator = previous.coefficient * 10n ** BigInt(previous.exponent - exponent);
  return { numerator: latest.coefficient * 10n ** BigInt(latest.exponent - exponent) - denominator, denominator };
};

// There is currently NO production adapter for three admitted sales pairs.
// This kernel pins the requested mathematics using synthetic fixtures only;
// the UI adapter must keep acceleration unknown until a shared contract exists.
export function sourceSalesMath(pairs) {
  const complete = dense(pairs, 3);
  const fractions = complete ? pairs.map(fraction) : [];
  const comparable = complete && fractions.every(Boolean);
  const latestPair = complete && Object.hasOwn(pairs, 2) ? pairs[2] : null;
  const latestFraction = fraction(latestPair);
  const latest = { state: latestFraction ? state(reportedGrowthAtLeast(latestPair.previous, latestPair.latest, 25)) : 'unknown',
    value: latestFraction ? reportedGrowth(latestPair.previous, latestPair.latest) : null,
    reason: latestFraction ? null : 'missing_or_nonpositive_sales_base' };
  const acceleration = { state: comparable ? state(fractions.slice(1).every((rate, index) =>
    rate.numerator * fractions[index].denominator > fractions[index].numerator * rate.denominator)) : 'unknown',
    comparisons: comparable ? pairs.map(pair => ({ ...pair, growth: reportedGrowth(pair.previous, pair.latest) })) : [],
    reason: comparable ? null : 'missing_comparable_sales_pairs' };
  return { state: sourceOr([latest.state, acceleration.state]), latest, acceleration };
}
