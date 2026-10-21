import { clipHorizontal, clipVertical, normalizePolygon } from '../engine/geometry';
import { resolveBoardAxis, type BoardRow, type BoardRun, type LayoutResult } from '../engine/layout';
import type { Axis, BreakerLayout, ManualBreaker, Project, Pt } from '../model/types';

/*
 * Breakers are edited in board terms: a breaker sits at `pos` ALONG the boards and runs ACROSS
 * them from `c0` to `c1`. With the boards along x that is a vertical line x = pos; with the
 * boards along y it is a horizontal line y = pos.
 */
export const alongOf = (axis: Axis, p: Pt): number => (axis === 'x' ? p.x : p.y);
export const acrossOf = (axis: Axis, p: Pt): number => (axis === 'x' ? p.y : p.x);
/** intervals along the boards where the line `c` across lies inside the polygon */
export const clipAlong = (poly: Pt[], axis: Axis, c: number): [number, number][] => (axis === 'x' ? clipHorizontal(poly, c) : clipVertical(poly, c));
/** intervals across the boards where the line `a` along lies inside the polygon */
export const clipAcross = (poly: Pt[], axis: Axis, a: number): [number, number][] => (axis === 'x' ? clipVertical(poly, a) : clipHorizontal(poly, a));

const intersect = (p: [number, number][], q: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (const [a, b] of p) for (const [c, d] of q) if (Math.min(b, d) - Math.max(a, c) > 1) out.push([Math.max(a, c), Math.min(b, d)]);
  return out;
};
const subtract = (p: [number, number][], [c, d]: [number, number]): [number, number][] => {
  const out: [number, number][] = [];
  for (const [a, b] of p) {
    if (d <= a || c >= b) out.push([a, b]);
    else {
      if (c - a > 1) out.push([a, c]);
      if (b - d > 1) out.push([d, b]);
    }
  }
  return out;
};

export interface BreakerSpan {
  id: string;
  pos: number;
  c0: number;
  c1: number;
}

export function breakerSpans(lay: LayoutResult): BreakerSpan[] {
  const ax = lay.boardAxis;
  return lay.breakers.map((b) => ({
    id: b.id,
    pos: alongOf(ax, b.seg.a),
    c0: Math.min(acrossOf(ax, b.seg.a), acrossOf(ax, b.seg.b)),
    c1: Math.max(acrossOf(ax, b.seg.a), acrossOf(ax, b.seg.b)),
  }));
}

/** width a breaker takes out of the field: the board plus a gap each side */
export const stripWidth = (lay: LayoutResult): number => lay.boardWidth + 2 * lay.boardGap;

/** where the whole width of a breaker at `pos` lies inside the field (the same test the engine uses) */
export function stripClip(lay: LayoutResult, pos: number): [number, number][] {
  const s = stripWidth(lay) / 2 - 1;
  return intersect(clipAcross(lay.fieldPoly, lay.boardAxis, pos - s), clipAcross(lay.fieldPoly, lay.boardAxis, pos + s));
}

/*
 * An end stored as null ("to the edge") runs to the end of the breaker's line: the engine lays such a breaker
 * over every stretch of its line in that direction. So null is only ever written for an end at the very first
 * (from) or very last (to) edge of the line; an end at the edge of an inner stretch (a leg of a U, past a notch)
 * is stored as its number, or the breaker would also be laid across the other legs.
 */
const firstEdge = (clips: [number, number][]): number | null => (clips.length ? clips[0][0] : null);
const lastEdge = (clips: [number, number][]): number | null => (clips.length ? clips[clips.length - 1][1] : null);
const atEdge = (v: number, edge: number | null): boolean => edge !== null && Math.abs(v - edge) < 1;

/**
 * Where a breaker at `pos` may run across the boards: inside the field and clear of the other breakers (two
 * breaker boards side by side, one gap apart, are fine; closer they would lie on top of each other).
 */
export function freeClip(lay: LayoutResult, pos: number, id: string): [number, number][] {
  let out = stripClip(lay, pos);
  const near = lay.boardWidth + lay.boardGap - 1;
  for (const o of breakerSpans(lay)) if (o.id !== id && Math.abs(o.pos - pos) < near) out = subtract(out, [o.c0, o.c1]);
  return out;
}

/** Hand-placed breakers that reproduce the breakers on the plan (ends at the field edge become "to the edge"). */
export function freezeBreakers(lay: LayoutResult): BreakerLayout {
  const items: ManualBreaker[] = [];
  for (const b of breakerSpans(lay)) {
    const clips = stripClip(lay, b.pos);
    const from = atEdge(b.c0, firstEdge(clips)) ? null : b.c0;
    const to = atEdge(b.c1, lastEdge(clips)) ? null : b.c1;
    const same = items.find((it) => it.id === b.id);
    if (same) {
      // one breaker that comes back as two runs (split by a notch): keep one item covering both
      same.from = same.from === null || from === null ? null : Math.min(same.from, from);
      same.to = same.to === null || to === null ? null : Math.max(same.to, to);
    } else items.push({ id: b.id, pos: b.pos, from, to });
  }
  return { axis: lay.boardAxis, items };
}

/** The breakers to edit: the hand-placed set when it is in use, else the automatic layout frozen. */
export function currentBreakers(p: Project, lay: LayoutResult): BreakerLayout {
  if (lay.breakerMode === 'manual' && p.breakers) return { axis: p.breakers.axis, items: p.breakers.items.map((it) => ({ ...it })) };
  return freezeBreakers(lay);
}

export function updateBreaker(bl: BreakerLayout, id: string, patch: Partial<Omit<ManualBreaker, 'id'>>): BreakerLayout {
  return { ...bl, items: bl.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) };
}

/**
 * Move a breaker along the boards and keep its length: an end that runs "to the edge" stays so only
 * where the field ends at the same place at the new position; otherwise it is pinned where it was.
 */
export function movedBreaker(lay: LayoutResult, item: ManualBreaker, span: BreakerSpan, pos: number): Partial<Omit<ManualBreaker, 'id'>> {
  const mid = (span.c0 + span.c1) / 2;
  const clips = stripClip(lay, pos);
  const k = clips.findIndex(([a, b]) => mid >= a && mid <= b);
  // still "to the edge" only where that edge is the end of the line at the new place, and where it was
  const keepFrom = k === 0 && atEdge(span.c0, clips[0][0]);
  const keepTo = k >= 0 && k === clips.length - 1 && atEdge(span.c1, clips[k][1]);
  const from = item.from === null && !keepFrom ? span.c0 : item.from;
  const to = item.to === null && !keepTo ? span.c1 : item.to;
  return { pos, from, to };
}

/**
 * "Run to the edges": the breaker runs over the whole stretch of its line that holds it, up to the field
 * edges or the next breaker in the way.
 */
export function extendedBreaker(lay: LayoutResult, span: BreakerSpan): Partial<Omit<ManualBreaker, 'id'>> {
  const clips = stripClip(lay, span.pos);
  const mid = (span.c0 + span.c1) / 2;
  const iv = freeClip(lay, span.pos, span.id).find(([a, b]) => mid >= a - 1 && mid <= b + 1);
  if (!iv) return { from: span.c0, to: span.c1 };
  return { from: atEdge(iv[0], firstEdge(clips)) ? null : iv[0], to: atEdge(iv[1], lastEdge(clips)) ? null : iv[1] };
}

export function removeBreaker(bl: BreakerLayout, id: string): BreakerLayout {
  return { ...bl, items: bl.items.filter((it) => it.id !== id) };
}

export function nextBreakerId(bl: BreakerLayout): string {
  const n = bl.items.reduce((m, it) => Math.max(m, Number(/^B(\d+)$/.exec(it.id)?.[1] ?? 0)), 0);
  return `B${n + 1}`;
}

/** row centres across the boards between c0 and c1, plus the two ends, for sampling the field */
function samplesAcross(lay: LayoutResult, c0: number, c1: number): number[] {
  const out = [c0 + 1, c1 - 1];
  for (const r of lay.boards) if (r.pos > c0 && r.pos < c1) out.push(r.pos);
  return out.sort((p, q) => p - q);
}

/** free stretch along the boards around `pos` on the line `c` across: field edges or the neighbouring breakers */
function freeAt(lay: LayoutResult, others: BreakerSpan[], pos: number, c: number): [number, number] | null {
  const iv = clipAlong(lay.fieldPoly, lay.boardAxis, c).find(([a, b]) => pos >= a - 1 && pos <= b + 1);
  if (!iv) return null;
  const half = stripWidth(lay) / 2;
  let lo = iv[0];
  let hi = iv[1];
  for (const o of others) {
    if (c < o.c0 || c > o.c1) continue;
    if (o.pos < pos) lo = Math.max(lo, o.pos + half);
    else hi = Math.min(hi, o.pos - half);
  }
  return [lo, hi];
}

/**
 * How far a breaker may move along the boards: its whole width stays inside the field over its length,
 * and it may go right up to another breaker (the two boards one gap apart) but not onto it. There is no
 * other limit on the distance between breakers.
 */
export function breakerRoom(lay: LayoutResult, id: string, pos: number, c0: number, c1: number): [number, number] {
  const others = breakerSpans(lay).filter((b) => b.id !== id);
  const half = stripWidth(lay) / 2;
  const side = lay.boardWidth + lay.boardGap;
  let lo = -Infinity;
  let hi = Infinity;
  for (const c of samplesAcross(lay, c0, c1)) {
    const iv = clipAlong(lay.fieldPoly, lay.boardAxis, c).find(([a, b]) => pos >= a - 1 && pos <= b + 1);
    if (!iv) continue;
    lo = Math.max(lo, iv[0] + half);
    hi = Math.min(hi, iv[1] - half);
    for (const o of others) {
      if (c < o.c0 || c > o.c1) continue;
      if (o.pos < pos) lo = Math.max(lo, o.pos + side);
      else hi = Math.min(hi, o.pos - side);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [pos, pos];
  return [Math.min(lo, pos), Math.max(hi, pos)];
}

/** The board lengths either side of a breaker, one entry per stretch of rows where they are the same. */
export interface BayBand {
  /** across the boards: the stretch of rows, and its middle (where to draw the dimension) */
  c0: number;
  c1: number;
  c: number;
  /** along the boards: free stretch before and after the breaker */
  before: [number, number];
  after: [number, number];
}

export function breakerBays(lay: LayoutResult, id: string, pos: number, c0: number, c1: number): BayBand[] {
  const others = breakerSpans(lay).filter((b) => b.id !== id);
  const half = stripWidth(lay) / 2;
  const rows = [...lay.boards].filter((r) => r.pos > c0 && r.pos < c1).sort((p, q) => p.pos - q.pos);
  const bands: BayBand[] = [];
  for (const r of rows) {
    const f = freeAt(lay, others, pos, r.pos);
    if (!f) continue;
    const before: [number, number] = [f[0], pos - half];
    const after: [number, number] = [pos + half, f[1]];
    const last = bands[bands.length - 1];
    const top = r.pos - r.width / 2;
    const bot = r.pos + r.width / 2;
    if (last && Math.abs(last.before[0] - before[0]) < 1 && Math.abs(last.after[1] - after[1]) < 1) {
      last.c1 = bot;
      last.c = (last.c0 + last.c1) / 2;
    } else bands.push({ c0: top, c1: bot, c: (top + bot) / 2, before, after });
  }
  return bands;
}

/** the band of a breaker that holds most of its length (for the bar's numbers and the centre button) */
export function mainBay(bands: BayBand[]): BayBand | null {
  return bands.reduce<BayBand | null>((m, b) => (!m || b.c1 - b.c0 > m.c1 - m.c0 ? b : m), null);
}

/**
 * Snap a dragged breaker end to the edge of a board row (a start to a row's near edge, an end to
 * its far edge) or to the edge of the field, which is stored as null ("to the edge board") at the
 * ends of the breaker's line. With `id` the end also stops short of the other breakers.
 */
export function snapBreakerEnd(lay: LayoutResult, pos: number, value: number, end: 'from' | 'to', other: number, id?: string): number | null {
  const clips = stripClip(lay, pos);
  const free = id === undefined ? clips : freeClip(lay, pos, id);
  const iv = free.find(([a, b]) => other >= a - 1 && other <= b + 1) ?? free[0];
  if (!iv) return null;
  const cands = [end === 'from' ? iv[0] : iv[1]];
  for (const r of lay.boards) {
    const edge = end === 'from' ? r.pos - r.width / 2 : r.pos + r.width / 2;
    if (edge > iv[0] + 1 && edge < iv[1] - 1) cands.push(edge);
  }
  const minLen = lay.boardWidth;
  const ok = cands.filter((v) => (end === 'from' ? v <= other - minLen : v >= other + minLen));
  const pool = ok.length ? ok : cands;
  const best = pool.reduce((p, q) => (Math.abs(q - value) < Math.abs(p - value) ? q : p));
  return atEdge(best, end === 'from' ? firstEdge(clips) : lastEdge(clips)) ? null : best;
}

/**
 * Where a new breaker goes: across the middle of the longest board run, over the rows that share
 * that run's stretch of field (one band of the deck) and whose boards still pass that place.
 */
export function suggestBreaker(lay: LayoutResult): Omit<ManualBreaker, 'id'> | null {
  const ax = lay.boardAxis;
  const span = (run: BoardRun): [number, number] => {
    const a = alongOf(ax, run.seg.a);
    const b = alongOf(ax, run.seg.b);
    return [Math.min(a, b), Math.max(a, b)];
  };
  // whole-width boards only: a strip ripped where a row meets a notch is not a row of its own
  const whole = (row: BoardRow, run: BoardRun) => run.width >= row.width - 1;
  let best: { row: BoardRow; run: BoardRun } | null = null;
  for (const row of lay.boards) for (const run of row.runs) if (whole(row, run) && (!best || run.length > best.run.length)) best = { row, run };
  if (!best) return null;
  const [a0, a1] = span(best.run);
  const pos = Math.round((a0 + a1) / 2 / 10) * 10;
  const half = stripWidth(lay) / 2;
  const ivAt = (c: number) => clipAlong(lay.fieldPoly, ax, c).find(([a, b]) => pos >= a && pos <= b) ?? null;
  const ref = ivAt(best.row.pos);
  if (!ref) return null;
  const rows = [...lay.boards].sort((p, q) => p.pos - q.pos);
  const k = rows.indexOf(best.row);
  // a row belongs to the band when its field there is the same stretch and its boards still run through the
  // breaker's place (no breaker there yet)
  const same = (r: BoardRow) => {
    const iv = ivAt(r.pos);
    if (!iv || Math.abs(iv[0] - ref[0]) >= 1 || Math.abs(iv[1] - ref[1]) >= 1) return false;
    return r.runs.some((u) => {
      const [u0, u1] = span(u);
      return whole(r, u) && u0 <= pos - half + 1 && u1 >= pos + half - 1;
    });
  };
  let i0 = k;
  let i1 = k;
  while (i0 > 0 && same(rows[i0 - 1])) i0--;
  while (i1 < rows.length - 1 && same(rows[i1 + 1])) i1++;
  const c0 = rows[i0].pos - rows[i0].width / 2;
  const c1 = rows[i1].pos + rows[i1].width / 2;
  const clips = stripClip(lay, pos);
  const first = firstEdge(clips);
  const last = lastEdge(clips);
  return { pos, from: first !== null && c0 <= first + 1 ? null : c0, to: last !== null && c1 >= last - 1 ? null : c1 };
}

/**
 * The hand-placed breakers to keep when the board direction setting changes: all of them while the boards
 * still run the same way (picking the direction they already run in), none when the frame is laid out again.
 */
export function breakersForAxis(p: Project, pref: 'auto' | Axis): BreakerLayout | null {
  if (!p.breakers) return null;
  return resolveBoardAxis(normalizePolygon(p.deck), p.houseEdges, pref) === p.breakers.axis ? p.breakers : null;
}

/** Breakers of a project mirrored left to right with the deck (mx maps an x to its mirror). */
export function mirrorBreakers(bl: BreakerLayout | null | undefined, mx: (x: number) => number): BreakerLayout | null {
  if (!bl) return null;
  if (bl.axis === 'x') return { ...bl, items: bl.items.map((it) => ({ ...it, pos: mx(it.pos) })) };
  // horizontal breakers: their extent runs along x and swaps ends
  return { ...bl, items: bl.items.map((it) => ({ ...it, from: it.to === null ? null : mx(it.to), to: it.from === null ? null : mx(it.from) })) };
}
