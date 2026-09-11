/** Bounded, exact fixed-point arithmetic. This profile never accepts JSON float money. */
export class DecimalError extends Error {
  constructor(message: string) { super(message); this.name = 'DecimalError'; }
}

export const MAX_INTEGER_DIGITS = 18;

function checkScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) throw new DecimalError('unsupported decimal scale');
}

export function parseDecimal(value: unknown, scale: number, allowNegative = false): bigint {
  checkScale(scale);
  if (typeof value !== 'string' || value.length > MAX_INTEGER_DIGITS + scale + 2 ||
      !/^-?\d+(?:\.\d+)?$/.test(value)) throw new DecimalError('expected bounded decimal string');
  const negative = value.startsWith('-');
  if (negative && !allowNegative) throw new DecimalError('negative amount is not permitted');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  if (whole.length > MAX_INTEGER_DIGITS || fraction.length > scale) throw new DecimalError('decimal precision exceeds profile limit');
  const magnitude = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  return negative ? -magnitude : magnitude;
}

export function formatDecimal(value: bigint, scale: number): string {
  checkScale(scale);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = (magnitude / divisor).toString();
  if (whole.length > MAX_INTEGER_DIGITS) throw new DecimalError('result exceeds profile magnitude limit');
  const fraction = (magnitude % divisor).toString().padStart(scale, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Half away from zero at ties (half-up for the nonnegative invoice profile). */
export function multiplyRounded(a: bigint, aScale: number, b: bigint, bScale: number, resultScale: number): bigint {
  checkScale(aScale); checkScale(bScale); checkScale(resultScale);
  const product = a * b;
  const shift = aScale + bScale - resultScale;
  if (shift <= 0) return product * 10n ** BigInt(-shift);
  const divisor = 10n ** BigInt(shift);
  const magnitude = product < 0n ? -product : product;
  const rounded = (magnitude + divisor / 2n) / divisor;
  return product < 0n ? -rounded : rounded;
}
