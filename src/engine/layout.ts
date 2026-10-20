import type { Axis, DeckParams, Pt, RuleSet, Seg } from '../model/types';
import { bbox, clipHorizontal, clipVertical, edges, swapPoly, swapPt, type Edge } from './geometry';
import { splitRun } from './cutlist';
import type { WarningItem } from './warnings';

/** Decks at or above this height are designed for balcony loads (reduced spans). */
export const ELEVATED_HEIGHT = 1000;

export interface BearerRun {
  id: string;
  lineIndex: number;
  /** bearer anchored to the house wall instead of sitting on posts */
  onWall: boolean;
  seg: Seg;
  length: number;
  posts: Pt[];
  /** piece lengths per lamination */
  pieces: number[][];
  /** absolute splice positions per lamination, along the bearer axis */
  splices: number[][];
  flw: number;
  maxSpan: number;
  postSpacing: number;
  houseStart: boolean;
  houseEnd: boolean;
}

export interface SupportLine {
  pos: number;
  kind: 'edge' | 'house' | 'inter' | 'wall';
  edgeIndex?: number;
}

export interface JoistRun {
  id: string;
  pos: number;
  seg: Seg;
  length: number;
  pieces: number[];
  splices: number[];
  bearerCrossings: number;
  hangers: number;
  isEdge: boolean;
}

export interface BoardRun {
  seg: Seg;
  length: number;
  pieces: number[];
  joins: number[];
  crossings: number;
  screws: number;
}

export interface BoardRow {
  index: number;
  pos: number;
  width: number;
  ripped: boolean;
  runs: BoardRun[];
}

export interface PostInfo {
  id: string;
  pt: Pt;
  bearerId: string;
}

/** a bearer run fixed to the house wall (Dynabolts into masonry or bolts into a timber frame) */
export interface Ledger {
  edgeIndex: number;
  seg: Seg;
  length: number;
  bolts: number;
  hangers: number;
}

export interface LayoutResult {
  swapped: boolean;
  boardAxis: Axis;
  /** axis along which support positions are measured (perpendicular to bearers) */
  supportAxis: Axis;
  supports: SupportLine[];
  bearers: BearerRun[];
  posts: PostInfo[];
  joists: JoistRun[];
  boards: BoardRow[];
  ledgers: Ledger[];
  attachment: 'freestanding' | 'wall';
  maxJoistSpan: number;
  joistSpanUsed: number;
  maxBearerSpanUsed: number;
  warnings: WarningItem[];
  totals: {
    bearerLm: number;
    joistLm: number;
    boardLm: number;
    boardRows: number;
    boardJoins: number;
    screws: number;
    joistBearerCrossings: number;
    hangers: number;
    ledgerBolts: number;
  };
}

export interface LayoutContext {
  boardWidth: number;
  boardGap: number;
  joistThickness: number;
  /** total bearer width across laminations */
  bearerWidth: number;
  /** joists hung flush between bearers (joist supports) instead of sitting on top */
  flush: boolean;
  deckingMaxStock: number;
  joistMaxStock: number;
  bearerMaxStock: number;
}

export function joistMaxSpan(rules: RuleSet, joistId: string, spacing: number): { span: number; extrapolated: boolean } {
  const table = rules.joistSpan[joistId];
  if (!table) return { span: 0, extrapolated: true };
  const keys = Object.keys(table).map(Number).sort((p, q) => p - q);
  if (table[String(spacing)] !== undefined) return { span: table[String(spacing)], extrapolated: false };
  const larger = keys.find((k) => k >= spacing);
  if (larger !== undefined) return { span: table[String(larger)], extrapolated: false };
  const last = keys[keys.length - 1];
  return { span: Math.floor((table[String(last)] * last) / spacing / 50) * 50, extrapolated: true };
}

export function bearerMaxSpan(rules: RuleSet, bearerId: string, lam: number, flw: number): { span: number; extrapolated: boolean } {
  const table = rules.bearerSpan[`${bearerId}|${lam}`];
  if (!table || !table.length) return { span: 0, extrapolated: true };
  const sorted = [...table].sort((p, q) => p.flw - q.flw);
  const hit = sorted.find((e) => e.flw >= flw);
  if (hit) return { span: hit.span, extrapolated: false };
  const last = sorted[sorted.length - 1];
  return { span: Math.floor((last.span * last.flw) / flw / 50) * 50, extrapolated: true };
}

export function resolveBoardAxis(poly: Pt[], houseEdges: number[], pref: 'auto' | Axis): Axis {
  if (pref !== 'auto') return pref;
  const E = edges(poly);
  const h = houseEdges.map((i) => E[i]).filter(Boolean);
  if (h.length) return h[0].axis;
  const bb = bbox(poly);
  return bb.width >= bb.height ? 'x' : 'y';
}

function swapSeg(s: Seg): Seg {
  return { a: swapPt(s.a), b: swapPt(s.b) };
}

export function computeLayout(
  polyIn: Pt[],
  houseEdges: number[],
  params: DeckParams,
  rules: RuleSet,
  ctx: LayoutContext,
): LayoutResult {
  const warnings: WarningItem[] = [];
  const boardAxis = resolveBoardAxis(polyIn, houseEdges, params.boardAxis);
  const swapped = boardAxis === 'y';
  const poly = swapped ? swapPoly(polyIn) : polyIn;
  const E: Edge[] = edges(poly);
  const bb = bbox(poly);
  const elevated = params.deckHeight >= ELEVATED_HEIGHT;
  const factor = elevated ? rules.elevatedFactor : 1;

  const js = joistMaxSpan(rules, params.joistProductId, params.joistSpacing);
  if (js.extrapolated) warnings.push({ severity: 'warn', key: 'layout.joistSpanExtrapolated' });
  const maxJoistSpan = Math.max(300, Math.floor((js.span * factor) / 10) * 10);

  const houseX = houseEdges.filter((i) => E[i] && E[i].axis === 'x');
  const houseY = houseEdges.filter((i) => E[i] && E[i].axis === 'y');
  let attachment: 'freestanding' | 'wall' = params.attachment === 'wall' ? 'wall' : 'freestanding';
  if (attachment === 'wall' && !houseX.length) {
    attachment = 'freestanding';
    if (houseEdges.length) warnings.push({ severity: 'warn', key: 'layout.wallBearerNotPossible' });
  }

  // ---- support lines (bearer centrelines and ledgers), measured along y ----
  let lines: SupportLine[] = [];
  const ledgers: Ledger[] = [];
  for (const e of E) {
    if (e.axis !== 'x') continue;
    const isHouse = houseEdges.includes(e.index);
    if (isHouse && attachment === 'wall') {
      // bearer hard against the wall face; its centreline sits half a bearer width in
      lines.push({ pos: e.a.y - e.outward.y * (ctx.bearerWidth / 2), kind: 'wall', edgeIndex: e.index });
      continue;
    }
    // Flush framing puts the perimeter bearer at the deck edge (joists cannot cantilever
    // past a bearer they hang from); on-top framing insets it so the joists overhang.
    const inset = isHouse
      ? ctx.flush ? rules.flushHouseInset : rules.houseBearerInset
      : ctx.flush ? Math.max(ctx.bearerWidth / 2, 45) : rules.bearerEdgeInset;
    lines.push({ pos: e.a.y - e.outward.y * inset, kind: isHouse ? 'house' : 'edge', edgeIndex: e.index });
  }
  lines.sort((p, q) => p.pos - q.pos);
  const mergedLines: SupportLine[] = [];
  for (const l of lines) {
    const last = mergedLines[mergedLines.length - 1];
    if (last && last.kind !== 'wall' && l.kind !== 'wall' && l.pos - last.pos < rules.minBearerGap) {
      last.pos = (last.pos + l.pos) / 2;
      if (l.kind === 'house') last.kind = 'house';
      continue;
    }
    if (last && Math.abs(l.pos - last.pos) < 1) continue;
    mergedLines.push({ ...l });
  }
  lines = [];
  for (let i = 0; i < mergedLines.length; i++) {
    lines.push(mergedLines[i]);
    if (i + 1 < mergedLines.length) {
      const gap = mergedLines[i + 1].pos - mergedLines[i].pos;
      const n = Math.ceil(gap / maxJoistSpan);
      for (let k = 1; k < n; k++) lines.push({ pos: mergedLines[i].pos + (gap * k) / n, kind: 'inter' });
    }
  }
  lines.sort((p, q) => p.pos - q.pos);
  let joistSpanUsed = 0;
  for (let i = 0; i + 1 < lines.length; i++) joistSpanUsed = Math.max(joistSpanUsed, lines[i + 1].pos - lines[i].pos);

  const onHouseVertical = (x: number, y: number): boolean =>
    houseY.some((i) => {
      const e = E[i];
      return Math.abs(e.a.x - x) < 1 && y >= Math.min(e.a.y, e.b.y) - 1 && y <= Math.max(e.a.y, e.b.y) + 1;
    });

  // ---- bearers and posts ----
  const bearers: BearerRun[] = [];
  let maxBearerSpanUsed = 0;
  let bearerCounter = 0;
  lines.forEach((line, li) => {
    const onWall = line.kind === 'wall';
    const prevGap = li > 0 ? line.pos - lines[li - 1].pos : line.pos - bb.minY;
    const nextGap = li + 1 < lines.length ? lines[li + 1].pos - line.pos : bb.maxY - line.pos;
    const flw = (prevGap + nextGap) / 2;
    const bs = bearerMaxSpan(rules, params.bearerProductId, params.bearerLaminations, flw);
    if (bs.extrapolated && !warnings.some((w) => w.key === 'layout.bearerSpanExtrapolated')) {
      warnings.push({ severity: 'warn', key: 'layout.bearerSpanExtrapolated' });
    }
    const maxSpan = Math.max(300, Math.floor((bs.span * factor) / 10) * 10);
    const intervals = clipHorizontal(poly, line.pos);
    for (const [x0, x1] of intervals) {
      const xs = x0 + rules.bearerEndInset;
      const xe = x1 - rules.bearerEndInset;
      const length = xe - xs;
      if (length < 200) continue;
      const houseStart = onHouseVertical(x0, line.pos);
      const houseEnd = onHouseVertical(x1, line.pos);
      const sbS = houseStart ? rules.houseBearerInset : rules.postEndSetback;
      const sbE = houseEnd ? rules.houseBearerInset : rules.postEndSetback;
      const pStart = xs + sbS;
      const pEnd = xe - sbE;
      const postXs: number[] = [];
      let postSpacing = 0;
      if (onWall) {
        // carried by the wall anchors, no posts
      } else if (pEnd - pStart < 300) {
        postXs.push((xs + xe) / 2);
      } else {
        const n = Math.max(1, Math.ceil((pEnd - pStart) / maxSpan));
        postSpacing = (pEnd - pStart) / n;
        for (let k = 0; k <= n; k++) postXs.push(pStart + postSpacing * k);
      }
      maxBearerSpanUsed = Math.max(maxBearerSpanUsed, postSpacing);
      const id = `B${++bearerCounter}`;
      const pieces: number[][] = [];
      const splices: number[][] = [];
      const maxLen = ctx.bearerMaxStock - rules.joistEndAllowance;
      const first = splitRun(xs, xe, postXs, maxLen, 600);
      pieces.push(first.pieces.map((p) => p + rules.joistEndAllowance));
      splices.push(first.joins);
      if (params.bearerLaminations === 2) {
        // stagger the second lamination by splitting from the opposite end
        const rev = splitRun(0, length, postXs.map((p) => xe - p), maxLen, 600);
        pieces.push(rev.pieces.map((p) => p + rules.joistEndAllowance));
        splices.push(rev.joins.map((j) => xe - j));
      }
      if (onWall) {
        ledgers.push({
          edgeIndex: line.edgeIndex ?? -1,
          seg: { a: { x: xs, y: line.pos }, b: { x: xe, y: line.pos } },
          length,
          bolts: Math.ceil(length / rules.ledgerBoltSpacing) + 1,
          hangers: 0,
        });
      }
      bearers.push({
        id,
        lineIndex: li,
        onWall,
        seg: { a: { x: xs, y: line.pos }, b: { x: xe, y: line.pos } },
        length,
        posts: postXs.map((x) => ({ x, y: line.pos })),
        pieces,
        splices,
        flw,
        maxSpan,
        postSpacing,
        houseStart,
        houseEnd,
      });
    }
  });

  // ---- joists ----
  // Edge joists sit flush with every edge parallel to the joists; regular joists are
  // spaced evenly within each bay between edge joists so the spacing never exceeds
  // the nominated maximum.
  const jt = ctx.joistThickness;
  const edgeXs = new Set<number>([bb.minX + jt / 2, bb.maxX - jt / 2]);
  for (const e of E) {
    if (e.axis === 'y') edgeXs.add(e.a.x - e.outward.x * (jt / 2));
  }
  const edgeSorted = [...edgeXs].sort((p, q) => p - q).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 60);
  const joistXs: { x: number; edge: boolean }[] = [];
  for (let i = 0; i < edgeSorted.length; i++) {
    joistXs.push({ x: edgeSorted[i], edge: true });
    if (i + 1 < edgeSorted.length) {
      const w = edgeSorted[i + 1] - edgeSorted[i];
      const n = Math.max(1, Math.ceil(w / params.joistSpacing));
      for (let k = 1; k < n; k++) joistXs.push({ x: edgeSorted[i] + (w * k) / n, edge: false });
    }
  }
  const bearerPositions = lines.map((l) => l.pos);
  const ledgerPositions: number[] = [];
  const allSupports = lines.map((l) => l.pos).sort((p, q) => p - q);
  const joists: JoistRun[] = [];
  let joistCounter = 0;
  let totalHangers = 0;
  let joistBearerCrossings = 0;
  let offSupportJoins = false;
  for (const c of joistXs) {
    const intervals = clipVertical(poly, c.x);
    for (const [y0, y1] of intervals) {
      const length = y1 - y0;
      if (length < 100) continue;
      if (ctx.flush) {
        // one piece per bay between consecutive supports, hung on a joist support at each end
        const sup = allSupports.filter((p) => p > y0 - 1 && p < y1 + 1);
        if (sup.length < 2) continue;
        const pieces: number[] = [];
        for (let i = 0; i + 1 < sup.length; i++) {
          const clear = sup[i + 1] - sup[i] - ctx.bearerWidth;
          if (clear > 50) pieces.push(clear);
        }
        const hangers = pieces.length * 2;
        totalHangers += hangers;
        joists.push({
          id: `J${++joistCounter}`,
          pos: c.x,
          seg: { a: { x: c.x, y: sup[0] }, b: { x: c.x, y: sup[sup.length - 1] } },
          length: sup[sup.length - 1] - sup[0],
          pieces,
          splices: sup.slice(1, -1),
          bearerCrossings: 0,
          hangers,
          isEdge: c.edge,
        });
        continue;
      }
      const crossings = bearerPositions.filter((p) => p > y0 + 1 && p < y1 - 1).length;
      const hangers = ledgerPositions.filter((p) => Math.abs(p - y0) < 1 || Math.abs(p - y1) < 1).length;
      const supportsInside = bearerPositions.filter((p) => p > y0 && p < y1);
      const split = splitRun(y0, y1, supportsInside, ctx.joistMaxStock - rules.joistEndAllowance, 600);
      if (split.offSupport) offSupportJoins = true;
      joistBearerCrossings += crossings;
      totalHangers += hangers;
      joists.push({
        id: `J${++joistCounter}`,
        pos: c.x,
        seg: { a: { x: c.x, y: y0 }, b: { x: c.x, y: y1 } },
        length,
        pieces: split.pieces.map((p) => p + rules.joistEndAllowance),
        splices: split.joins,
        bearerCrossings: crossings,
        hangers,
        isEdge: c.edge,
      });
    }
  }
  for (const l of ledgers) l.hangers = ctx.flush ? joists.filter((j) => Math.abs(j.seg.a.y - l.seg.a.y) < 1 || Math.abs(j.seg.b.y - l.seg.a.y) < 1).length : 0;

  // ---- boards ----
  const bw = ctx.boardWidth;
  const pitch = bw + ctx.boardGap;
  const houseAtBottom = houseX.length > 0 && Math.abs(E[houseX[0]].a.y - bb.maxY) < 1;
  const boards: BoardRow[] = [];
  const joistPositions = joistXs.map((c) => c.x);
  let boardLm = 0;
  let boardJoins = 0;
  let screws = 0;
  const maxBoard = ctx.deckingMaxStock - rules.boardEndAllowance;
  for (let k = 0; k < 2000; k++) {
    let yc: number;
    let visible: number;
    if (!houseAtBottom) {
      const top = bb.minY + k * pitch;
      if (top >= bb.maxY - 1) break;
      visible = Math.min(bw, bb.maxY - top);
      yc = top + visible / 2;
    } else {
      const bottom = bb.maxY - k * pitch;
      if (bottom <= bb.minY + 1) break;
      visible = Math.min(bw, bottom - bb.minY);
      yc = bottom - visible / 2;
    }
    const intervals = clipHorizontal(poly, yc);
    if (!intervals.length) continue;
    const runs: BoardRun[] = [];
    for (const [x0, x1] of intervals) {
      const length = x1 - x0;
      if (length < 50) continue;
      const J = joistPositions.filter((x) => x > x0 - 1 && x < x1 + 1);
      const inner = joistPositions.filter((x) => x > x0 + rules.minBoardPiece && x < x1 - rules.minBoardPiece);
      const firstTarget = Math.max(rules.minBoardPiece + 1, maxBoard - (k % 3) * rules.staggerOffset);
      const split = splitRun(x0, x1, inner, maxBoard, rules.minBoardPiece, firstTarget);
      const joins = split.joins.length;
      const runScrews = (J.length + joins) * rules.screwsPerCrossing;
      boardLm += length;
      boardJoins += joins;
      screws += runScrews;
      runs.push({
        seg: { a: { x: x0, y: yc }, b: { x: x1, y: yc } },
        length,
        pieces: split.pieces.map((p) => p + rules.boardEndAllowance),
        joins: split.joins,
        crossings: J.length,
        screws: runScrews,
      });
    }
    boards.push({ index: k, pos: yc, width: visible, ripped: visible < bw - 1, runs });
  }
  if (offSupportJoins) warnings.push({ severity: 'info', key: 'layout.joinOffSupport' });
  const lastRow = boards[boards.length - 1];
  if (lastRow && lastRow.ripped && lastRow.width < bw / 2) {
    warnings.push({ severity: 'info', key: 'layout.narrowRip', params: { width: Math.round(lastRow.width) } });
  }

  // ---- posts (numbered by line then position) ----
  const posts: PostInfo[] = [];
  let pc = 0;
  for (const b of bearers) for (const p of b.posts) posts.push({ id: `P${++pc}`, pt: p, bearerId: b.id });

  // ---- swap back to world orientation ----
  const fix = <T extends { seg: Seg }>(x: T): T => (swapped ? { ...x, seg: swapSeg(x.seg) } : x);
  const result: LayoutResult = {
    swapped,
    boardAxis,
    supportAxis: swapped ? 'x' : 'y',
    supports: lines,
    bearers: bearers.map((b) => ({ ...fix(b), posts: swapped ? b.posts.map(swapPt) : b.posts })),
    posts: posts.map((p) => ({ ...p, pt: swapped ? swapPt(p.pt) : p.pt })),
    joists: joists.map(fix),
    boards: boards.map((r) => ({ ...r, runs: r.runs.map(fix) })),
    ledgers: ledgers.map(fix),
    attachment,
    maxJoistSpan,
    joistSpanUsed,
    maxBearerSpanUsed,
    warnings,
    totals: {
      bearerLm: bearers.reduce((s, b) => s + b.length * params.bearerLaminations, 0),
      joistLm: joists.reduce((s, j) => s + j.length, 0),
      boardLm,
      boardRows: boards.length,
      boardJoins,
      screws,
      joistBearerCrossings,
      hangers: totalHangers,
      ledgerBolts: ledgers.reduce((s, l) => s + l.bolts, 0),
    },
  };
  return result;
}
