import { PRODUCT_MAP, stockLengthsOf } from '../model/catalog';
import type { OrderEdits, ProductCategory, RuleSet, Unit } from '../model/types';
import { packPieces, type BinGroup } from './cutlist';

export interface Piece {
  productId: string;
  length: number;
  tag: string;
}

export interface CountItem {
  productId: string;
  qty: number;
  tag: string;
}

export interface BomLine {
  /** stable key: the product for calculated lines, add:<id> for items added by hand */
  key: string;
  /** empty for a free-text item added by hand */
  productId: string;
  /** name of a free-text item */
  name?: string;
  category: ProductCategory;
  unit: Unit;
  /** purchase quantity: number of stock pieces for 'm' products, otherwise units */
  qty: number;
  stockBreakdown?: { length: number; count: number }[];
  requiredLm?: number;
  purchasedLm?: number;
  cutWastePct?: number;
  extraCount?: number;
  extraPct?: number;
  unitPrice: number;
  total: number;
  tags: string[];
  /** quantity changed by hand; the calculated quantity and stock lengths are kept for reference */
  edited?: boolean;
  calcQty?: number;
  calcStock?: { length: number; count: number }[];
  /** an item added by hand (its id in OrderEdits.added) */
  addedId?: string;
}

export interface CutList {
  productId: string;
  groups: BinGroup[];
  /** what each cut length is for (piece tags: joist, bearer, post ...), lengths as cut */
  uses: { length: number; tags: string[] }[];
  wastePct: number;
  totalStock: number;
  totalPieces: number;
  oversize: number[];
}

export interface BomOptions {
  pricesIncludeGst: boolean;
  supplierDiscountPct: number;
  deliveryFee: number;
  /** hand changes to the order list */
  edits?: OrderEdits | null;
}

export interface BomResult {
  /** the order: calculated lines with hand changes, and items added by hand */
  lines: BomLine[];
  /** calculated lines taken off the order by hand (kept so they can be put back) */
  removed: BomLine[];
  cutlists: CutList[];
  /** sum of all lines before discount */
  linesTotal: number;
  discount: number;
  delivery: number;
  /** after discount and delivery, before GST is separated */
  subtotal: number;
  exGst: number;
  gst: number;
  total: number;
  pricesIncludeGst: boolean;
}

const CATEGORY_ORDER: ProductCategory[] = ['decking', 'framing', 'post', 'balustrade', 'hardware', 'concrete', 'consumable', 'other'];

/** stock lengths from a hand-edited map, longest first, empty entries dropped */
export function stockFromMap(map: Record<string, number> | undefined): { length: number; count: number }[] {
  return Object.entries(map ?? {})
    .map(([len, count]) => ({ length: Number(len), count: Math.max(0, Math.round(Number(count) || 0)) }))
    .filter((s) => s.length > 0 && s.count > 0)
    .sort((p, q) => q.length - p.length);
}

export function buildBom(
  pieces: Piece[],
  counts: CountItem[],
  prices: Record<string, number>,
  rules: RuleSet,
  /** spare boards per decking, edge board and fascia product (framing and posts take wasteFramingPct) */
  boardSpares: Record<string, number>,
  wasteFramingPct: number,
  gstPct: number,
  opts: BomOptions = { pricesIncludeGst: false, supplierDiscountPct: 0, deliveryFee: 0 },
): BomResult {
  const lines: BomLine[] = [];
  const cutlists: CutList[] = [];
  const priceOf = (id: string): number => {
    const v = prices[id];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return PRODUCT_MAP[id]?.defaultPrice ?? 0;
  };

  const byProduct = new Map<string, Piece[]>();
  for (const p of pieces) {
    if (!(p.length > 0)) continue;
    const arr = byProduct.get(p.productId) ?? [];
    arr.push(p);
    byProduct.set(p.productId, arr);
  }
  for (const [productId, list] of byProduct) {
    const prod = PRODUCT_MAP[productId];
    if (!prod) continue;
    const stock = stockLengthsOf(prod, rules);
    const pack = packPieces(list.map((p) => p.length), stock, rules.kerf);
    const requiredLm = pack.totalPieceLength / 1000;
    const pct = prod.category === 'decking' ? undefined : wasteFramingPct;
    const count = pack.bins.length;
    const extraCount = pct === undefined ? Math.max(0, Math.round(boardSpares[productId] ?? 0)) : Math.round((count * pct) / 100);
    const breakdown = pack.stockCount.map((s) => ({ ...s }));
    if (extraCount > 0 && breakdown.length) {
      const common = [...breakdown].sort((p, q) => q.count - p.count)[0];
      common.count += extraCount;
    }
    const purchasedLm = breakdown.reduce((s, b) => s + (b.length * b.count) / 1000, 0);
    const unitPrice = priceOf(productId);
    lines.push({
      productId,
      category: prod.category,
      unit: prod.unit,
      qty: count + extraCount,
      stockBreakdown: breakdown,
      requiredLm,
      purchasedLm,
      cutWastePct: pack.wastePct,
      extraCount,
      extraPct: pct,
      unitPrice,
      total: prod.unit === 'm' ? purchasedLm * unitPrice : (count + extraCount) * unitPrice,
      tags: [...new Set(list.map((p) => p.tag))],
      key: productId,
    });
    const uses = new Map<number, Set<string>>();
    for (const pc of list) {
      const len = Math.ceil(pc.length);
      const set = uses.get(len) ?? new Set<string>();
      set.add(pc.tag);
      uses.set(len, set);
    }
    cutlists.push({
      productId,
      groups: pack.groups,
      uses: [...uses.entries()].map(([length, tags]) => ({ length, tags: [...tags] })),
      wastePct: pack.wastePct,
      totalStock: pack.totalStockLength,
      totalPieces: pack.totalPieceLength,
      oversize: pack.oversize,
    });
  }

  const countMap = new Map<string, { qty: number; tags: Set<string> }>();
  for (const c of counts) {
    if (!(c.qty > 0)) continue;
    const cur = countMap.get(c.productId) ?? { qty: 0, tags: new Set<string>() };
    cur.qty += c.qty;
    cur.tags.add(c.tag);
    countMap.set(c.productId, cur);
  }
  for (const [productId, c] of countMap) {
    const prod = PRODUCT_MAP[productId];
    if (!prod) continue;
    const qty = prod.unit === 'L' ? Math.ceil(c.qty * 10) / 10 : Math.ceil(c.qty);
    const unitPrice = priceOf(productId);
    lines.push({ key: productId, productId, category: prod.category, unit: prod.unit, qty, unitPrice, total: qty * unitPrice, tags: [...c.tags] });
  }

  // ---- hand changes: quantities, lines taken off, items added ----
  const removed: BomLine[] = [];
  const edits = opts.edits;
  if (edits) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const e = edits.lines?.[l.productId];
      if (!e) continue;
      if (e.removed) {
        removed.push(l);
        lines.splice(i, 1);
        continue;
      }
      if (l.unit === 'm' && e.stock) {
        const breakdown = stockFromMap(e.stock);
        const purchasedLm = breakdown.reduce((s, b) => s + (b.length * b.count) / 1000, 0);
        lines[i] = { ...l, edited: true, calcQty: l.qty, calcStock: l.stockBreakdown, stockBreakdown: breakdown, qty: breakdown.reduce((s, b) => s + b.count, 0), purchasedLm, extraCount: undefined, total: purchasedLm * l.unitPrice };
      } else if (l.unit !== 'm' && typeof e.qty === 'number' && Number.isFinite(e.qty)) {
        const qty = Math.max(0, e.qty);
        lines[i] = { ...l, edited: true, calcQty: l.qty, qty, total: qty * l.unitPrice };
      }
    }
    for (const it of edits.added ?? []) {
      const prod = it.productId ? PRODUCT_MAP[it.productId] : undefined;
      if (prod) {
        const unitPrice = priceOf(prod.id);
        if (prod.unit === 'm') {
          const breakdown = stockFromMap(it.stock);
          const purchasedLm = breakdown.reduce((s, b) => s + (b.length * b.count) / 1000, 0);
          lines.push({ key: `add:${it.id}`, productId: prod.id, category: prod.category, unit: prod.unit, qty: breakdown.reduce((s, b) => s + b.count, 0), stockBreakdown: breakdown, purchasedLm, unitPrice, total: purchasedLm * unitPrice, tags: ['added'], addedId: it.id });
        } else {
          const qty = Math.max(0, Number(it.qty) || 0);
          lines.push({ key: `add:${it.id}`, productId: prod.id, category: prod.category, unit: prod.unit, qty, unitPrice, total: qty * unitPrice, tags: ['added'], addedId: it.id });
        }
      } else if (!it.productId) {
        const qty = Math.max(0, Number(it.qty) || 0);
        const unitPrice = Math.max(0, Number(it.unitPrice) || 0);
        lines.push({ key: `add:${it.id}`, productId: '', name: (it.name ?? '').trim() || '-', category: 'other', unit: it.unit ?? 'ea', qty, unitPrice, total: qty * unitPrice, tags: ['added'], addedId: it.id });
      }
    }
  }

  lines.sort((p, q) => {
    const c = CATEGORY_ORDER.indexOf(p.category) - CATEGORY_ORDER.indexOf(q.category);
    if (c !== 0) return c;
    // items added by hand come after the calculated ones of their group, in the order they were added
    const a = (p.addedId ? 1 : 0) - (q.addedId ? 1 : 0);
    if (a !== 0) return a;
    return p.addedId ? 0 : p.productId.localeCompare(q.productId);
  });
  const linesTotal = lines.reduce((s, l) => s + l.total, 0);
  const discount = (linesTotal * Math.max(0, opts.supplierDiscountPct)) / 100;
  const delivery = Math.max(0, opts.deliveryFee);
  const subtotal = linesTotal - discount + delivery;
  if (opts.pricesIncludeGst) {
    const exGst = subtotal / (1 + gstPct / 100);
    return { lines, removed, cutlists, linesTotal, discount, delivery, subtotal, exGst, gst: subtotal - exGst, total: subtotal, pricesIncludeGst: true };
  }
  const gst = (subtotal * gstPct) / 100;
  return { lines, removed, cutlists, linesTotal, discount, delivery, subtotal, exGst: subtotal, gst, total: subtotal + gst, pricesIncludeGst: false };
}
