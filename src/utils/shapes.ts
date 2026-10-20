import type { Project, Pt, Stair } from '../model/types';
import { bbox, edges, moveVertex, normalizePolygon, polygonAreaMm2, validatePolygon, type Edge } from '../engine/geometry';

export type ShapeKind = 'rect' | 'L' | 'U' | 'custom';

export interface ShapeDims {
  /** along the house wall */
  w: number;
  /** away from the wall */
  d: number;
  /** notch (L: cut out of the far right corner; U: cut into the far edge) */
  nw: number;
  nd: number;
}

const r100 = (v: number): number => Math.max(600, Math.round(v / 100) * 100);

/** Outline for a guided shape. The house wall is the top edge (edge 0), y grows away from it. */
export function makeShape(kind: Exclude<ShapeKind, 'custom'>, dims: ShapeDims): Pt[] {
  const w = Math.max(1200, dims.w);
  const d = Math.max(1200, dims.d);
  if (kind === 'rect') return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
  const nw = Math.min(Math.max(600, dims.nw), w - 600);
  const nd = Math.min(Math.max(600, dims.nd), d - 600);
  if (kind === 'L') {
    return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d - nd }, { x: w - nw, y: d - nd }, { x: w - nw, y: d }, { x: 0, y: d }];
  }
  const nx = Math.round((w - nw) / 2 / 50) * 50;
  return [
    { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: nx + nw, y: d }, { x: nx + nw, y: d - nd }, { x: nx, y: d - nd }, { x: nx, y: d }, { x: 0, y: d },
  ];
}

export function detectShape(poly: Pt[]): ShapeKind {
  if (poly.length === 4) return 'rect';
  if (poly.length === 6) return 'L';
  if (poly.length === 8) {
    // a U has two concave corners on the same side; anything else is custom
    const bb = bbox(poly);
    const far = poly.filter((p) => Math.abs(p.y - bb.maxY) < 0.5 || Math.abs(p.y - bb.minY) < 0.5).length;
    if (far >= 6) return 'U';
  }
  return 'custom';
}

/** Dimensions to seed the next shape from the current outline. */
export function shapeDims(poly: Pt[]): ShapeDims {
  if (poly.length < 4) return { w: 4800, d: 3600, nw: 1800, nd: 1500 };
  const bb = bbox(poly);
  const w = r100(bb.width);
  const d = r100(bb.height);
  let nw = r100(w * 0.4);
  let nd = r100(d * 0.4);
  if (poly.length === 6) {
    // the notch is the part of the bounding box the outline does not cover
    const xs = [...new Set(poly.map((p) => Math.round(p.x)))].sort((a, b) => a - b);
    const ys = [...new Set(poly.map((p) => Math.round(p.y)))].sort((a, b) => a - b);
    if (xs.length === 3 && ys.length === 3) {
      nw = Math.min(xs[1] - xs[0], xs[2] - xs[1]);
      nd = Math.min(ys[1] - ys[0], ys[2] - ys[1]);
    }
  }
  return { w, d, nw: Math.min(nw, w - 600), nd: Math.min(nd, d - 600) };
}

/** Index of the edge that should carry the house wall: the top-most horizontal edge. */
export function topEdgeIndex(poly: Pt[]): number {
  const E = edges(poly);
  let best = -1;
  let bestY = Infinity;
  for (const e of E) {
    if (e.axis !== 'x') continue;
    if (e.a.y < bestY - 0.5 || (Math.abs(e.a.y - bestY) < 0.5 && best >= 0 && e.length > E[best].length)) {
      best = e.index;
      bestY = e.a.y;
    }
  }
  return best;
}

/** A wall polyline running along edge `index`, extended past both ends. */
export function housePolylineFor(poly: Pt[], index: number, overhang = 1500): Pt[] {
  const e = edges(poly)[index];
  if (!e) return [];
  return [
    { x: e.a.x - e.dir.x * overhang, y: e.a.y - e.dir.y * overhang },
    { x: e.b.x + e.dir.x * overhang, y: e.b.y + e.dir.y * overhang },
  ];
}

export function nextStairId(stairs: Stair[]): string {
  let n = 1;
  for (const s of stairs) {
    const m = /^S(\d+)$/.exec(s.id);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `S${n}`;
}

/** Put a stair on the middle of the longest open edge that has none yet (else the longest). */
export function addStairOnLongestEdge(p: Project): Project {
  if (p.deck.length < 4) return p;
  const E = edges(p.deck).filter((e) => !p.houseEdges.includes(e.index)).sort((a, b) => b.length - a.length);
  const used = new Set(p.stairs.map((s) => s.edgeIndex));
  const e = E.find((c) => !used.has(c.index)) ?? E[0];
  if (!e) return p;
  const width = Math.min(p.params.stairWidth, e.length);
  const offset = Math.max(0, Math.round((e.length - width) / 2 / 10) * 10);
  return { ...p, stairs: [...p.stairs, { id: nextStairId(p.stairs), edgeIndex: e.index, offset, width, groundOffset: 0 }] };
}

// ---------------------------------------------------------------------------
// Direct editing helpers: clamped moves, notches, mirroring
// ---------------------------------------------------------------------------

export const MIN_EDGE = 100;

/**
 * Clamp the new coordinate of edge `i` (its y when horizontal, x when vertical) so the
 * two edges joining it keep their direction and at least MIN_EDGE of length.
 */
export function clampEdgeValue(poly: Pt[], i: number, value: number): number {
  const n = poly.length;
  const A = poly[i];
  const B = poly[(i + 1) % n];
  const P = poly[(i - 1 + n) % n];
  const N = poly[(i + 2) % n];
  const horizontal = Math.abs(A.y - B.y) < 0.5;
  const cur = horizontal ? A.y : A.x;
  const pv = horizontal ? P.y : P.x;
  const nv = horizontal ? N.y : N.x;
  let v = value;
  v = cur > pv ? Math.max(v, pv + MIN_EDGE) : Math.min(v, pv - MIN_EDGE);
  v = cur > nv ? Math.max(v, nv + MIN_EDGE) : Math.min(v, nv - MIN_EDGE);
  return v;
}

/** A deck must stay at least this wide in both directions and keep some area. */
const MIN_EXTENT = 300;
function sane(poly: Pt[]): boolean {
  const bb = bbox(poly);
  return bb.width >= MIN_EXTENT && bb.height >= MIN_EXTENT && polygonAreaMm2(poly) >= MIN_EXTENT * MIN_EXTENT;
}

/** True when both outlines have the same corners within half a millimetre. */
export function samePoly(a: Pt[], b: Pt[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i].x - b[i].x) > 0.5 || Math.abs(a[i].y - b[i].y) > 0.5) return false;
  return true;
}

/** Move edge i to `value` along its normal axis, keeping the polygon orthogonal and valid. */
export function moveEdgeTo(poly: Pt[], i: number, value: number): Pt[] | null {
  const n = poly.length;
  const v = clampEdgeValue(poly, i, value);
  const out = poly.map((p) => ({ ...p }));
  const j = (i + 1) % n;
  if (Math.abs(poly[i].y - poly[j].y) < 0.5) {
    out[i].y = v;
    out[j].y = v;
  } else {
    out[i].x = v;
    out[j].x = v;
  }
  const norm = normalizePolygon(out);
  return norm.length === n && validatePolygon(norm).ok && sane(norm) ? out : null;
}

/**
 * Clamp a vertex move so the four edges it affects (its own two and the next ones
 * out) keep their direction and MIN_EDGE of length.
 */
export function clampVertex(poly: Pt[], i: number, v: Pt): Pt {
  const n = poly.length;
  const V = poly[i];
  const P = poly[(i - 1 + n) % n];
  const N = poly[(i + 1) % n];
  const PP = poly[(i - 2 + n) % n];
  const NN = poly[(i + 2) % n];
  let { x, y } = v;
  const keep = (cur: number, other: number, val: number): number => (cur > other ? Math.max(val, other + MIN_EDGE) : Math.min(val, other - MIN_EDGE));
  if (Math.abs(P.y - V.y) < 0.5) {
    // prev edge horizontal: x sets its length, y drags P (and PP's vertical edge)
    x = keep(V.x, P.x, x);
    y = keep(V.y, PP.y, y);
    y = keep(V.y, N.y, y);
    x = keep(V.x, NN.x, x);
  } else {
    y = keep(V.y, P.y, y);
    x = keep(V.x, PP.x, x);
    x = keep(V.x, N.x, x);
    y = keep(V.y, NN.y, y);
  }
  return { x, y };
}

/** Move vertex i (neighbours follow) with clamping; null when the result is not a valid outline. */
export function moveVertexTo(poly: Pt[], i: number, v: Pt): Pt[] | null {
  const n = poly.length;
  const out = moveVertex(poly, i, clampVertex(poly, i, v));
  const norm = normalizePolygon(out);
  return norm.length === n && validatePolygon(norm).ok && sane(norm) ? out : null;
}

/**
 * Set the length of edge i. The end vertex moves, unless the end sits on the house and the
 * start does not: then the start moves, so the deck never slides off its wall.
 */
export function setEdgeLengthAnchored(poly: Pt[], i: number, length: number, houseEdges: number[]): Pt[] | null {
  const n = poly.length;
  const E = edges(poly);
  const e = E[i];
  if (!e || length < MIN_EDGE) return null;
  const endOnHouse = houseEdges.includes((i + 1) % n);
  const startOnHouse = houseEdges.includes((i - 1 + n) % n);
  const moveStart = () => moveVertex(poly, i, { x: e.b.x - e.dir.x * length, y: e.b.y - e.dir.y * length });
  const moveEnd = () => moveVertex(poly, (i + 1) % n, { x: e.a.x + e.dir.x * length, y: e.a.y + e.dir.y * length });
  const valid = (out: Pt[]) => {
    const norm = normalizePolygon(out);
    return norm.length === n && validatePolygon(norm).ok && sane(norm);
  };
  // a wall end never moves; otherwise the far end first, and when that outline folds over itself
  // the other end gives the same length
  const attempts = endOnHouse && !startOnHouse ? [moveStart] : startOnHouse && !endOnHouse ? [moveEnd] : [moveEnd, moveStart];
  for (const make of attempts) {
    const out = make();
    if (valid(out)) return out;
  }
  return null;
}

/** Edge-indexed data after an outline change: unchanged with the same corners (edges only translate), remapped by geometry otherwise. */
export function carryEdgeData(p: Project, deck: Pt[]): Partial<Pick<Project, 'houseEdges' | 'stairs' | 'params'>> {
  return deck.length === p.deck.length ? {} : remapEdgeData(p, deck);
}

/** Apply a moved outline: a house wall drawn on any of the given edges moves with its edge when that edge only translated. */
export function applyDeckMove(p: Project, next: Pt[], edgeIndices: number[]): Project {
  let house = p.house;
  const before = edges(p.deck);
  const after = edges(next);
  for (const index of edgeIndices) {
    if (!p.houseEdges.includes(index)) continue;
    const b = before[index];
    const a = after[index];
    if (!b || !a || b.axis !== a.axis) continue;
    const oldC = b.axis === 'x' ? b.a.y : b.a.x;
    const newC = a.axis === 'x' ? a.a.y : a.a.x;
    house = shiftHouseLine(house, b.axis, oldC, newC - oldC);
  }
  return { ...p, deck: next, house };
}

/** Shift the points of house polylines that lie on a moved deck edge, so the wall follows the edge. */
export function shiftHouseLine(house: Pt[][], axis: 'x' | 'y', oldCoord: number, delta: number): Pt[][] {
  if (Math.abs(delta) < 0.5) return house;
  return house.map((pl) =>
    pl.map((q) => {
      const c = axis === 'x' ? q.y : q.x;
      if (Math.abs(c - oldCoord) > 25) return q;
      return axis === 'x' ? { x: q.x, y: q.y + delta } : { x: q.x + delta, y: q.y };
    }),
  );
}

/**
 * Carry edge-indexed data (house flags, stairs, balustrade overrides) across an outline change by
 * geometry: an old edge maps to every new edge lying on the same line that overlaps it.
 */
export function remapEdgeData(p: Project, deck: Pt[]): Pick<Project, 'houseEdges' | 'stairs' | 'params'> {
  const oldE = edges(p.deck);
  const newE = edges(deck);
  const span = (e: Edge): [number, number] => (e.axis === 'x' ? [Math.min(e.a.x, e.b.x), Math.max(e.a.x, e.b.x)] : [Math.min(e.a.y, e.b.y), Math.max(e.a.y, e.b.y)]);
  const line = (e: Edge): number => (e.axis === 'x' ? e.a.y : e.a.x);
  const overlapping = (o: Edge): Edge[] => {
    if (!o) return [];
    const [lo, hi] = span(o);
    return newE.filter((e) => e.axis === o.axis && Math.abs(line(e) - line(o)) < 0.5 && Math.min(hi, span(e)[1]) - Math.max(lo, span(e)[0]) > 1);
  };
  const houseEdges = [...new Set(p.houseEdges.flatMap((i) => overlapping(oldE[i]).map((e) => e.index)))].sort((a, b) => a - b);
  const stairs: Stair[] = [];
  for (const s of p.stairs) {
    const o = oldE[s.edgeIndex];
    if (!o) continue;
    const c0 = o.axis === 'x' ? o.a.x + o.dir.x * s.offset : o.a.y + o.dir.y * s.offset;
    const c1 = o.axis === 'x' ? o.a.x + o.dir.x * (s.offset + s.width) : o.a.y + o.dir.y * (s.offset + s.width);
    const lo = Math.min(c0, c1);
    const hi = Math.max(c0, c1);
    const host = overlapping(o).find((e) => span(e)[0] <= lo + 0.5 && span(e)[1] >= hi - 0.5);
    if (!host || houseEdges.includes(host.index)) continue;
    const start = host.axis === 'x' ? host.a.x : host.a.y;
    const dir = host.axis === 'x' ? host.dir.x : host.dir.y;
    stairs.push({ ...s, edgeIndex: host.index, offset: Math.max(0, dir > 0 ? lo - start : start - hi) });
  }
  const edgeOverride: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(p.params.balustrade.edgeOverride)) {
    for (const e of overlapping(oldE[Number(k)])) edgeOverride[String(e.index)] = v;
  }
  return { houseEdges, stairs, params: { ...p.params, balustrade: { ...p.params.balustrade, edgeOverride } } };
}

/**
 * Cut a notch into edge `i` (inward) or add a bump-out (outward), centred on the edge.
 * Returns the new outline, or null when the edge is too short or the result is invalid.
 */
export function insertNotch(poly: Pt[], i: number, width: number, depth: number, outward: boolean): Pt[] | null {
  const E = edges(poly);
  const e = E[i];
  if (!e || e.length < width + 2 * MIN_EDGE) return null;
  const t0 = Math.round((e.length - width) / 2 / 50) * 50;
  const d = e.dir;
  const m = outward ? e.outward : { x: -e.outward.x, y: -e.outward.y };
  const P1 = { x: e.a.x + d.x * t0, y: e.a.y + d.y * t0 };
  const P2 = { x: P1.x + m.x * depth, y: P1.y + m.y * depth };
  const P4 = { x: P1.x + d.x * width, y: P1.y + d.y * width };
  const P3 = { x: P4.x + m.x * depth, y: P4.y + m.y * depth };
  const out = [...poly.slice(0, i + 1), P1, P2, P3, P4, ...poly.slice(i + 1)];
  const norm = normalizePolygon(out);
  return norm.length === poly.length + 4 && validatePolygon(norm).ok ? norm : null;
}

/** Remove the jog (notch or bump-out) whose bottom is edge i, joining the two outer edges into one. */
export function removeJog(poly: Pt[], i: number): Pt[] | null {
  const n = poly.length;
  if (n < 8) return null;
  const E = edges(poly);
  const e = E[i];
  const prev = E[(i - 1 + n) % n];
  const next = E[(i + 1) % n];
  const before = E[(i - 2 + n) % n];
  const after = E[(i + 2) % n];
  if (!e || prev.axis !== next.axis || before.axis !== e.axis || after.axis !== e.axis) return null;
  if (Math.abs(prev.length - next.length) > 0.5) return null;
  const collinear = e.axis === 'x' ? Math.abs(before.a.y - after.a.y) < 0.5 : Math.abs(before.a.x - after.a.x) < 0.5;
  if (!collinear) return null;
  // the two shoulders must lie between the outer ends, which rules out reading the deck body as a jog of its bump-out
  const merged = Math.hypot(after.b.x - before.a.x, after.b.y - before.a.y);
  if (Math.abs(merged - (before.length + e.length + after.length)) > 1) return null;
  const drop = new Set([(i - 1 + n) % n, i, (i + 1) % n, (i + 2) % n]);
  const out = normalizePolygon(poly.filter((_, k) => !drop.has(k)));
  if (out.length < 4 || !validatePolygon(out).ok) return null;
  // only the jog's own area may change, which rules out reading the body of the deck as a jog of its notch
  const jogArea = e.length * prev.length;
  if (Math.abs(Math.abs(polygonAreaMm2(out) - polygonAreaMm2(poly)) - jogArea) > jogArea * 0.01 + 1) return null;
  return out;
}

/** True when edge i is the bottom of a jog that removeJog can flatten. */
export function isJogEdge(poly: Pt[], i: number): boolean {
  return removeJog(poly, i) !== null;
}

/** Mirror the whole project left to right; edge indices stay valid, stairs keep their edge. */
export function mirrorProject(p: Project): Project {
  if (p.deck.length < 3) return p;
  const bb = bbox(p.deck);
  const mx = (x: number) => bb.minX + bb.maxX - x;
  const deck = p.deck.map((q) => ({ x: mx(q.x), y: q.y }));
  const E = edges(p.deck);
  // a left-right mirror reverses the direction of horizontal edges only
  const stairs = p.stairs.map((s) => {
    const e = E[s.edgeIndex];
    return e && e.axis === 'x' ? { ...s, offset: Math.max(0, e.length - s.offset - s.width) } : s;
  });
  const house = p.house.map((pl) => pl.map((q) => ({ x: mx(q.x), y: q.y })));
  return { ...p, deck, stairs, house };
}
