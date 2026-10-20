import type { BalustradeParams, Pt, Stair } from '../model/types';
import type { Edge } from './geometry';
import { dist, edgePoint } from './geometry';

export interface BalSegment {
  edgeIndex: number;
  t0: number;
  t1: number;
  length: number;
  posts: Pt[];
}

export interface BalustradeDesign {
  enabled: boolean;
  edges: number[];
  segments: BalSegment[];
  posts: Pt[];
  totalLength: number;
  railPieces: number[];
  railCount: number;
  slatCount: number;
  slatLength: number;
  wireLength: number;
  wireKits: number;
  postLength: number;
}

export function designBalustrade(
  edgesList: Edge[],
  houseEdges: number[],
  stairs: Stair[],
  params: BalustradeParams,
  deckHeight: number,
  triggerHeight: number,
  boardThickness: number,
  joistDepth: number,
  railMaxStock: number,
  postWidth: number,
): BalustradeDesign {
  const empty: BalustradeDesign = {
    enabled: false, edges: [], segments: [], posts: [], totalLength: 0, railPieces: [], railCount: 2,
    slatCount: 0, slatLength: 0, wireLength: 0, wireKits: 0, postLength: 0,
  };
  const autoOn = deckHeight >= triggerHeight;
  const edgeOn = (i: number): boolean => {
    const ov = params.edgeOverride[String(i)];
    if (params.mode === 'off') return ov === true;
    if (params.mode === 'on') return ov !== false && !houseEdges.includes(i);
    if (ov !== undefined) return ov;
    return autoOn && !houseEdges.includes(i);
  };
  const activeEdges = edgesList.filter((e) => edgeOn(e.index)).map((e) => e.index);
  if (!activeEdges.length) return empty;

  const segments: BalSegment[] = [];
  for (const idx of activeEdges) {
    const e = edgesList[idx];
    const openings = stairs
      .filter((s) => s.edgeIndex === idx)
      .map((s) => [Math.max(0, s.offset), Math.min(e.length, s.offset + s.width)] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    let cursor = 0;
    const spans: [number, number][] = [];
    for (const [o0, o1] of openings) {
      if (o0 - cursor > 150) spans.push([cursor, o0]);
      cursor = Math.max(cursor, o1);
    }
    if (e.length - cursor > 150) spans.push([cursor, e.length]);
    for (const [t0, t1] of spans) {
      const len = t1 - t0;
      const n = Math.max(1, Math.ceil(len / params.postSpacing));
      const posts: Pt[] = [];
      for (let k = 0; k <= n; k++) posts.push(edgePoint(e, t0 + (len * k) / n));
      segments.push({ edgeIndex: idx, t0, t1, length: len, posts });
    }
  }
  const posts: Pt[] = [];
  for (const s of segments) {
    for (const p of s.posts) {
      if (!posts.some((q) => dist(p, q) < 60)) posts.push(p);
    }
  }
  const totalLength = segments.reduce((s, x) => s + x.length, 0);
  const railPieces: number[] = [];
  for (const s of segments) {
    let remaining = s.length + 20;
    while (remaining > railMaxStock) {
      railPieces.push(railMaxStock);
      remaining -= railMaxStock;
    }
    railPieces.push(remaining);
  }
  const railCount = 2;
  const allRails = railPieces.flatMap((p) => [p, p]);
  let slatCount = 0;
  let slatLength = 0;
  let wireLength = 0;
  let wireKits = 0;
  if (params.infill === 'slats') {
    slatLength = Math.max(300, params.height - 150);
    for (const s of segments) {
      const bays = s.posts.length - 1;
      const bayLen = (s.length - postWidth * s.posts.length) / Math.max(1, bays);
      slatCount += bays * Math.max(0, Math.floor((bayLen - params.slatGap) / (params.slatWidth + params.slatGap)));
    }
  } else if (params.infill === 'wire') {
    for (const s of segments) {
      wireLength += params.wireRuns * (s.length + 300);
      wireKits += params.wireRuns;
    }
  }
  return {
    enabled: true,
    edges: activeEdges,
    segments,
    posts,
    totalLength,
    railPieces: allRails,
    railCount,
    slatCount,
    slatLength,
    wireLength,
    wireKits,
    postLength: params.height + boardThickness + joistDepth,
  };
}
