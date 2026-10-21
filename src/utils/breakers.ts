import { clipHorizontal, clipVertical } from '../engine/geometry';
import type { BoardRow, BoardRun, LayoutResult } from '../engine/layout';
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

/** Hand-placed breakers that reproduce the breakers on the plan (ends at the field edge become "to the edge"). */
export function freezeBreakers(lay: LayoutResult): BreakerLayout {
  const items: ManualBreaker[] = [];
  for (const b of breakerSpans(lay)) {
    const iv = stripClip(lay, b.pos).find(([a, c]) => b.c0 >= a - 1 && b.c1 <= c + 1);
    const from = iv && Math.abs(b.c0 - iv[0]) < 1 ? null : b.c0;
    const to = iv && Math.abs(b.c1 - iv[1]) < 1 ? null : b.c1;
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
  const iv = clips.find(([a, b]) => mid >= a && mid <= b) ?? null;
  const from = item.from === null && (!iv || Math.abs(iv[0] - span.c0) > 1) ? span.c0 : item.from;
  const to = item.to === null && (!iv || Math.abs(iv[1] - span.c1) > 1) ? span.c1 : item.to;
  return { pos, from, to };
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
 * its far edge) or to the edge of the field, which is stored as null ("to the edge board").
 */
export function snapBreakerEnd(lay: LayoutResult, pos: number, value: number, end: 'from' | 'to', other: number): number | null {
  const clips = stripClip(lay, pos);
  const iv = clips.find(([a, b]) => other >= a - 1 && other <= b + 1) ?? clips[0];
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
  const atEdge = end === 'from' ? Math.abs(best - iv[0]) < 1 : Math.abs(best - iv[1]) < 1;
  return atEdge ? null : best;
}

/**
 * Where a new breaker goes: across the middle of the longest board run, over the rows that share
 * that run's stretch of field (one band of the deck).
 */
export function suggestBreaker(lay: LayoutResult): Omit<ManualBreaker, 'id'> | null {
  const ax = lay.boardAxis;
  let best: { row: BoardRow; run: BoardRun } | null = null;
  for (const row of lay.boards) for (const run of row.runs) if (!best || run.length > best.run.length) best = { row, run };
  if (!best) return null;
  const a0 = Math.min(alongOf(ax, best.run.seg.a), alongOf(ax, best.run.seg.b));
  const a1 = Math.max(alongOf(ax, best.run.seg.a), alongOf(ax, best.run.seg.b));
  const pos = Math.round((a0 + a1) / 2 / 10) * 10;
  const ivAt = (c: number) => clipAlong(lay.fieldPoly, ax, c).find(([a, b]) => pos >= a && pos <= b) ?? null;
  const ref = ivAt(best.row.pos);
  if (!ref) return null;
  const rows = [...lay.boards].sort((p, q) => p.pos - q.pos);
  const k = rows.indexOf(best.row);
  const same = (r: BoardRow) => {
    const iv = ivAt(r.pos);
    return !!iv && Math.abs(iv[0] - ref[0]) < 1 && Math.abs(iv[1] - ref[1]) < 1;
  };
  let i0 = k;
  let i1 = k;
  while (i0 > 0 && same(rows[i0 - 1])) i0--;
  while (i1 < rows.length - 1 && same(rows[i1 + 1])) i1++;
  const c0 = rows[i0].pos - rows[i0].width / 2;
  const c1 = rows[i1].pos + rows[i1].width / 2;
  const iv = stripClip(lay, pos).find(([a, b]) => (c0 + c1) / 2 >= a && (c0 + c1) / 2 <= b);
  return { pos, from: iv && c0 <= iv[0] + 1 ? null : c0, to: iv && c1 >= iv[1] - 1 ? null : c1 };
}

/** Breakers of a project mirrored left to right with the deck (mx maps an x to its mirror). */
export function mirrorBreakers(bl: BreakerLayout | null | undefined, mx: (x: number) => number): BreakerLayout | null {
  if (!bl) return null;
  if (bl.axis === 'x') return { ...bl, items: bl.items.map((it) => ({ ...it, pos: mx(it.pos) })) };
  // horizontal breakers: their extent runs along x and swaps ends
  return { ...bl, items: bl.items.map((it) => ({ ...it, from: it.to === null ? null : mx(it.to), to: it.from === null ? null : mx(it.from) })) };
}
