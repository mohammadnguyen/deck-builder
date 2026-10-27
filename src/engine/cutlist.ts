/**
 * 1D cutting-stock optimiser: nests the pieces of one product into the lengths it is bought in, two ways.
 * Simple (the company's default for framing): every stick cut into equal pieces of one length, from as few
 * lengths as will do, so the crew can cut without a cut list (packSimple). Cheapest: a cut list may mix lengths
 * and pieces on a stick (packPieces): several packings are tried and the one that buys the least timber wins,
 * then the fewest sticks, cutting patterns and different lengths.
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

/** a piece type of a simple cut list: lengths a few mm apart are one cut on site (they share a letter), planned
 *  at the longer */
interface PieceType {
  len: number;
  n: number;
  items: number[];
}

function pieceTypes(pieces: number[]): PieceType[] {
  const types: PieceType[] = [];
  for (const p of [...pieces].sort((a, b) => b - a)) {
    const last = types[types.length - 1];
    if (last && last.len - p <= 5) {
      last.n++;
      last.items.push(p);
    } else types.push({ len: p, n: 1, items: [p] });
  }
  return types;
}

interface SimplePlan {
  /** per piece type: the stick it comes from and how many pieces each gives; the odd pieces left over may come
   *  from another length of the set */
  picks: { len: number; n: number; stock: number; k: number; sticks: number; rest: { stock: number; k: number; sticks: number } | null }[];
  bought: number;
  cost: number;
}

/**
 * The simple cut list: every stick cut into equal pieces of one length (a whole stick, halves, thirds ...), from as
 * few stocked lengths as will do. Each set of one, two or three lengths is tried, every piece type taking the length
 * of the set that buys least for it; a length beyond the first is charged `extraLength` (mm of this timber).
 * null when a piece is longer than every stick.
 */
function simplePlan(types: PieceType[], stocks: number[], kerf: number, extraLength: number): SimplePlan | null {
  const longest = Math.max(...types.map((t) => t.len));
  const sets: number[][] = [];
  for (let i = 0; i < stocks.length; i++) {
    sets.push([stocks[i]]);
    for (let j = i + 1; j < stocks.length; j++) {
      sets.push([stocks[i], stocks[j]]);
      for (let k = j + 1; k < stocks.length; k++) sets.push([stocks[i], stocks[j], stocks[k]]);
    }
  }
  let best: (SimplePlan & { lengths: number; sticks: number }) | null = null;
  for (const set of sets) {
    if (Math.max(...set) < longest) continue;
    const picks: SimplePlan['picks'] = [];
    const per = (stock: number, len: number) => Math.max(1, Math.floor((stock + kerf) / (len + kerf)));
    const boughtOf = (p: SimplePlan['picks'][number]) => p.sticks * p.stock + (p.rest ? p.rest.sticks * p.rest.stock : 0);
    const sticksOf = (p: SimplePlan['picks'][number]) => p.sticks + (p.rest?.sticks ?? 0);
    for (const t of types) {
      let pick: SimplePlan['picks'][number] | null = null;
      for (const stock of set) {
        if (stock < t.len) continue;
        const k = per(stock, t.len);
        const full = Math.floor(t.n / k);
        const odd = t.n - full * k;
        // the odd pieces from the stick of the set that suits them (one 2.4 rather than a 5.4 for a last 2.2)
        for (const other of odd ? set : [stock]) {
          if (other < t.len) continue;
          const k2 = per(other, t.len);
          const c: SimplePlan['picks'][number] = odd
            ? { len: t.len, n: t.n, stock, k, sticks: full, rest: other === stock ? null : { stock: other, k: k2, sticks: Math.ceil(odd / k2) } }
            : { len: t.len, n: t.n, stock, k, sticks: full, rest: null };
          if (odd && other === stock) c.sticks = full + 1;
          // the least timber, then the fewest sticks (two 2.2s from a 4.8 rather than one each from two 2.4s)
          if (!pick || boughtOf(c) < boughtOf(pick) - 0.5 || (Math.abs(boughtOf(c) - boughtOf(pick)) <= 0.5 && sticksOf(c) < sticksOf(pick))) pick = c;
        }
      }
      picks.push(pick!);
    }
    const bought = picks.reduce((s, p) => s + boughtOf(p), 0);
    const lengths = new Set(picks.flatMap((p) => (p.rest ? [p.stock, p.rest.stock] : [p.stock]))).size;
    const sticks = picks.reduce((s, p) => s + sticksOf(p), 0);
    const cost = bought + extraLength * (lengths - 1);
    const better =
      !best || cost < best.cost - 0.5 || (Math.abs(cost - best.cost) <= 0.5 && (lengths < best.lengths || (lengths === best.lengths && sticks < best.sticks)));
    if (better) best = { picks, bought, cost, lengths, sticks };
  }
  return best;
}

/**
 * Pack for a crew without a cut list: every stick cut into equal pieces of one length, from as few stocked lengths
 * as will do (a length more only where it saves `extraLength` mm of this timber). Pieces a few mm apart are cut to
 * the longer. Falls back to the mixed packing when a piece is longer than every stick.
 */
export function packSimple(lengths: number[], stockLengths: number[], kerf: number, extraLength: number): PackResult {
  const stocks = [...new Set(stockLengths)].filter((s) => s > 0).sort((p, q) => p - q);
  const pieces = lengths.filter((l) => l > 0).map((l) => Math.ceil(l));
  const totalPieceLength = pieces.reduce((s, l) => s + l, 0);
  if (!stocks.length || !pieces.length) return { bins: [], groups: [], stockCount: [], totalStockLength: 0, totalPieceLength, wastePct: 0, oversize: [] };
  const types = pieceTypes(pieces);
  const plan = simplePlan(types, stocks, kerf, extraLength);
  if (!plan) return packPieces(lengths, stockLengths, kerf);
  const bins: Bin[] = [];
  plan.picks.forEach((p, ti) => {
    // the pieces themselves (a few mm apart at most) go on the sticks, so the cut list keeps each one's length
    const items = [...types[ti].items];
    const cut = (stock: number, n: number) => {
      const cuts = items.splice(0, n);
      const used = usedLength(cuts, kerf);
      bins.push({ stock, cuts, used, offcut: Math.max(0, stock - used) });
    };
    for (let i = 0; i < p.sticks && items.length; i++) cut(p.stock, Math.min(p.k, items.length));
    for (let i = 0; p.rest && i < p.rest.sticks && items.length; i++) cut(p.rest.stock, Math.min(p.rest.k, items.length));
  });
  return packResult(bins, totalPieceLength, []);
}

/** What a simple cut list costs, in mm of timber with each length beyond the first charged `extraLength`: for
 *  weighing one split against another. */
export function simpleLength(lengths: number[], stockLengths: number[], kerf: number, extraLength: number): number {
  const stocks = [...new Set(stockLengths)].filter((s) => s > 0).sort((p, q) => p - q);
  const pieces = lengths.filter((l) => l > 0).map((l) => Math.ceil(l));
  if (!stocks.length || !pieces.length) return 0;
  return simplePlan(pieceTypes(pieces), stocks, kerf, extraLength)?.cost ?? packedLength(lengths, stockLengths, kerf);
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

/** cut lengths of the pieces of a split whose pieces run on past each join by `ext` (a lap or a scarf) */
export function runOn(pieces: number[], ext: number): number[] {
  return ext ? pieces.map((p, k) => p + ext * ((k > 0 ? 1 : 0) + (k < pieces.length - 1 ? 1 : 0))) : pieces;
}

/**
 * Split a run the way a carpenter does: the fewest joins (pieces up to the longest stick), every join over a
 * support, and of the ways to do that, the one whose pieces come most cleanly out of the stocked lengths.
 * `avoid` rules supports out (a second ply never joins where the first does). `joinExt` is how far a piece runs
 * on past each join it makes (a lap or a scarf); the pieces returned are the distances between the joins, without
 * it. Returns null when the supports leave no way; the caller falls back to `splitRun`.
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
  joinExt = 0,
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
      const cut = len + joinExt * ((i > 0 ? 1 : 0) + (j < n - 1 ? 1 : 0));
      if (cut > maxLen + 0.5) continue;
      if (len < minPiece - 0.5 && !(i === 0 && j === n - 1)) continue;
      const jn = joins[i] + (j < n - 1 ? 1 : 0);
      const w = waste[i] + pieceWaste(Math.ceil(cut + allowance), stocks, kerf);
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
