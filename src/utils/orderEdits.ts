import type { DesignResult } from '../engine';
import type { BomLine } from '../engine/bom';
import { PRODUCT_MAP } from '../model/catalog';
import type { OrderEdits, OrderItem, Project, Unit } from '../model/types';

/*
 * Hand changes to the order list. The calculated list is the starting point; these helpers return the
 * project's new OrderEdits (or null once nothing is changed by hand any more). Timber cut on the cutting diagrams is
 * always ordered as it is cut, length for length: by hand only its spare changes, never below the cut.
 */

export const emptyOrder = (): OrderEdits => ({ lines: {}, added: [] });

function orderOf(p: Project): OrderEdits {
  if (!p.order) return emptyOrder();
  return {
    lines: Object.fromEntries(Object.entries(p.order.lines ?? {}).map(([k, e]) => [k, { ...e, spare: e.spare ? { ...e.spare } : undefined }])),
    added: (p.order.added ?? []).map((a) => ({ ...a, stock: a.stock ? { ...a.stock } : undefined })),
    note: p.order.note,
  };
}

/** drop empty entries; null when nothing is left */
function tidy(o: OrderEdits): OrderEdits | null {
  const lines: OrderEdits['lines'] = {};
  for (const [k, e] of Object.entries(o.lines)) {
    if (e.removed) lines[k] = { removed: true };
    else if (e.qty !== undefined || e.spare !== undefined) lines[k] = { ...(e.qty !== undefined ? { qty: e.qty } : {}), ...(e.spare !== undefined ? { spare: e.spare } : {}) };
  }
  const note = o.note && o.note.trim() ? o.note : undefined;
  if (!Object.keys(lines).length && !o.added.length && !note) return null;
  return { lines, added: o.added, ...(note ? { note: o.note } : {}) };
}

const stockMapOf = (l: BomLine): Record<string, number> => Object.fromEntries((l.stockBreakdown ?? []).map((s) => [String(s.length), s.count]));
const spareMapOf = (l: BomLine): Record<string, number> => Object.fromEntries((l.spareStock ?? []).map((s) => [String(s.length), s.count]));
/** the sticks of one length the cutting diagrams cut for a line */
export const cutCount = (l: BomLine, length: number): number => l.cutStock?.find((s) => s.length === length)?.count ?? 0;

function nextItemId(o: OrderEdits): string {
  const n = o.added.reduce((m, a) => Math.max(m, Number(/^a(\d+)$/.exec(a.id)?.[1] ?? 0)), 0);
  return `a${n + 1}`;
}

/** Set a line's quantity: units, or pieces for products sold in boxes. */
export function withQty(p: Project, line: BomLine, qty: number): OrderEdits | null {
  const o = orderOf(p);
  const v = Math.max(0, Number.isFinite(qty) ? qty : 0);
  if (line.addedId) o.added = o.added.map((a) => (a.id === line.addedId ? { ...a, qty: v } : a));
  else o.lines[line.productId] = { ...o.lines[line.productId], removed: false, qty: v };
  return tidy(o);
}

/**
 * Set how many pieces of one stock length a timber line orders. Timber cut on the cutting diagrams takes what is cut
 * of that length at least: the pieces over it are its spare (an item added by hand takes any count, 0 takes the
 * length off).
 */
export function withStock(p: Project, line: BomLine, length: number, count: number): OrderEdits | null {
  const o = orderOf(p);
  const c = Math.max(0, Math.round(Number.isFinite(count) ? count : 0));
  if (line.cutStock) {
    const spare = spareMapOf(line);
    const over = Math.max(0, c - cutCount(line, length));
    if (over > 0) spare[String(length)] = over;
    else delete spare[String(length)];
    o.lines[line.productId] = { ...o.lines[line.productId], removed: false, spare };
    return tidy(o);
  }
  const map = stockMapOf(line);
  if (c > 0) map[String(length)] = c;
  else delete map[String(length)];
  if (line.addedId) o.added = o.added.map((a) => (a.id === line.addedId ? { ...a, stock: map } : a));
  return tidy(o);
}

/** Take a line off the order (a calculated line can be put back; an added item is gone). */
export function withoutLine(p: Project, line: BomLine): OrderEdits | null {
  const o = orderOf(p);
  if (line.addedId) o.added = o.added.filter((a) => a.id !== line.addedId);
  else o.lines[line.productId] = { removed: true };
  return tidy(o);
}

/** Put a calculated line back, or drop its hand-set quantity: either way it is as calculated again. */
export function asCalculated(p: Project, productId: string): OrderEdits | null {
  const o = orderOf(p);
  delete o.lines[productId];
  return tidy(o);
}

export function withNote(p: Project, note: string): OrderEdits | null {
  const o = orderOf(p);
  o.note = note;
  return tidy(o);
}

/** Unit price of a line: the project price list for catalogue products, the item itself otherwise. */
export function withPrice(p: Project, line: BomLine, price: number): Partial<Project> {
  const v = Math.max(0, Number.isFinite(price) ? price : 0);
  if (line.productId) return { prices: { ...p.prices, [line.productId]: v } };
  const o = orderOf(p);
  o.added = o.added.map((a) => (a.id === line.addedId ? { ...a, unitPrice: v } : a));
  return { order: tidy(o) };
}

export interface NewItem {
  productId?: string;
  name?: string;
  unit?: Unit;
  unitPrice?: number;
  /** units, or pieces for boxed products */
  qty: number;
  /** stock length for timber sold by the metre (then qty is pieces of it) */
  length?: number;
}

/**
 * Add something to the order. A catalogue product already on the list gets the quantity added to its
 * line (timber cut on the cutting diagrams: to its spare; a line taken off comes back with this quantity, except
 * timber, which would bring its whole cut back: that becomes a line of its own); anything else becomes a line of
 * its own.
 */
export function withAdded(p: Project, design: DesignResult, item: NewItem): { order: OrderEdits | null; key: string } {
  const o = orderOf(p);
  const qty = Math.max(0, Number.isFinite(item.qty) ? item.qty : 0);
  const prod = item.productId ? PRODUCT_MAP[item.productId] : undefined;
  if (prod) {
    const timber = prod.unit === 'm';
    const length = timber ? item.length ?? Math.max(...(prod.stockLengths ?? [6000])) : 0;
    const existing = design.bom.lines.find((l) => l.productId === prod.id && !l.addedId) ?? design.bom.lines.find((l) => l.productId === prod.id);
    if (existing && timber && existing.cutStock) {
      const spare = spareMapOf(existing);
      spare[String(length)] = (spare[String(length)] ?? 0) + Math.round(qty);
      o.lines[prod.id] = { ...o.lines[prod.id], removed: false, spare };
      return { order: tidy(o), key: existing.key };
    }
    if (existing && timber && existing.addedId) {
      const map = stockMapOf(existing);
      map[String(length)] = (map[String(length)] ?? 0) + Math.round(qty);
      o.added = o.added.map((a) => (a.id === existing.addedId ? { ...a, stock: map } : a));
      return { order: tidy(o), key: existing.key };
    }
    if (existing && !timber) {
      if (existing.addedId) o.added = o.added.map((a) => (a.id === existing.addedId ? { ...a, qty: (a.qty ?? 0) + qty } : a));
      else o.lines[prod.id] = { ...o.lines[prod.id], removed: false, qty: existing.qty + qty };
      return { order: tidy(o), key: existing.key };
    }
    if (!timber && design.bom.removed.some((l) => l.productId === prod.id)) {
      o.lines[prod.id] = { qty };
      return { order: tidy(o), key: prod.id };
    }
    const id = nextItemId(o);
    const added: OrderItem = timber ? { id, productId: prod.id, stock: { [String(length)]: Math.round(qty) } } : { id, productId: prod.id, qty };
    o.added.push(added);
    return { order: tidy(o), key: `add:${id}` };
  }
  const id = nextItemId(o);
  o.added.push({ id, name: (item.name ?? '').trim(), unit: item.unit ?? 'ea', unitPrice: Math.max(0, item.unitPrice ?? 0), qty });
  return { order: tidy(o), key: `add:${id}` };
}
