import { packedLength } from './cutlist';

/**
 * Where the breaker boards go on a run longer than one board: always symmetric, and of the symmetric ways the one
 * that wastes the least decking, the way a carpenter lays out 5.4 m boards: 2.7 | 5.4 | 2.7 rather than three
 * equal 3.6 m pieces that each leave 1.8 m. The pieces are taken from lengths that nest into whole boards
 * (a whole board, halves, thirds ...), one of them taking up the rest; of the splits that buy the same boards, the
 * one that needs the fewest joists, then the one whose shortest piece is longest. A breaker beyond the fewest that
 * fit is added only when it saves at least `extraBreakerBoards` boards.
 */
export interface BreakerSplitInput {
  /** run length between the edge boards (mm) */
  len: number;
  /** board rows in the band, and its width across the rows (the breaker boards' length) */
  rows: number;
  bandWidth: number;
  /** breaker board width plus a gap each side */
  strip: number;
  /** the lengths the decking comes in, end trim and saw kerf */
  stocks: number[];
  allowance: number;
  kerf: number;
  minPiece: number;
  /** a set number of breakers (else the count that wastes least) */
  count: 'auto' | number;
  extraBreakerBoards: number;
  /** joist centres between the breakers (to weigh splits that buy the same boards) */
  joistSpacing?: number;
}

export interface BreakerSplit {
  /** piece lengths from one end of the run to the other (n + 1 of them) */
  pieces: number[];
  n: number;
  /** decking the band needs with this split (mm of boards bought, breaker boards included) */
  bought: number;
  /** one of the extra splits offered (an edge board line continued from an inside corner) */
  extra?: boolean;
  /** with a set count: a count that would buy fewer boards, and how many fewer */
  better?: { n: number; boards: number };
}

/** finished piece lengths that nest k to a board (k = 1 to 5) */
export function nestingLengths(stocks: number[], kerf: number, allowance: number, minPiece: number, maxPiece: number): number[] {
  const longest = Math.max(...stocks);
  const out = new Set<number>();
  for (const s of stocks) {
    for (let k = 1; k <= (s === longest ? 5 : 1); k++) {
      const piece = Math.floor((s + kerf) / k - kerf) - allowance;
      if (piece >= minPiece && piece <= maxPiece) out.add(piece);
    }
  }
  return [...out].sort((a, b) => b - a);
}

/**
 * The symmetric splits of a run with n breakers: the pieces pair up from the ends inwards (with a middle piece when
 * n is even); every pair and the middle take a nesting length except one, which takes the rest. The even split is
 * always one of them.
 */
export function symmetricSplits(len: number, n: number, strip: number, nice: number[], minPiece: number, maxPiece: number): number[][] {
  const rest = len - n * strip;
  const pairs = Math.floor((n + 1) / 2);
  const middle = (n + 1) % 2 === 1;
  const slots = pairs + (middle ? 1 : 0);
  const mult = (i: number) => (middle && i === slots - 1 ? 1 : 2);
  const seq = (vals: number[]): number[] => {
    const half = vals.slice(0, pairs);
    return middle ? [...half, vals[slots - 1], ...[...half].reverse()] : [...half, ...[...half].reverse()];
  };
  const out: number[][] = [new Array<number>(n + 1).fill(rest / (n + 1))];
  for (let free = 0; free < slots; free++) {
    const others = Array.from({ length: slots }, (_, i) => i).filter((i) => i !== free);
    let combos: number[][] = [[]];
    for (let o = 0; o < others.length; o++) combos = combos.flatMap((c) => nice.map((v) => [...c, v]));
    for (const combo of combos) {
      const vals = new Array<number>(slots);
      let used = 0;
      others.forEach((slot, i) => {
        vals[slot] = combo[i];
        used += combo[i] * mult(slot);
      });
      const v = (rest - used) / mult(free);
      if (v < minPiece || v > maxPiece) continue;
      vals[free] = v;
      out.push(seq(vals));
    }
  }
  return out.filter((s) => s.every((p) => p >= minPiece - 0.5 && p <= maxPiece + 0.5));
}

const cache = new Map<string, BreakerSplit | null>();
/** how much longer a shortest piece must be to count (a few mm either way is no different on site) */
const CLEARLY_LONGER = 100;

/** the decking a band needs with these pieces in every row and n breaker boards across it (mm bought) */
function bandBoards(pieces: number[], n: number, inp: BreakerSplitInput, maxPiece: number): number {
  // rows repeat: twelve of them show how the pieces nest (halves, thirds, quarters), scaled to the band
  const sample = Math.min(inp.rows, 12);
  const cuts: number[] = [];
  for (let r = 0; r < sample; r++) for (const p of pieces) cuts.push(p + inp.allowance);
  const rowsPart = (packedLength(cuts, inp.stocks, inp.kerf) * inp.rows) / sample;
  const bk = Math.max(1, Math.ceil(inp.bandWidth / maxPiece));
  const bcuts: number[] = [];
  for (let i = 0; i < n * bk; i++) bcuts.push(inp.bandWidth / bk + inp.allowance);
  return rowsPart + packedLength(bcuts, inp.stocks, inp.kerf);
}

/** The breakers of one band: the symmetric split that buys the least decking. null when the run fits one board. */
export function bestBreakerSplit(inp: BreakerSplitInput, extra: { pieces: number[]; n: number }[] = []): BreakerSplit | null {
  const key = JSON.stringify([inp, extra]);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const longest = Math.max(...inp.stocks);
  const maxPiece = longest - inp.allowance;
  let result: BreakerSplit | null = null;
  if (inp.len > maxPiece) {
    let nMin = Math.max(1, Math.ceil(inp.len / maxPiece) - 1);
    while ((inp.len - nMin * inp.strip) / (nMin + 1) > maxPiece) nMin++;
    const nice = nestingLengths(inp.stocks, inp.kerf, inp.allowance, inp.minPiece, maxPiece);
    const penalty = Math.max(0, inp.extraBreakerBoards) * longest;
    // a quick measure: the boards a row takes when each piece nests only with its own kind
    const quick = (pieces: number[]): number =>
      pieces.reduce((s, p) => {
        const cut = p + inp.allowance;
        let best = Infinity;
        for (const st of inp.stocks) if (st >= cut) best = Math.min(best, st / Math.floor((st + inp.kerf) / (cut + inp.kerf)));
        return s + best;
      }, 0);
    // the joists between the breakers, each bay as long as its piece
    const spacing = inp.joistSpacing ?? 0;
    const joists = (pieces: number[]): number => (spacing > 0 ? pieces.reduce((s, p) => s + Math.max(0, Math.ceil(p / spacing - 1e-9) - 1), 0) : 0);
    type Cand = { pieces: number[]; extra: boolean; q: number; joists: number; shortest: number };
    const describe = (pieces: number[], offered: boolean): Cand => ({ pieces, extra: offered, q: quick(pieces), joists: joists(pieces), shortest: Math.min(...pieces) });
    // of two splits that buy the same boards: the one that nests better row by row (the sample rounds), then the one
    // that needs fewer joists, then the one whose shortest piece is clearly longer (2.64 | 1.33 | 2.64 rather than
    // 0.62 | 5.38 | 0.62)
    const finer = (a: Cand, b: Cand): boolean =>
      Math.abs(a.q - b.q) > 1 ? a.q < b.q : a.joists !== b.joists ? a.joists < b.joists : a.shortest > b.shortest + CLEARLY_LONGER;
    const weigh = (n: number, nFrom: number) => {
      let best: (Cand & { bought: number; cost: number }) | null = null;
      const all = [
        ...symmetricSplits(inp.len, n, inp.strip, nice, inp.minPiece, maxPiece).map((pieces) => describe(pieces, false)),
        ...extra.filter((e) => e.n === n).map((e) => describe(e.pieces, true)),
      ];
      // the even split and the offered ones always, then the six that measure best
      const ranked = all.slice(1).filter((c) => !c.extra).sort((a, b) => (finer(a, b) ? -1 : finer(b, a) ? 1 : 0)).slice(0, 6);
      const cands = [all[0], ...ranked, ...all.filter((c) => c.extra)];
      for (const c of cands) {
        const bought = bandBoards(c.pieces, n, inp, maxPiece);
        const cost = bought + (n - nFrom) * penalty;
        // fewer boards first (an edge board line from an inside corner wins only so), then the finer split
        if (!best || cost < best.cost - 1 || (!c.extra && cost <= best.cost + 1 && finer(c, best))) best = { ...c, bought, cost };
      }
      return best;
    };
    if (inp.count === 'auto') {
      let pick: { pieces: number[]; bought: number; cost: number; n: number; extra: boolean } | null = null;
      for (let n = nMin; n <= nMin + 2; n++) {
        const b = weigh(n, nMin);
        if (b && (!pick || b.cost < pick.cost - 1)) pick = { ...b, n };
        // one more breaker did not pay: nor will two
        else if (pick && n > nMin) break;
      }
      if (pick) result = { pieces: pick.pieces, n: pick.n, bought: pick.bought, extra: pick.extra };
    } else {
      const n = Math.max(nMin, inp.count);
      const b = weigh(n, n);
      if (b) {
        result = { pieces: b.pieces, n, bought: b.bought };
        // a count that buys fewer boards
        for (let m = nMin; m <= Math.max(n + 1, 3); m++) {
          if (m === n) continue;
          const o = weigh(m, m);
          const boards = o ? Math.floor((b.bought - o.bought) / longest) : 0;
          if (o && boards >= 3 && (!result.better || boards > result.better.boards)) result.better = { n: m, boards };
        }
      }
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
}
