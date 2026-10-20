export const mm = (v: number): string => String(Math.round(v));
export const m = (v: number, d = 2): string => (v / 1000).toFixed(d);
export const num = (v: number, d = 1): string => v.toFixed(d);
export function money(v: number): string {
  return `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
export function stockLabel(stock: { length: number; count: number }[] | undefined): string {
  if (!stock || !stock.length) return '';
  return stock.map((s) => `${(s.length / 1000).toFixed(1)}m x ${s.count}`).join(', ');
}
