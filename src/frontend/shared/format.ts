const currency = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const long = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const parseDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);

export const money = (cents: number) => currency.format(cents / 100);
export const rate = (cents: number) => `$${whole.format(Math.round(cents / 100))}/h`;
export const percent = (value: number) => `${whole.format(Math.round(value))}%`;
export const shortDate = (value: string) => short.format(parseDate(value));
export const longDate = (value: string) => long.format(parseDate(value)).replace(',', '');
export const auditDate = (value: string) => `${shortDate(value)}, ${value.slice(11, 16)}`;
export function minutes(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid duration');
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours ? `${hours}h ${String(remainder).padStart(2, '0')}m` : `${remainder}m`;
}
export const duration = (ms: number | null) => ms === null ? 'Unknown' : minutes(Math.round(ms / 60000));
export const tenthsOfHour = (value: number) => minutes(Math.round(value * 6));
