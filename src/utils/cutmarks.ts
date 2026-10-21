import type { DesignResult } from '../engine';
import type { BearerRun, JoistRun, LayoutResult } from '../engine/layout';
import { PRODUCT_MAP } from '../model/catalog';
import type { RuleSet } from '../model/types';

/*
 * Piece marks tie the drawings to the cutting: every length of framing timber that is cut gets a letter, the
 * framing plan puts the letter on the members, and the cutting diagram shows which stick each letter comes from.
 */

/** one length of one product as it is cut (the cut list's length, end allowance included) */
export interface CutMark {
  mark: string;
  productId: string;
  /** length as cut from the stock (with the end allowance), the cut list's key */
  cut: number;
  /** finished length on the deck */
  length: number;
  /** what the pieces are for: joist, bearer, post ... */
  tags: string[];
  count: number;
}

const FRAME_TAGS = new Set(['joist', 'bearer', 'wallBearer']);
const BOARD_TAGS = new Set(['decking', 'breaker', 'edgeBoard', 'fascia']);

/**
 * The finished length of a cut: framing and boards are cut with an end allowance that is trimmed off square;
 * joists hung flush are cut to the clear span between the bearers, with none.
 */
export function finishedLength(cut: number, tags: string[], rules: RuleSet, flush = false): number {
  if (tags.some((t) => FRAME_TAGS.has(t) && !(flush && t === 'joist'))) return cut - rules.joistEndAllowance;
  if (tags.some((t) => BOARD_TAGS.has(t))) return cut - rules.boardEndAllowance;
  return cut;
}

/** lengths within this of each other (mm) are cut the same: the extra comes off with the end trim */
const SAME_CUT = 5;

const letter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

export interface CutMarks {
  marks: CutMark[];
  of: (productId: string, cutLength: number) => CutMark | undefined;
}

/** Letters for every cut of framing timber and posts: joists first, then bearers, the rest after; longest first. */
export function cutMarks(design: DesignResult, rules: RuleSet, flush = false): CutMarks {
  const f = design.frame;
  const lists = design.bom.cutlists.filter((c) => {
    const cat = PRODUCT_MAP[c.productId]?.category;
    return cat === 'framing' || cat === 'post';
  });
  const rank = (id: string) => (id === f.joistProductId ? 0 : id === f.bearerProductId ? 1 : PRODUCT_MAP[id]?.category === 'post' ? 3 : 2);
  lists.sort((a, b) => rank(a.productId) - rank(b.productId) || a.productId.localeCompare(b.productId));
  const marks: CutMark[] = [];
  const index = new Map<string, CutMark>();
  for (const c of lists) {
    const count = new Map<number, number>();
    for (const g of c.groups) for (const cut of g.cuts) count.set(cut, (count.get(cut) ?? 0) + g.count);
    const uses = new Map(c.uses.map((u) => [u.length, u.tags]));
    const cuts = [...count.keys()].map((cut) => ({ cut, tags: uses.get(cut) ?? [] }));
    cuts.sort((a, b) => finishedLength(b.cut, b.tags, rules, flush) - finishedLength(a.cut, a.tags, rules, flush));
    let prev: CutMark | null = null;
    for (const { cut, tags } of cuts) {
      const length = Math.round(finishedLength(cut, tags, rules, flush));
      const n = count.get(cut) ?? 0;
      // lengths a few mm apart for the same use are one cut on site: one letter, cut to the longer
      if (prev && prev.length - length <= SAME_CUT && markUse(prev) === markUse({ tags } as CutMark)) {
        prev.count += n;
        prev.tags = [...new Set([...prev.tags, ...tags])];
        index.set(`${c.productId}|${cut}`, prev);
        continue;
      }
      const m: CutMark = { mark: letter(marks.length), productId: c.productId, cut, length, tags, count: n };
      marks.push(m);
      index.set(`${c.productId}|${cut}`, m);
      prev = m;
    }
  }
  return { marks, of: (productId, cutLength) => index.get(`${productId}|${Math.ceil(cutLength)}`) };
}

/** a member's piece between two joins (or a join and an end), along the member, with its mark */
export interface MemberPiece {
  from: number;
  to: number;
  mark?: CutMark;
  /** where its label goes along the member: clear of the bearers (joists) or the stumps (bearers) */
  labelAt: number;
}

const along = (horizontal: boolean, p: { x: number; y: number }) => (horizontal ? p.x : p.y);

/** the label spot for a piece: the middle of the gap between supports nearest the piece's middle */
function labelSpot(from: number, to: number, supports: number[]): number {
  const mid = (from + to) / 2;
  const pts = [from, ...supports.filter((s) => s > from + 1 && s < to - 1).sort((a, b) => a - b), to];
  let best = mid;
  let bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = (pts[i] + pts[i + 1]) / 2;
    const d = Math.abs(c - mid) - (pts[i + 1] - pts[i]) * 0.01;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function piecesOf(seg: { a: { x: number; y: number }; b: { x: number; y: number } }, cuts: number[], splices: number[], productId: string, marks: CutMarks, supports: number[]): MemberPiece[] {
  const horizontal = Math.abs(seg.a.y - seg.b.y) < 0.5;
  const a = along(horizontal, seg.a);
  const b = along(horizontal, seg.b);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const pts = [lo, ...[...splices].sort((p, q) => p - q), hi];
  // pieces are listed from the member's start; a member drawn from its far end is listed backwards
  const ordered = a <= b ? cuts : [...cuts].reverse();
  const out: MemberPiece[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    out.push({ from: pts[i], to: pts[i + 1], mark: ordered[i] !== undefined ? marks.of(productId, ordered[i]) : undefined, labelAt: labelSpot(pts[i], pts[i + 1], supports) });
  }
  return out;
}

/** the joist's pieces, with their marks and label spots between the bearers */
export function joistPieces(j: JoistRun, lay: LayoutResult, productId: string, marks: CutMarks): MemberPiece[] {
  return piecesOf(j.seg, j.pieces, j.splices, productId, marks, lay.supports.map((s) => s.pos));
}

/** the pieces of each ply of a bearer (the second ply is cut from the other end), label spots between stumps */
export function bearerPieces(b: BearerRun, productId: string, marks: CutMarks): MemberPiece[][] {
  const horizontal = Math.abs(b.seg.a.y - b.seg.b.y) < 0.5;
  const stumps = b.posts.map((p) => along(horizontal, p));
  return b.pieces.map((ply, k) => {
    // the first ply is listed from the bearer's start, the second from its end
    const fromStart = k === 0 ? ply : [...ply].reverse();
    return piecesOf(b.seg, fromStart, b.splices[k] ?? [], productId, marks, stumps);
  });
}

/** joists side by side with the same ends and the same pieces: annotated once, as a typical joist */
export interface JoistGroup {
  joists: JoistRun[];
  /** joists run along x (horizontal on the plan) */
  horizontal: boolean;
  /** across the joists: first and last joist positions */
  c0: number;
  c1: number;
  pieces: MemberPiece[];
}

export function joistGroups(lay: LayoutResult, productId: string, marks: CutMarks): JoistGroup[] {
  const items = lay.joists.map((j) => {
    const horizontal = Math.abs(j.seg.a.y - j.seg.b.y) < 0.5;
    const pieces = joistPieces(j, lay, productId, marks);
    const across = horizontal ? j.seg.a.y : j.seg.a.x;
    const key = `${horizontal}|${Math.round(pieces[0]?.from ?? 0)}|${Math.round(pieces[pieces.length - 1]?.to ?? 0)}|${pieces.map((p) => `${p.mark?.mark ?? '?'}@${Math.round(p.from)}`).join(',')}`;
    return { j, horizontal, pieces, across, key };
  });
  items.sort((a, b) => Number(a.horizontal) - Number(b.horizontal) || a.across - b.across);
  const groups: JoistGroup[] = [];
  let cur: { key: string; g: JoistGroup } | null = null;
  for (const it of items) {
    if (cur && cur.key === it.key) {
      cur.g.joists.push(it.j);
      cur.g.c1 = it.across;
      continue;
    }
    cur = { key: it.key, g: { joists: [it.j], horizontal: it.horizontal, c0: it.across, c1: it.across, pieces: it.pieces } };
    groups.push(cur.g);
  }
  return groups;
}

/** the use of a mark in words (the first tag that names a member) */
export function markUse(m: CutMark): string {
  const order = ['joist', 'bearer', 'wallBearer', 'post', 'brace', 'stringer', 'rail', 'handrail', 'stairKicker', 'joinBlock', 'balustradePost', 'handrailPost', 'slat'];
  return order.find((t) => m.tags.includes(t)) ?? m.tags[0] ?? '';
}
