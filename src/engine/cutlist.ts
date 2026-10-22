/**
 * 1D cutting-stock optimiser: nests the pieces of one product into the lengths it is bought in. A cut list may
 * mix lengths, the way a carpenter buys them: a 2.5 m joist comes from half a 5.4, a 4.5 m one from a 4.8.
 * Several packings are tried and the one that buys the least timber wins, then the fewest sticks, cutting
 * patterns and different lengths. The best single length is one of them, so mixing never buys more than
 * one length would.
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
  const longest = Math.max(...pieces);
  const fits = stocks.filter((s) => s >= longest);
  const tries: PackResult[] = [];
  // everything from one length (each length that takes the longest piece)
  for (const L of fits.length ? fits : [stocks[stocks.length - 1]]) tries.push(packInto(pieces, [L], kerf, totalPieceLength));
  if (stocks.length > 1) {
    // mixed: best fit into the longest sticks, each stick then bought as short as its cuts allow
    tries.push(packInto(pieces, stocks, kerf, totalPieceLength));
    // like pieces first, cut together from the length that suits them (two 2.7s from a 5.4), the rest mixed
    tries.push(packPatterns(pieces, stocks, kerf, totalPieceLength));
  }
  return tries.reduce((best, r) => (betterPack(r, best) ? r : best));
}

/** The timber a set of pieces needs, quickly: the mixed packings only, for weighing one split against another
 *  (the order itself is packed in full by packPieces). */
export function packedLength(lengths: number[], stockLengths: number[], kerf: number): number {
  const stocks = [...new Set(stockLengths)].filter((s) => s > 0).sort((p, q) => p - q);
  const pieces = lengths.filter((l) => l > 0).map((l) => Math.ceil(l));
  if (!stocks.length || !pieces.length) return 0;
  const a = packInto(pieces, stocks, kerf, 0).totalStockLength;
  return stocks.length > 1 ? Math.min(a, packPatterns(pieces, stocks, kerf, 0).totalStockLength) : a;
}

function betterPack(a: PackResult, b: PackResult): boolean {
  if (Math.abs(a.totalStockLength - b.totalStockLength) > 0.5) return a.totalStockLength < b.totalStockLength;
  if (a.bins.length !== b.bins.length) return a.bins.length < b.bins.length;
  if (a.groups.length !== b.groups.length) return a.groups.length < b.groups.length;
  return a.stockCount.length < b.stockCount.length;
}

/** Pieces of one length cut together from the stick they suit best (at least two from a stick), the rest packed
 *  mixed: the carpenter's way with a stack of equal joists. */
function packPatterns(pieces: number[], stocks: number[], kerf: number, totalPieceLength: number): PackResult {
  const maxStock = stocks[stocks.length - 1];
  const count = new Map<number, number>();
  for (const p of pieces) count.set(p, (count.get(p) ?? 0) + 1);
  const fixed: Bin[] = [];
  const rest: number[] = [];
  for (const [len, n] of [...count.entries()].sort((a, b) => b[0] - a[0])) {
    let best: { stock: number; k: number; waste: number } | null = null;
    if (len <= maxStock) {
      for (const stock of stocks) {
        const k = Math.floor((stock + kerf) / (len + kerf));
        if (k < 2) continue;
        const waste = (stock - k * len - (k - 1) * kerf) / k;
        if (!best || waste < best.waste - 0.5) best = { stock, k, waste };
      }
    }
    const sticks = best ? Math.floor(n / best.k) : 0;
    for (let i = 0; i < sticks; i++) {
      const cuts = new Array<number>(best!.k).fill(len);
      const used = usedLength(cuts, kerf);
      fixed.push({ stock: best!.stock, cuts, used, offcut: Math.max(0, best!.stock - used) });
    }
    for (let i = sticks * (best?.k ?? 0); i < n; i++) rest.push(len);
  }
  const r = packInto(rest, stocks, kerf, 0);
  return packResult([...fixed, ...r.bins], totalPieceLength, r.oversize);
}

function packInto(pieces: number[], stocks: number[], kerf: number, totalPieceLength: number): PackResult {
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

  // each stick bought as short as its cuts allow
  const bins: Bin[] = open.map((b) => {
    const fit = stocks.find((s) => s >= b.used) ?? maxStock;
    return { stock: fit, cuts: [...b.cuts].sort((p, q) => q - p), used: b.used, offcut: Math.max(0, fit - b.used) };
  });
  return packResult(bins, totalPieceLength, oversize);
}

function packResult(bins: Bin[], totalPieceLength: number, oversize: number[]): PackResult {
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

/**
 * How cleanly a cut comes out of the stocked lengths: what is wasted per piece when a stick is cut into as many
 * of it as fit (a 2.52 m cut: half a 5.4, 180 mm each). Infinity when it is longer than every stick.
 */
export function pieceWaste(cut: number, stocks: number[], kerf: number): number {
  let best = Infinity;
  for (const stock of stocks) {
    if (stock < cut) continue;
    const k = Math.floor((stock + kerf) / (cut + kerf));
    best = Math.min(best, (stock - k * cut - (k - 1) * kerf) / k);
  }
  return best;
}

/**
 * Split a run the way a carpenter does: the fewest joins (pieces up to the longest stick), every join over a
 * support, and of the ways to do that, the one whose pieces come most cleanly out of the stocked lengths.
 * `avoid` rules supports out (a second ply never joins where the first does). Returns null when the supports
 * leave no way; the caller falls back to `splitRun`.
 */
export function splitRunStocked(
  start: number,
  end: number,
  supports: number[],
  stocks: number[],
  allowance: number,
  kerf: number,
  minPiece: number,
  avoid?: (pos: number) => boolean,
): { pieces: number[]; joins: number[]; offSupport: boolean } | null {
  if (!stocks.length) return null;
  const maxLen = Math.max(...stocks) - allowance;
  const inner = [...new Set(supports)]
    .filter((s) => s >= start + minPiece - 0.5 && s <= end - minPiece + 0.5 && !(avoid && avoid(s)))
    .sort((p, q) => p - q);
  const pts = [start, ...inner, end];
  const n = pts.length;
  const joins = new Array<number>(n).fill(Infinity);
  const waste = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  joins[0] = 0;
  waste[0] = 0;
  for (let j = 1; j < n; j++) {
    for (let i = 0; i < j; i++) {
      if (!Number.isFinite(joins[i])) continue;
      const len = pts[j] - pts[i];
      if (len > maxLen + 0.5) continue;
      if (len < minPiece - 0.5 && !(i === 0 && j === n - 1)) continue;
      const jn = joins[i] + (j < n - 1 ? 1 : 0);
      const w = waste[i] + pieceWaste(Math.ceil(len + allowance), stocks, kerf);
      if (jn < joins[j] || (jn === joins[j] && w < waste[j] - 0.5)) {
        joins[j] = jn;
        waste[j] = w;
        prev[j] = i;
      }
    }
  }
  if (!Number.isFinite(joins[n - 1])) return null;
  const idx: number[] = [];
  for (let k = n - 1; k > 0; k = prev[k]) idx.unshift(k);
  const out = { pieces: [] as number[], joins: [] as number[], offSupport: false };
  let from = start;
  for (const k of idx) {
    out.pieces.push(pts[k] - from);
    if (k < n - 1) out.joins.push(pts[k]);
    from = pts[k];
  }
  return out;
}
