const finite = value => typeof value === 'number' && Number.isFinite(value);
// JSON numbers carry decimal values. Use their round-trippable decimal spelling
// for comparisons; an arbitrary epsilon would also admit values below the floor.
const decimal = value => {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  return { coefficient: BigInt(integer + fraction), exponent: Number(exponent) - fraction.length };
};
const growthFraction = (previous, latest) => {
  if (!finite(previous) || previous <= 0 || !finite(latest)) return null;
  const a = decimal(previous), b = decimal(latest), exponent = Math.min(a.exponent, b.exponent);
  const denominator = a.coefficient * 10n ** BigInt(a.exponent - exponent);
  const numerator = (b.coefficient * 10n ** BigInt(b.exponent - exponent) - denominator) * 100n;
  return { numerator, denominator };
};
export function reportedGrowth(previous, latest) {
  const fraction = growthFraction(previous, latest);
  if (!fraction) return null;
  let { numerator, denominator } = fraction;
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a; denominator /= a;
  // Reducing the fraction makes exact decimal boundaries (e.g. 0.28 -> 0.35)
  // exactly representable. Extreme magnitudes retain the existing finite check.
  let value = Number(numerator) / Number(denominator);
  if (!finite(value)) value = (latest / previous - 1) * 100;
  return finite(value) ? value : null;
}
export function reportedGrowthAtLeast(previous, latest, minimum) {
  const fraction = growthFraction(previous, latest);
  if (!fraction || !finite(minimum)) return null;
  const floor = decimal(minimum);
  return floor.exponent < 0
    ? fraction.numerator * 10n ** BigInt(-floor.exponent) >= fraction.denominator * floor.coefficient
    : fraction.numerator >= fraction.denominator * floor.coefficient * 10n ** BigInt(floor.exponent);
}
