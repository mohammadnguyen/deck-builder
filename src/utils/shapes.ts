import type { Project, Pt, Stair } from '../model/types';
import { bbox, edges } from '../engine/geometry';

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
