import type { Axis, DeckParams, Pt, RuleSet, Seg } from '../model/types';
import { bbox, clipHorizontal, clipVertical, edges, pointInPolygon, swapPoly, swapPt, validatePolygon, type Edge } from './geometry';
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

/** edge: flush with a deck edge; frame: under the edge board / field board joint; field: evenly spaced in between */
export type JoistKind = 'edge' | 'frame' | 'field';

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
  kind: JoistKind;
}

/** a run of evenly spaced joists between two fixed (edge or frame) joists, positions along the board axis */
export interface JoistBay {
  from: number;
  to: number;
  /** number of spaces */
  count: number;
  spacing: number;
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

/** convex: outside corner mitred 45; concave: inside corner mitred 45; butt: square cut against the house */
export type CornerKind = 'convex' | 'concave' | 'butt';

/** picture-frame edge board along one exposed deck edge */
export interface EdgeBoardRun {
  edgeIndex: number;
  /** outer line = the deck edge, a -> b in edge direction */
  seg: Seg;
  width: number;
  /** cut length including the mitre allowance at concave corners */
  length: number;
  pieces: number[];
  /** join positions on the outer edge line */
  joinPts: Pt[];
  startCorner: CornerKind;
  endCorner: CornerKind;
  /** joists crossed (board perpendicular to joists) or screw pairs along a continuous edge joist */
  crossings: number;
  screws: number;
  /** true when the board runs along the joists (sits on the edge joist) */
  alongJoists: boolean;
}

/** a board laid across the field boards, dividing a run that is longer than one stock length */
export interface BreakerRun {
  /** centreline along the joists, a -> b */
  seg: Seg;
  width: number;
  length: number;
  pieces: number[];
  screws: number;
  /** true when it continues an edge board line at an inside corner */
  aligned: boolean;
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
  /** joist centre positions measured along the board axis */
  joistPositions: number[];
  joistBays: JoistBay[];
  /** largest and smallest actual centre spacing over the real bays */
  joistSpacingUsed: number;
  joistSpacingMin: number;
  boards: BoardRow[];
  edgeBoards: EdgeBoardRun[];
  breakers: BreakerRun[];
  /** polygon the field boards fill (deck outline inset behind the edge boards) */
  fieldPoly: Pt[];
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
    edgeBoardLm: number;
    edgeBoardPieces: number;
    edgeBoardScrews: number;
    mitres: number;
    frameJoists: number;
    breakerLm: number;
    breakerPieces: number;
    breakerScrews: number;
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
  /** picture-frame edge boards around the exposed edges */
  edgeBoard: boolean;
  /** divide runs longer than one board with breaker boards instead of staggered joins */
  breakerBoards: boolean;
  /** the decking's own joist spacing limit */
  deckingMaxJoistSpacing: number;
  deckingMaxStock: number;
  edgeBoardMaxStock: number;
  joistMaxStock: number;
  bearerMaxStock: number;
}

/**
 * Max joist span for a spacing. Exact table values are used as is; spacings between
 * two table columns are interpolated linearly; beyond the last column the span is
 * scaled down and flagged.
 */
export function joistMaxSpan(rules: RuleSet, joistId: string, spacing: number): { span: number; extrapolated: boolean } {
  const table = rules.joistSpan[joistId];
  if (!table) return { span: 0, extrapolated: true };
  const keys = Object.keys(table).map(Number).filter((k) => Number.isFinite(k)).sort((p, q) => p - q);
  if (!keys.length) return { span: 0, extrapolated: true };
  if (table[String(spacing)] !== undefined) return { span: table[String(spacing)], extrapolated: false };
  if (spacing <= keys[0]) return { span: table[String(keys[0])], extrapolated: false };
  const upper = keys.find((k) => k >= spacing);
  if (upper !== undefined) {
    const lower = [...keys].reverse().find((k) => k < spacing) ?? keys[0];
    const s0 = table[String(lower)];
    const s1 = table[String(upper)];
    const span = s0 + ((s1 - s0) * (spacing - lower)) / (upper - lower);
    return { span: Math.floor(span / 10) * 10, extrapolated: false };
  }
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

/**
 * Number of joist spaces in a bay of width w. Fixed mode never exceeds the nominal
 * spacing; auto mode never exceeds the cap and lands as close to the target as the
 * bay allows, spreading the joists evenly.
 */
export function joistSpaces(w: number, params: DeckParams, rules: RuleSet, cap: number): number {
  if (w <= 1) return 1;
  if (params.joistSpacingMode === 'fixed') {
    const s = Math.max(100, params.joistSpacing);
    return Math.max(1, Math.ceil(w / s - 1e-9));
  }
  const limit = Math.max(100, cap);
  const target = Math.min(limit, Math.max(100, rules.joistSpacingTarget || limit));
  return Math.max(1, Math.ceil(w / limit - 1e-9), Math.round(w / target));
}

function swapSeg(s: Seg): Seg {
  return { a: swapPt(s.a), b: swapPt(s.b) };
}

/** Offset every edge inward by its own amount and rebuild the vertices (orthogonal polygons only). */
export function insetPolygon(poly: Pt[], E: Edge[], insetOf: (e: Edge) => number): Pt[] {
  const n = poly.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = E[(i - 1 + n) % n];
    const cur = E[i];
    const vertical = prev.axis === 'y' ? prev : cur;
    const horizontal = prev.axis === 'y' ? cur : prev;
    out.push({
      x: vertical.a.x - vertical.outward.x * insetOf(vertical),
      y: horizontal.a.y - horizontal.outward.y * insetOf(horizontal),
    });
  }
  return out;
}

/** convex (outside) or concave (inside) corner at vertex i, by counting the inside quadrants around it */
export function cornerShape(poly: Pt[], i: number): 'convex' | 'concave' {
  const v = poly[i];
  const d = 2;
  let inside = 0;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (pointInPolygon({ x: v.x + sx * d, y: v.y + sy * d }, poly)) inside++;
  }
  return inside >= 3 ? 'concave' : 'convex';
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
  const exposed = (e: Edge): boolean => !houseEdges.includes(e.index);
  const bw = ctx.boardWidth;
  const gap = ctx.boardGap;
  const jt = ctx.joistThickness;

  // ---- picture-frame edge boards: field polygon inset behind them ----
  let edgeBoardOn = ctx.edgeBoard && E.some(exposed);
  let fieldPoly: Pt[] = poly;
  if (edgeBoardOn) {
    const inset = insetPolygon(poly, E, (e) => (exposed(e) ? bw + gap : 0));
    const fE = edges(inset);
    const ok = validatePolygon(inset).ok && fE.every((e) => e.length > 2 * (bw + gap) + 50) && fE.length === E.length;
    if (ok) fieldPoly = inset;
    else {
      edgeBoardOn = false;
      warnings.push({ severity: 'warn', key: 'layout.edgeBoardTooSmall' });
    }
  }

  // ---- breaker boards: a run longer than one board is divided symmetrically by boards laid
  //      across it (stopping at the edge boards), instead of staggered butt joins ----
  const maxBoard = ctx.deckingMaxStock - rules.boardEndAllowance;
  const strip = bw + 2 * gap;
  interface BandBreaker { xc: number; y0: number; y1: number; aligned: boolean }
  const bandBreakers: BandBreaker[] = [];
  if (ctx.breakerBoards) {
    const fE = edges(fieldPoly);
    const ys = [...new Set(fieldPoly.map((p) => Math.round(p.y * 10) / 10))].sort((p, q) => p - q);
    for (let bi = 0; bi + 1 < ys.length; bi++) {
      const y0 = ys[bi];
      const y1 = ys[bi + 1];
      if (y1 - y0 < 1) continue;
      for (const [x0, x1] of clipHorizontal(fieldPoly, (y0 + y1) / 2)) {
        const len = x1 - x0;
        if (len <= maxBoard) continue;
        // first choice: continue an edge board line from an inside corner that touches this band
        let aligned: number | null = null;
        let balance = Infinity;
        for (const e of fE) {
          if (e.axis !== 'y') continue;
          const ya = Math.min(e.a.y, e.b.y);
          const yb = Math.max(e.a.y, e.b.y);
          const touches = Math.abs(yb - y0) < 1 || Math.abs(ya - y1) < 1;
          if (!touches || e.a.x <= x0 + 1 || e.a.x >= x1 - 1) continue;
          const xc = e.a.x + e.outward.x * (gap + bw / 2);
          const left = xc - strip / 2 - x0;
          const right = x1 - (xc + strip / 2);
          if (left > maxBoard || right > maxBoard || left < rules.minBoardPiece || right < rules.minBoardPiece) continue;
          const b = Math.abs(left - right);
          if (b < balance) {
            balance = b;
            aligned = xc;
          }
        }
        if (aligned !== null) {
          bandBreakers.push({ xc: aligned, y0, y1, aligned: true });
          continue;
        }
        let n = Math.max(1, Math.ceil(len / maxBoard) - 1);
        while ((len - n * strip) / (n + 1) > maxBoard) n++;
        const bay = (len - n * strip) / (n + 1);
        for (let k = 1; k <= n; k++) bandBreakers.push({ xc: x0 + k * bay + (k - 1) * strip + strip / 2, y0, y1, aligned: false });
      }
    }
  }
  // merge breakers that continue across band boundaries at the same position
  bandBreakers.sort((p, q) => p.xc - q.xc || p.y0 - q.y0);
  const breakerRuns: BandBreaker[] = [];
  for (const b of bandBreakers) {
    const last = breakerRuns[breakerRuns.length - 1];
    if (last && Math.abs(last.xc - b.xc) < 1 && Math.abs(last.y1 - b.y0) < 1) {
      last.y1 = b.y1;
      last.aligned = last.aligned || b.aligned;
      continue;
    }
    breakerRuns.push({ ...b });
  }

  const houseX = houseEdges.filter((i) => E[i] && E[i].axis === 'x');
  const houseY = houseEdges.filter((i) => E[i] && E[i].axis === 'y');
  let attachment: 'freestanding' | 'wall' = params.attachment === 'wall' ? 'wall' : 'freestanding';
  if (attachment === 'wall' && !houseX.length) {
    attachment = 'freestanding';
    if (houseEdges.length) warnings.push({ severity: 'warn', key: 'layout.wallBearerNotPossible' });
  }

  // ---- joist positions along x: edge joists, double joists under the edge board joint, then even fill per bay ----
  const fixedXs: { x: number; kind: JoistKind }[] = [];
  for (const e of E) {
    if (e.axis !== 'y') continue;
    fixedXs.push({ x: e.a.x - e.outward.x * (jt / 2), kind: 'edge' });
    if (edgeBoardOn && rules.frameJoist && exposed(e)) {
      // a pair of joists touching each other, the joint (board width + gap from the edge) falls between them
      const joint = e.a.x - e.outward.x * (bw + gap);
      fixedXs.push({ x: joint - jt / 2, kind: 'frame' });
      fixedXs.push({ x: joint + jt / 2, kind: 'frame' });
    }
  }
  // a breaker board sits on a joist of its own, with a joist under each row of board ends beside it
  for (const b of breakerRuns) {
    fixedXs.push({ x: b.xc, kind: 'frame' });
    fixedXs.push({ x: b.xc - (bw / 2 + gap + jt / 2), kind: 'frame' });
    fixedXs.push({ x: b.xc + (bw / 2 + gap + jt / 2), kind: 'frame' });
  }
  fixedXs.sort((p, q) => p.x - q.x);
  const fixedSorted: { x: number; kind: JoistKind }[] = [];
  for (const f of fixedXs) {
    const last = fixedSorted[fixedSorted.length - 1];
    // exact duplicates merge; two edge joists from a small jog merge; frame joists keep their place
    const duplicate = last && Math.abs(f.x - last.x) < 1;
    const jog = last && last.kind === 'edge' && f.kind === 'edge' && f.x - last.x <= 60;
    if (duplicate || jog) {
      if (f.kind === 'edge' && last) last.kind = 'edge';
      continue;
    }
    fixedSorted.push({ ...f });
  }
  const spacingCap = Math.min(params.joistSpacingMax || 500, ctx.deckingMaxJoistSpacing || 500);
  const joistXs: { x: number; kind: JoistKind }[] = [];
  const joistBays: JoistBay[] = [];
  for (let i = 0; i < fixedSorted.length; i++) {
    joistXs.push(fixedSorted[i]);
    if (i + 1 < fixedSorted.length) {
      const w = fixedSorted[i + 1].x - fixedSorted[i].x;
      const n = joistSpaces(w, params, rules, spacingCap);
      for (let k = 1; k < n; k++) joistXs.push({ x: fixedSorted[i].x + (w * k) / n, kind: 'field' });
      // the edge-to-frame double is structural, not a spacing bay
      if (w > 200) joistBays.push({ from: fixedSorted[i].x, to: fixedSorted[i + 1].x, count: n, spacing: w / n });
    }
  }
  const realBays = joistBays.filter((b) => b.count >= 1);
  const joistSpacingUsed = realBays.length ? Math.max(...realBays.map((b) => b.spacing)) : params.joistSpacing;
  const joistSpacingMin = realBays.length ? Math.min(...realBays.map((b) => b.spacing)) : params.joistSpacing;
  const spanSpacing = Math.ceil(joistSpacingUsed / 10) * 10;
  const js = joistMaxSpan(rules, params.joistProductId, spanSpacing);
  if (js.extrapolated) warnings.push({ severity: 'warn', key: 'layout.joistSpanExtrapolated' });
  const maxJoistSpan = Math.max(300, Math.floor((js.span * factor) / 10) * 10);

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
      const gapY = mergedLines[i + 1].pos - mergedLines[i].pos;
      const n = Math.ceil(gapY / maxJoistSpan);
      for (let k = 1; k < n; k++) lines.push({ pos: mergedLines[i].pos + (gapY * k) / n, kind: 'inter' });
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
  const bearerPositions = lines.map((l) => l.pos);
  const ledgerPositions: number[] = [];
  const allSupports = lines.map((l) => l.pos).sort((p, q) => p - q);
  const joists: JoistRun[] = [];
  let joistCounter = 0;
  let totalHangers = 0;
  let joistBearerCrossings = 0;
  let offSupportJoins = false;
  let frameJoists = 0;
  for (const c of joistXs) {
    const intervals = clipVertical(poly, c.x);
    for (const [y0, y1] of intervals) {
      const length = y1 - y0;
      if (length < 100) continue;
      if (c.kind === 'frame') frameJoists++;
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
          isEdge: c.kind === 'edge',
          kind: c.kind,
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
        isEdge: c.kind === 'edge',
        kind: c.kind,
      });
    }
  }
  for (const l of ledgers) l.hangers = ctx.flush ? joists.filter((j) => Math.abs(j.seg.a.y - l.seg.a.y) < 1 || Math.abs(j.seg.b.y - l.seg.a.y) < 1).length : 0;
  const joistPositions = joistXs.map((c) => c.x);

  // ---- field boards (inside the picture frame when edge boards are on) ----
  const pitch = bw + gap;
  const fbb = bbox(fieldPoly);
  const houseAtBottom = houseX.length > 0 && Math.abs(E[houseX[0]].a.y - bb.maxY) < 1;
  const boards: BoardRow[] = [];
  let boardLm = 0;
  let boardJoins = 0;
  let screws = 0;
  const splitAtBreakers = (iv: [number, number], yc: number): [number, number][] => {
    let parts: [number, number][] = [iv];
    for (const b of breakerRuns) {
      if (yc < b.y0 || yc > b.y1) continue;
      const s0 = b.xc - strip / 2;
      const s1 = b.xc + strip / 2;
      const next: [number, number][] = [];
      for (const [a, c] of parts) {
        if (s1 <= a || s0 >= c) next.push([a, c]);
        else {
          if (s0 - a > 50) next.push([a, s0]);
          if (c - s1 > 50) next.push([s1, c]);
        }
      }
      parts = next;
    }
    return parts;
  };
  for (let k = 0; k < 2000; k++) {
    let yc: number;
    let visible: number;
    if (!houseAtBottom) {
      const top = fbb.minY + k * pitch;
      if (top >= fbb.maxY - 1) break;
      visible = Math.min(bw, fbb.maxY - top);
      yc = top + visible / 2;
    } else {
      const bottom = fbb.maxY - k * pitch;
      if (bottom <= fbb.minY + 1) break;
      visible = Math.min(bw, bottom - fbb.minY);
      yc = bottom - visible / 2;
    }
    const intervals = clipHorizontal(fieldPoly, yc).flatMap((iv) => splitAtBreakers(iv, yc));
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

  // ---- edge boards: one run per exposed edge, mitred where two exposed edges meet ----
  const edgeBoards: EdgeBoardRun[] = [];
  let edgeBoardLm = 0;
  let edgeBoardPieces = 0;
  let edgeBoardScrews = 0;
  let mitres = 0;
  if (edgeBoardOn) {
    const n = E.length;
    const maxEdge = ctx.edgeBoardMaxStock - rules.boardEndAllowance;
    const cornerAt = (i: number): CornerKind => {
      const prev = E[(i - 1 + n) % n];
      const cur = E[i];
      if (!exposed(prev) || !exposed(cur)) return 'butt';
      return cornerShape(poly, i);
    };
    for (const e of E) {
      if (!exposed(e)) continue;
      const startCorner = cornerAt(e.index);
      const endCorner = cornerAt((e.index + 1) % n);
      const extra = (startCorner === 'concave' ? bw : 0) + (endCorner === 'concave' ? bw : 0);
      const length = e.length + extra;
      const alongJoists = e.axis === 'y';
      let pieces: number[];
      let joinTs: number[];
      if (length <= maxEdge) {
        pieces = [length];
        joinTs = [];
      } else if (alongJoists) {
        // continuous support from the edge joist: split evenly
        const parts = Math.ceil(length / maxEdge);
        pieces = Array.from({ length: parts }, () => length / parts);
        joinTs = Array.from({ length: parts - 1 }, (_, k) => ((k + 1) * e.length) / parts);
      } else {
        const lo = Math.min(e.a.x, e.b.x);
        const hi = Math.max(e.a.x, e.b.x);
        const sup = joistPositions.filter((x) => x > lo + rules.minBoardPiece && x < hi - rules.minBoardPiece);
        const split = splitRun(lo, hi, sup, maxEdge, rules.minBoardPiece);
        pieces = [...split.pieces];
        // the mitre allowance at a concave corner belongs to the piece at that end
        const startIdx = e.dir.x > 0 ? 0 : pieces.length - 1;
        const endIdx = e.dir.x > 0 ? pieces.length - 1 : 0;
        if (startCorner === 'concave') pieces[startIdx] += bw;
        if (endCorner === 'concave') pieces[endIdx] += bw;
        joinTs = split.joins.map((x) => (e.dir.x > 0 ? x - e.a.x : e.a.x - x));
      }
      const crossings = alongJoists
        ? Math.floor(e.length / 450) + 1
        : joistPositions.filter((x) => x > Math.min(e.a.x, e.b.x) - 1 && x < Math.max(e.a.x, e.b.x) + 1).length;
      const runScrews = (crossings + joinTs.length) * rules.screwsPerCrossing;
      if (startCorner !== 'butt') mitres++;
      edgeBoardLm += length;
      edgeBoardPieces += pieces.length;
      edgeBoardScrews += runScrews;
      edgeBoards.push({
        edgeIndex: e.index,
        seg: { a: e.a, b: e.b },
        width: bw,
        length,
        pieces: pieces.map((p) => p + rules.boardEndAllowance),
        joinPts: joinTs.map((tt) => ({ x: e.a.x + e.dir.x * tt, y: e.a.y + e.dir.y * tt })),
        startCorner,
        endCorner,
        crossings,
        screws: runScrews,
        alongJoists,
      });
    }
  }

  // ---- breaker boards as pieces ----
  const breakers: BreakerRun[] = [];
  let breakerLm = 0;
  let breakerPieces = 0;
  let breakerScrews = 0;
  for (const b of breakerRuns) {
    const length = b.y1 - b.y0;
    if (length < 100) continue;
    const parts = Math.max(1, Math.ceil(length / maxBoard));
    const pieces = Array.from({ length: parts }, () => length / parts + rules.boardEndAllowance);
    const screws = (Math.floor(length / 450) + 1) * rules.screwsPerCrossing;
    breakerLm += length;
    breakerPieces += parts;
    breakerScrews += screws;
    breakers.push({ seg: { a: { x: b.xc, y: b.y0 }, b: { x: b.xc, y: b.y1 } }, width: bw, length, pieces, screws, aligned: b.aligned });
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
    joistPositions,
    joistBays,
    joistSpacingUsed,
    joistSpacingMin,
    boards: boards.map((r) => ({ ...r, runs: r.runs.map(fix) })),
    edgeBoards: edgeBoards.map((eb) => ({ ...fix(eb), joinPts: swapped ? eb.joinPts.map(swapPt) : eb.joinPts })),
    breakers: breakers.map(fix),
    fieldPoly: swapped ? swapPoly(fieldPoly) : fieldPoly,
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
      edgeBoardLm,
      edgeBoardPieces,
      edgeBoardScrews,
      mitres,
      frameJoists,
      breakerLm,
      breakerPieces,
      breakerScrews,
    },
  };
  return result;
}
