/**
 * 1D cutting-stock optimiser: nests required piece lengths into purchasable
 * stock lengths. Best-fit-decreasing with a merge pass, then each bin is shrunk
 * to the smallest stock length that still fits its cuts.
 */
export interface Bin {
  stock: number;
  cuts: number[];
  used: number;
  offcut: number;
}

export interface BinGroup {
  stock: number;
  cuts: number[];
  count: number;
  offcut: number;
}

export interface PackResult {
  bins: Bin[];
  groups: BinGroup[];
  stockCount: { length: number; count: number }[];
  totalStockLength: number;
  totalPieceLength: number;
  wastePct: number;
  /** pieces longer than the longest stock; they are counted as one max-stock bin each */
  oversize: number[];
}

function usedLength(cuts: number[], kerf: number): number {
  if (!cuts.length) return 0;
  return cuts.reduce((s, c) => s + c, 0) + kerf * (cuts.length - 1);
}

export function packPieces(lengths: number[], stockLengths: number[], kerf: number): PackResult {
  const stocks = [...new Set(stockLengths)].filter((s) => s > 0).sort((p, q) => p - q);
  const pieces = lengths.filter((l) => l > 0).map((l) => Math.ceil(l));
  const totalPieceLength = pieces.reduce((s, l) => s + l, 0);
  if (!stocks.length || !pieces.length) {
    return { bins: [], groups: [], stockCount: [], totalStockLength: 0, totalPieceLength, wastePct: 0, oversize: [] };
  }
  const maxStock = stocks[stocks.length - 1];
  const oversize: number[] = [];
  const open: { cuts: number[]; used: number }[] = [];

  const sorted = [...pieces].sort((p, q) => q - p);
  for (const piece of sorted) {
    if (piece > maxStock) {
      oversize.push(piece);
      open.push({ cuts: [piece], used: piece });
      continue;
    }
    let best = -1;
    let bestRemain = Infinity;
    for (let i = 0; i < open.length; i++) {
      const b = open[i];
      if (b.cuts.length && b.cuts[0] > maxStock) continue; // oversize bin
      const need = b.cuts.length ? b.used + kerf + piece : piece;
      const remain = maxStock - need;
      if (remain >= 0 && remain < bestRemain) {
        best = i;
        bestRemain = remain;
      }
    }
    if (best >= 0) {
      open[best].cuts.push(piece);
      open[best].used = usedLength(open[best].cuts, kerf);
    } else {
      open.push({ cuts: [piece], used: piece });
    }
  }

  // merge pass: combine small bins when they fit together in one max stock
  let merged = true;
  while (merged) {
    merged = false;
    open.sort((p, q) => p.used - q.used);
    for (let i = 0; i < open.length && !merged; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const a = open[i];
        const b = open[j];
        if (a.cuts[0] > maxStock || b.cuts[0] > maxStock) continue;
        const combined = [...a.cuts, ...b.cuts];
        if (usedLength(combined, kerf) <= maxStock) {
          open.splice(j, 1);
          open.splice(i, 1);
          open.push({ cuts: combined.sort((p, q) => q - p), used: usedLength(combined, kerf) });
          merged = true;
          break;
        }
      }
    }
  }

  const bins: Bin[] = open.map((b) => {
    const fit = stocks.find((s) => s >= b.used) ?? maxStock;
    return { stock: fit, cuts: [...b.cuts].sort((p, q) => q - p), used: b.used, offcut: Math.max(0, fit - b.used) };
  });
  bins.sort((p, q) => q.stock - p.stock || q.used - p.used);

  const groupMap = new Map<string, BinGroup>();
  for (const b of bins) {
    const key = `${b.stock}|${b.cuts.join(',')}`;
    const g = groupMap.get(key);
    if (g) g.count += 1;
    else groupMap.set(key, { stock: b.stock, cuts: b.cuts, count: 1, offcut: b.offcut });
  }
  const groups = [...groupMap.values()];

  const countMap = new Map<number, number>();
  for (const b of bins) countMap.set(b.stock, (countMap.get(b.stock) ?? 0) + 1);
  const stockCount = [...countMap.entries()].map(([length, count]) => ({ length, count })).sort((p, q) => q.length - p.length);
  const totalStockLength = bins.reduce((s, b) => s + b.stock, 0);
  const wastePct = totalStockLength ? ((totalStockLength - totalPieceLength) / totalStockLength) * 100 : 0;
  return { bins, groups, stockCount, totalStockLength, totalPieceLength, wastePct, oversize };
}

/**
 * Split a run [start, end] into pieces no longer than maxLen, joining only at
 * support positions (joist / post centrelines). Returns piece lengths and the
 * absolute join positions. `firstTarget` lets callers stagger the first joint.
 */
export function splitRun(
  start: number,
  end: number,
  supports: number[],
  maxLen: number,
  minPiece: number,
  firstTarget?: number,
): { pieces: number[]; joins: number[]; offSupport: boolean } {
  const pieces: number[] = [];
  const joins: number[] = [];
  let offSupport = false;
  let cursor = start;
  let first = true;
  const sup = [...supports].sort((p, q) => p - q);
  let guard = 0;
  while (end - cursor > maxLen && guard++ < 500) {
    let target = cursor + maxLen;
    if (first && firstTarget !== undefined) target = Math.min(target, cursor + firstTarget);
    const candidates = sup.filter((s) => s <= target && s >= cursor + minPiece && end - s >= minPiece);
    let j: number;
    if (candidates.length) j = candidates[candidates.length - 1];
    else {
      const any = sup.filter((s) => s > cursor + minPiece && s < end - minPiece && s <= cursor + maxLen);
      if (any.length) j = any[any.length - 1];
      else {
        j = Math.min(target, end - minPiece);
        offSupport = true;
      }
    }
    if (j <= cursor) {
      j = cursor + maxLen;
      offSupport = true;
    }
    pieces.push(j - cursor);
    joins.push(j);
    cursor = j;
    first = false;
  }
  pieces.push(end - cursor);
  return { pieces, joins, offSupport };
}
