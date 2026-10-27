/** Quantities: integer thousandths (3 decimals). Money: integer minor units. No floats are stored or summed. */
export function toMilli(v: number | string, what = 'quantity'): number {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (!Number.isFinite(n)) throw new Error(`Invalid ${what}`);
  const m = Math.round(n * 1000);
  if (Math.abs(n * 1000 - m) > 1e-6) throw new Error(`${what} supports at most 3 decimal places`);
  return m;
}
export function fromMilli(m: number): string {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(m);
  const frac = String(a % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${Math.floor(a / 1000)}${frac ? '.' + frac : ''}`;
}
/** Converts an entered quantity to base-unit milli using integer maths (factor is milli too). Rejects fractional results. */
export function toBaseMilli(qtyMilli: number, factorMilli: number): number {
  const num = qtyMilli * factorMilli;
  if (num % 1000 !== 0) throw new Error('Conversion produces a quantity finer than 0.001 of the base unit');
  return num / 1000;
}
/** Cost per entered unit -> cost per base unit, rounded half-up to a minor unit. */
export function costPerBase(costMinor: number, factorMilli: number): number {
  return Math.round((costMinor * 1000) / factorMilli);
}
