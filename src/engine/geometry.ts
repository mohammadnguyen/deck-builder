import type { Axis, Pt } from '../model/types';

export interface Edge {
  index: number;
  a: Pt;
  b: Pt;
  axis: Axis;
  length: number;
  /** unit outward normal (axis aligned) */
  outward: Pt;
  /** unit direction a -> b */
  dir: Pt;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

const EPS = 0.5;

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function edgeAxis(a: Pt, b: Pt): Axis | null {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (dy < EPS && dx >= EPS) return 'x';
  if (dx < EPS && dy >= EPS) return 'y';
  return null;
}

/** Remove duplicate points and merge collinear consecutive edges. */
export function normalizePolygon(poly: Pt[]): Pt[] {
  let pts = poly.filter((p, i) => i === 0 || dist(p, poly[i - 1]) > EPS);
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < EPS) pts = pts.slice(0, -1);
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const a1 = edgeAxis(prev, cur);
      const a2 = edgeAxis(cur, next);
      if ((a1 && a2 && a1 === a2) || dist(prev, cur) < EPS) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export function isOrthogonal(poly: Pt[]): boolean {
  if (poly.length < 4) return false;
  for (let i = 0; i < poly.length; i++) {
    if (!edgeAxis(poly[i], poly[(i + 1) % poly.length])) return false;
  }
  return true;
}

/** Signed area in mm² (positive when vertices are clockwise on a y-down screen). */
export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonAreaMm2(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}

export function perimeter(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

export function bbox(poly: Pt[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!poly.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersect = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function edges(poly: Pt[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const axis = edgeAxis(a, b) ?? 'x';
    const length = dist(a, b);
    const dir = { x: (b.x - a.x) / (length || 1), y: (b.y - a.y) / (length || 1) };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // candidate normal: rotate dir by 90 degrees, then test which side is inside
    let n = { x: -dir.y, y: dir.x };
    const probe = { x: mid.x + n.x * 2, y: mid.y + n.y * 2 };
    if (pointInPolygon(probe, poly)) n = { x: -n.x, y: -n.y };
    out.push({ index: i, a, b, axis, length, outward: { x: Math.round(n.x) || 0, y: Math.round(n.y) || 0 }, dir });
  }
  return out;
}

/** Merge overlapping/touching intervals. */
export function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = [...list].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

function clipHorizontalExact(poly: Pt[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.abs(a.x - b.x) < EPS) {
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      if (y > y0 && y < y1) xs.push(a.x);
    }
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Interior intervals of the horizontal line y = const. Robust to lines through vertices. */
export function clipHorizontal(poly: Pt[], y: number): [number, number][] {
  return mergeIntervals([...clipHorizontalExact(poly, y - 0.25), ...clipHorizontalExact(poly, y + 0.25)]);
}

export function swapPt(p: Pt): Pt {
  return { x: p.y, y: p.x };
}

export function swapPoly(poly: Pt[]): Pt[] {
  return poly.map(swapPt);
}

/** Interior intervals of the vertical line x = const. */
export function clipVertical(poly: Pt[], x: number): [number, number][] {
  return clipHorizontal(swapPoly(poly), x);
}

function axisSegsIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const ax0 = Math.min(a1.x, a2.x) - EPS;
  const ax1 = Math.max(a1.x, a2.x) + EPS;
  const ay0 = Math.min(a1.y, a2.y) - EPS;
  const ay1 = Math.max(a1.y, a2.y) + EPS;
  const bx0 = Math.min(b1.x, b2.x) - EPS;
  const bx1 = Math.max(b1.x, b2.x) + EPS;
  const by0 = Math.min(b1.y, b2.y) - EPS;
  const by1 = Math.max(b1.y, b2.y) + EPS;
  return ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1;
}

export type PolygonProblem = 'tooFew' | 'notOrthogonal' | 'selfIntersect' | 'zeroArea';

export function validatePolygon(poly: Pt[]): { ok: boolean; problem?: PolygonProblem } {
  if (poly.length < 4) return { ok: false, problem: 'tooFew' };
  if (!isOrthogonal(poly)) return { ok: false, problem: 'notOrthogonal' };
  if (polygonAreaMm2(poly) < 1) return { ok: false, problem: 'zeroArea' };
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (axisSegsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) {
        return { ok: false, problem: 'selfIntersect' };
      }
    }
  }
  return { ok: true };
}

/** Project p onto the edge: returns distance along the edge from a (clamped) and perpendicular distance. */
export function projectOnEdge(e: Edge, p: Pt): { t: number; d: number } {
  const vx = p.x - e.a.x;
  const vy = p.y - e.a.y;
  const t = Math.max(0, Math.min(e.length, vx * e.dir.x + vy * e.dir.y));
  const px = e.a.x + e.dir.x * t;
  const py = e.a.y + e.dir.y * t;
  return { t, d: Math.hypot(p.x - px, p.y - py) };
}

export function edgePoint(e: Edge, t: number): Pt {
  return { x: e.a.x + e.dir.x * t, y: e.a.y + e.dir.y * t };
}

/** Move vertex i and drag its two neighbours so the polygon stays orthogonal. */
export function moveVertex(poly: Pt[], i: number, v: Pt): Pt[] {
  const n = poly.length;
  const out = poly.map((p) => ({ ...p }));
  const old = poly[i];
  const pi = (i - 1 + n) % n;
  const ni = (i + 1) % n;
  out[i] = { ...v };
  if (Math.abs(poly[pi].y - old.y) < 0.5) out[pi].y = v.y;
  else out[pi].x = v.x;
  if (Math.abs(poly[ni].y - old.y) < 0.5) out[ni].y = v.y;
  else out[ni].x = v.x;
  return out;
}

/** Set the length of edge `index` by moving its end vertex along the edge direction. */
export function setEdgeLength(poly: Pt[], index: number, length: number): Pt[] {
  const E = edges(poly);
  const e = E[index];
  if (!e || length < 100) return poly;
  const b = { x: e.a.x + e.dir.x * length, y: e.a.y + e.dir.y * length };
  return moveVertex(poly, (index + 1) % poly.length, b);
}

export function round(v: number, step = 1): number {
  return Math.round(v / step) * step;
}

/**
 * Detect deck edges that lie on a house wall polyline (collinear and overlapping).
 */
export function detectHouseEdges(deck: Pt[], house: Pt[][], tolerance = 25): number[] {
  const out: number[] = [];
  const deckEdges = edges(deck);
  for (const e of deckEdges) {
    let touches = false;
    for (const pl of house) {
      for (let i = 0; i + 1 < pl.length && !touches; i++) {
        const a = pl[i];
        const b = pl[i + 1];
        const hAxis = edgeAxis(a, b);
        if (!hAxis || hAxis !== e.axis) continue;
        if (hAxis === 'x') {
          if (Math.abs(a.y - e.a.y) > tolerance) continue;
          const lo = Math.min(a.x, b.x);
          const hi = Math.max(a.x, b.x);
          const elo = Math.min(e.a.x, e.b.x);
          const ehi = Math.max(e.a.x, e.b.x);
          if (Math.min(hi, ehi) - Math.max(lo, elo) > Math.min(200, e.length * 0.5)) touches = true;
        } else {
          if (Math.abs(a.x - e.a.x) > tolerance) continue;
          const lo = Math.min(a.y, b.y);
          const hi = Math.max(a.y, b.y);
          const elo = Math.min(e.a.y, e.b.y);
          const ehi = Math.max(e.a.y, e.b.y);
          if (Math.min(hi, ehi) - Math.max(lo, elo) > Math.min(200, e.length * 0.5)) touches = true;
        }
      }
    }
    if (touches) out.push(e.index);
  }
  return out;
}
