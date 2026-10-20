import { PRODUCT_MAP } from '../model/catalog';
import type { ProductCategory, RuleSet, Unit } from '../model/types';
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
  productId: string;
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
}

export interface CutList {
  productId: string;
  groups: BinGroup[];
  wastePct: number;
  totalStock: number;
  totalPieces: number;
  oversize: number[];
}

export interface BomResult {
  lines: BomLine[];
  cutlists: CutList[];
  subtotal: number;
  gst: number;
  total: number;
}

const CATEGORY_ORDER: ProductCategory[] = ['decking', 'framing', 'post', 'balustrade', 'hardware', 'concrete', 'consumable'];

export function buildBom(
  pieces: Piece[],
  counts: CountItem[],
  prices: Record<string, number>,
  rules: RuleSet,
  wasteDeckingPct: number,
  wasteFramingPct: number,
  gstPct: number,
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
    const stock = prod.stockLengths ?? [];
    const pack = packPieces(list.map((p) => p.length), stock, rules.kerf);
    const requiredLm = pack.totalPieceLength / 1000;
    const pct = prod.category === 'decking' ? wasteDeckingPct : wasteFramingPct;
    const count = pack.bins.length;
    const extraCount = Math.round((count * pct) / 100);
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
    });
    cutlists.push({
      productId,
      groups: pack.groups,
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
    lines.push({ productId, category: prod.category, unit: prod.unit, qty, unitPrice, total: qty * unitPrice, tags: [...c.tags] });
  }

  lines.sort((p, q) => {
    const c = CATEGORY_ORDER.indexOf(p.category) - CATEGORY_ORDER.indexOf(q.category);
    if (c !== 0) return c;
    return p.productId.localeCompare(q.productId);
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const gst = (subtotal * gstPct) / 100;
  return { lines, cutlists, subtotal, gst, total: subtotal + gst };
}
