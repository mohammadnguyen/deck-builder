import type { Axis, BreakerLayout, DeckParams, Pt, RuleSet, Seg } from '../model/types';
import { bbox, clipHorizontal, clipVertical, edges, pointInPolygon, swapPoly, swapPt, validatePolygon, type Edge } from './geometry';
import { bestBreakerSplit } from './breakerplan';
import { packedLength, splitRun, splitRunStocked } from './cutlist';
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
  /** the largest space (all spaces when the bay is evened out) */
  spacing: number;
  /** every space in order along the boards: even, or set out with the short one last */
  spaces: number[];
}

/** "9 x @363", or for a set-out bay "8 x @400 + 65" */
export function bayLabel(b: JoistBay): string {
  const groups: { v: number; n: number }[] = [];
  for (const s of b.spaces) {
    const v = Math.round(s);
    const last = groups[groups.length - 1];
    if (last && last.v === v) last.n++;
    else groups.push({ v, n: 1 });
  }
  return groups.map((g) => (g.n > 1 ? `${g.n} x @${g.v}` : `${g.v}`)).join(' + ');
}

export interface BoardRun {
  seg: Seg;
  length: number;
  pieces: number[];
  joins: number[];
  crossings: number;
  screws: number;
  /** visible width when this run is narrower than the row (ripped along a notch or the far edge) */
  width: number;
  ripped: boolean;
}

/** boards ripped to a width, grouped for the notes and the cut list */
export interface RipInfo {
  row: number;
  width: number;
  boards: number;
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
  /** stable id: the hand-placed breaker it comes from, or B1, B2... in layout order when automatic */
  id: string;
  manual: boolean;
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
  /** true when row 1 of the boards is laid from a house wall (else from the far edge board) */
  startsAtHouse: boolean;
  /** breakers laid out automatically, or placed by hand */
  breakerMode: 'auto' | 'manual';
  /** field board width and gap, so the editor can work out row edges and breaker strips */
  boardWidth: number;
  boardGap: number;
  /** boards that have to be ripped to width (last row, or rows meeting a notch), grouped by row and width */
  rips: RipInfo[];
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
  /** width of the edge board product (may differ from the field board) */
  edgeBoardWidth: number;
  /** divide runs longer than one board with breaker boards instead of staggered joins */
  breakerBoards: boolean;
  /** breakers placed by hand (used when they were laid out for the current board direction) */
  manualBreakers?: BreakerLayout | null;
  /** joists set out at exact centres from the start of each bay, the short space last (else evened out) */
  joistSetout?: boolean;
  joistSetoutSpacing?: number;
  kerf: number;
  /** the decking's own joist spacing limit */
  deckingMaxJoistSpacing: number;
  deckingMaxStock: number;
  /** the lengths the decking comes in */
  deckingStockLengths?: number[];
  edgeBoardMaxStock: number;
  joistMaxStock: number;
  bearerMaxStock: number;
  /** stock lengths the joists and the bearers come in (the yard's lengths): a cut list may mix them */
  joistStockLengths?: number[];
  bearerStockLengths?: number[];
  /** joists and bearers are the same timber, cut from the same sticks */
  sameTimber?: boolean;
  /** stump / post width, so a bearer end sits fully on its end stump */
  postWidth?: number;
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

/** What a frame needs, worked out without laying the boards: enough to price one frame against another. */
export interface FramePlan {
  /** stumps */
  posts: number;
  /** bearer length along its lines (one ply), wall bearers included */
  bearerLm: number;
  /** braces as the bracing counts them: half the bays along each bearer, plus one per line after the first */
  braceUnits: number;
  maxBearerSpanUsed: number;
  /** joist length, and joists crossing (or hung from) bearers */
  joistLm: number;
  crossings: number;
}

export function computeLayout(polyIn: Pt[], houseEdges: number[], params: DeckParams, rules: RuleSet, ctx: LayoutContext): LayoutResult {
  return layoutImpl(polyIn, houseEdges, params, rules, ctx, false) as LayoutResult;
}

/** The frame of a layout (bearer lines, bearers and stumps) without the boards: fast, for choosing a frame. */
export function planFrame(polyIn: Pt[], houseEdges: number[], params: DeckParams, rules: RuleSet, ctx: LayoutContext): FramePlan {
  return layoutImpl(polyIn, houseEdges, params, rules, ctx, true) as FramePlan;
}

/** automatic breakers by field and settings: the same for every frame the sizing tries */
const autoBreakerCache = new Map<string, { breakers: { xc: number; y0: number; y1: number; aligned: boolean; id: string; manual: boolean }[]; saving: { n: number; saving: number }[] }>();

/** the decking a set of breakers needs: every band's rows cut at its breakers, and the breaker boards (mm bought) */
function breakerDecking(
  list: { xc: number; y0: number; y1: number }[],
  bands: { y0: number; y1: number; x0: number; x1: number; rows: number }[],
  strip: number, maxBoard: number, stocks: number[], allowance: number, kerf: number,
): number {
  const cuts: number[] = [];
  for (const iv of bands) {
    const xs = list.filter((b) => b.y0 < iv.y1 - 0.5 && b.y1 > iv.y0 + 0.5 && b.xc > iv.x0 && b.xc < iv.x1).map((b) => b.xc).sort((p, q) => p - q);
    const pieces: number[] = [];
    let from = iv.x0;
    for (const xc of xs) {
      pieces.push(xc - strip / 2 - from);
      from = xc + strip / 2;
    }
    pieces.push(iv.x1 - from);
    for (const p of pieces) {
      if (p <= 1) continue;
      const k = Math.ceil(p / maxBoard);
      for (let r = 0; r < iv.rows; r++) for (let i = 0; i < k; i++) cuts.push(p / k + allowance);
    }
  }
  // breaker boards: one length per line, across the bands it runs through
  const lines = new Map<number, number>();
  for (const b of list) lines.set(Math.round(b.xc), (lines.get(Math.round(b.xc)) ?? 0) + (b.y1 - b.y0));
  for (const len of lines.values()) {
    const k = Math.ceil(len / maxBoard);
    for (let i = 0; i < k; i++) cuts.push(len / k + allowance);
  }
  return packedLength(cuts, stocks, kerf);
}

/** Carry each automatic breaker on into the bands it touches, where its pieces either side stay long enough and the
 *  deck buys no more decking (repeated, so a line can run on through several bands). */
function extendBreakers(
  list: { xc: number; y0: number; y1: number; aligned: boolean; id: string; manual: boolean }[],
  bands: { y0: number; y1: number; x0: number; x1: number; rows: number }[],
  strip: number, maxBoard: number, minPiece: number, stocks: number[], allowance: number, kerf: number,
): void {
  if (!list.length) return;
  let base = breakerDecking(list, bands, strip, maxBoard, stocks, allowance, kerf);
  const tried = new Set<string>();
  const queue = [...list];
  while (queue.length) {
    const b = queue.shift()!;
    for (const iv of bands) {
      const touches = Math.abs(b.y0 - iv.y1) < 1 || Math.abs(b.y1 - iv.y0) < 1;
      if (!touches || b.xc - strip / 2 - iv.x0 < minPiece || iv.x1 - (b.xc + strip / 2) < minPiece) continue;
      const key = `${Math.round(b.xc)}|${Math.round(iv.y0)}|${Math.round(iv.x0)}`;
      if (tried.has(key)) continue;
      tried.add(key);
      // not where a breaker already is
      if (list.some((o) => o.y0 < iv.y1 - 0.5 && o.y1 > iv.y0 + 0.5 && Math.abs(o.xc - b.xc) < strip)) continue;
      const cand = { xc: b.xc, y0: iv.y0, y1: iv.y1, aligned: false, id: '', manual: false };
      const trial = breakerDecking([...list, cand], bands, strip, maxBoard, stocks, allowance, kerf);
      if (trial <= base + 1) {
        list.push(cand);
        queue.push(cand);
        base = trial;
      }
    }
  }
}

function layoutImpl(
  polyIn: Pt[],
  houseEdges: number[],
  params: DeckParams,
  rules: RuleSet,
  ctx: LayoutContext,
  planOnly: boolean,
): LayoutResult | FramePlan {
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
  const ebw = ctx.edgeBoardWidth || bw;
  const gap = ctx.boardGap;
  const jt = ctx.joistThickness;

  // ---- picture-frame edge boards: field polygon inset behind them ----
  let edgeBoardOn = ctx.edgeBoard && E.some(exposed);
  let fieldPoly: Pt[] = poly;
  if (edgeBoardOn) {
    const inset = insetPolygon(poly, E, (e) => (exposed(e) ? ebw + gap : 0));
    const fE = edges(inset);
    const ok = validatePolygon(inset).ok && fE.every((e) => e.length > 2 * (ebw + gap) + 50) && fE.length === E.length;
    if (ok) fieldPoly = inset;
    else {
      edgeBoardOn = false;
      warnings.push({ severity: 'warn', key: 'layout.edgeBoardTooSmall' });
    }
  }

  // ---- breaker boards: a run longer than one board is divided symmetrically by boards laid
  //      across it (stopping at the edge boards), instead of staggered butt joins, where the pieces waste the
  //      least board ----
  const maxBoard = ctx.deckingMaxStock - rules.boardEndAllowance;
  const strip = bw + 2 * gap;
  // joist centres: set out from the start of each bay, or spread evenly up to the cap
  const spacingCap = Math.min(params.joistSpacingMax || 500, ctx.deckingMaxJoistSpacing || 500);
  const setoutSpacing = Math.max(100, ctx.joistSetoutSpacing || params.joistSpacing || 400);
  const bayJoistSpacing = ctx.joistSetout ? setoutSpacing : spacingCap;
  interface BandBreaker { xc: number; y0: number; y1: number; aligned: boolean; id: string; manual: boolean }
  const bandBreakers: BandBreaker[] = [];
  const breakerSaving: { n: number; saving: number }[] = [];
  // hand-placed breakers count only where breakers are on for this decking (they stay in the project for when
  // they are on again)
  const manualItems = ctx.manualBreakers && ctx.manualBreakers.axis === boardAxis && ctx.breakerBoards ? ctx.manualBreakers.items : null;
  const inter = (p: [number, number][], q: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const [a, b] of p) for (const [c, d] of q) if (Math.min(b, d) - Math.max(a, c) > 1) out.push([Math.max(a, c), Math.min(b, d)]);
    return out;
  };
  // stretches across the boards where the whole width of a breaker strip centred on xc lies inside the field
  const stripIntervals = (xc: number): [number, number][] => inter(clipVertical(fieldPoly, xc - strip / 2 + 1), clipVertical(fieldPoly, xc + strip / 2 - 1));
  if (manualItems) {
    // hand-placed: each breaker runs where its whole width lies inside the field, within its own extent
    for (const m of manualItems) {
      if (!Number.isFinite(m.pos)) continue;
      const lo = m.from === null ? -Infinity : Math.min(m.from, m.to ?? Infinity);
      const hi = m.to === null ? Infinity : Math.max(m.to, m.from ?? -Infinity);
      for (const [a, b] of stripIntervals(m.pos)) {
        const y0 = Math.max(a, lo);
        const y1 = Math.min(b, hi);
        if (y1 - y0 >= 50) bandBreakers.push({ xc: m.pos, y0, y1, aligned: false, id: m.id, manual: true });
      }
    }
  } else if (ctx.breakerBoards) {
    const autoKey = JSON.stringify([fieldPoly, strip, bw, gap, maxBoard, ctx.deckingStockLengths, ctx.deckingMaxStock, ctx.kerf, rules.boardEndAllowance, rules.minBoardPiece, rules.breakerMinSaving, params.breakerCount, bayJoistSpacing]);
    const known = autoBreakerCache.get(autoKey);
    if (known) {
      for (const b of known.breakers) bandBreakers.push({ ...b });
      breakerSaving.push(...known.saving);
    } else {
      const fE = edges(fieldPoly);
      const ys = [...new Set(fieldPoly.map((p) => Math.round(p.y * 10) / 10))].sort((p, q) => p - q);
      const deckStocks = ctx.deckingStockLengths?.length ? ctx.deckingStockLengths : [ctx.deckingMaxStock];
      const bands: { y0: number; y1: number; x0: number; x1: number; rows: number }[] = [];
      for (let bi = 0; bi + 1 < ys.length; bi++) {
        const y0 = ys[bi];
        const y1 = ys[bi + 1];
        if (y1 - y0 < 1) continue;
        for (const [x0, x1] of clipHorizontal(fieldPoly, (y0 + y1) / 2)) {
          bands.push({ y0, y1, x0, x1, rows: Math.max(1, Math.round((y1 - y0) / (bw + gap))) });
          const len = x1 - x0;
          if (len <= maxBoard) continue;
          // an edge board line continued from an inside corner is weighed too (one breaker, off centre)
          const extra: { pieces: number[]; n: number }[] = [];
          for (const e of params.breakerCount === 'auto' ? fE : []) {
            if (e.axis !== 'y') continue;
            const ya = Math.min(e.a.y, e.b.y);
            const yb = Math.max(e.a.y, e.b.y);
            const touches = Math.abs(yb - y0) < 1 || Math.abs(ya - y1) < 1;
            if (!touches || e.a.x <= x0 + 1 || e.a.x >= x1 - 1) continue;
            const xc = e.a.x + e.outward.x * (gap + bw / 2);
            const left = xc - strip / 2 - x0;
            const right = x1 - (xc + strip / 2);
            if (left > maxBoard || right > maxBoard || left < rules.minBoardPiece || right < rules.minBoardPiece) continue;
            extra.push({ pieces: [left, right], n: 1 });
          }
          // the symmetric breakers that waste the least decking (a whole board, halves, thirds ...)
          const plan = bestBreakerSplit(
            {
              len, rows: Math.max(1, Math.round((y1 - y0) / (bw + gap))), bandWidth: y1 - y0, strip,
              stocks: deckStocks,
              allowance: rules.boardEndAllowance, kerf: ctx.kerf, minPiece: rules.minBoardPiece,
              count: params.breakerCount, extraBreakerBoards: rules.breakerMinSaving ?? 2, joistSpacing: bayJoistSpacing,
            },
            extra,
          );
          if (!plan) continue;
          if (plan.better) breakerSaving.push({ n: plan.better.n, saving: plan.better.boards });
          const aligned = !!plan.extra;
          let cursor = x0;
          for (let k = 0; k < plan.n; k++) {
            cursor += plan.pieces[k];
            bandBreakers.push({ xc: cursor + strip / 2, y0, y1, aligned, id: '', manual: false });
            cursor += strip;
          }
        }
      }
      // a breaker carries on across the shorter rows beside it, on to the edge board, wherever that buys no more
      // decking: it ends at an edge board rather than in the middle of the floor, and short runs it splits often
      // nest better (a 2.9 m run takes a whole board; 1.4 and 1.3 m pieces go three and four to a board)
      extendBreakers(bandBreakers, bands, strip, maxBoard, rules.minBoardPiece, deckStocks, rules.boardEndAllowance, ctx.kerf);
      if (autoBreakerCache.size > 200) autoBreakerCache.clear();
      autoBreakerCache.set(autoKey, { breakers: bandBreakers.map((b) => ({ ...b })), saving: breakerSaving.map((x) => ({ ...x })) });
    }
  }
  if (breakerSaving.length) {
    const n = Math.max(...breakerSaving.map((b) => b.n));
    const saving = breakerSaving.reduce((s, b) => s + b.saving, 0);
    warnings.push({ severity: 'info', key: 'layout.breakerSaving', params: { n, saving } });
  }
  // merge breakers that continue across band boundaries at the same position
  bandBreakers.sort((p, q) => p.xc - q.xc || p.y0 - q.y0);
  const breakerRuns: BandBreaker[] = [];
  for (const b of bandBreakers) {
    const last = breakerRuns[breakerRuns.length - 1];
    if (last && last.id === b.id && Math.abs(last.xc - b.xc) < 1 && Math.abs(last.y1 - b.y0) < 1) {
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

  // ---- board rows, and where each breaker ends ----
  const pitch = bw + gap;
  const fbb = bbox(fieldPoly);
  const houseAtBottom = houseX.length > 0 && Math.abs(E[houseX[0]].a.y - bb.maxY) < 1;
  // row 1 starts at the house wall when the boards are laid from it, else at the far edge board
  const startsAtHouse = houseAtBottom || houseX.some((i) => Math.abs(E[i].a.y - bb.minY) < 1);
  const rowBounds = (y: number): [number, number] | null => {
    let top: number;
    let bot: number;
    if (!houseAtBottom) {
      top = fbb.minY + Math.floor((y - fbb.minY) / pitch) * pitch;
      bot = Math.min(top + bw, fbb.maxY);
    } else {
      bot = fbb.maxY - Math.floor((fbb.maxY - y) / pitch) * pitch;
      top = Math.max(bot - bw, fbb.minY);
    }
    return y > top + 0.5 && y < bot - 0.5 ? [top, bot] : null;
  };
  const touchesField = (x0: number, x1: number, y: number): boolean => clipHorizontal(fieldPoly, y).some(([a, c]) => Math.min(c, x1) - Math.max(a, x0) > 1);
  const clearOfOthers = (b: BandBreaker, y0: number, y1: number): boolean => breakerRuns.every((o) => o === b || Math.abs(o.xc - b.xc) >= strip || o.y1 <= y0 + 0.5 || o.y0 >= y1 - 0.5);
  const fullRunLength = (r: [number, number], xc: number): number => {
    const t0 = clipHorizontal(fieldPoly, r[0] + 0.5);
    const b0 = clipHorizontal(fieldPoly, r[1] - 0.5);
    for (const [a, b] of t0) for (const [c, d] of b0) {
      const lo = Math.max(a, c);
      const hi = Math.min(b, d);
      if (hi - lo > 1 && xc >= lo && xc <= hi) return hi - lo;
    }
    return 0;
  };
  // A breaker that ends part-way through a board row is moved, so the row's boards stop at it instead of
  // overlapping it or leaving a hole:
  // - the field goes on under the whole strip to the row's edge: the breaker runs on through the row only when
  //   that row's board would otherwise be longer than a board, else it stops at the row (the board passes it);
  // - the field stops inside the row (an edge board): the breaker runs to it;
  // - the field goes on under part of the strip only (the side of a notch runs through it): the breaker stops
  //   at the row before, and that row runs through whole.
  for (const b of breakerRuns) {
    for (const end of ['y0', 'y1'] as const) {
      const y = b[end];
      const r = rowBounds(y);
      if (!r) continue;
      const outward = end === 'y0' ? r[0] : r[1];
      const inward = end === 'y0' ? r[1] : r[0];
      // how far beyond this end the whole strip stays inside the field
      const iv = stripIntervals(b.xc).find(([a, c]) => y >= a - 1 && y <= c + 1);
      const fe = iv ? (end === 'y0' ? iv[0] : iv[1]) : y;
      if (end === 'y0' ? fe <= outward + 0.5 : fe >= outward - 0.5) {
        const through = fullRunLength(r, b.xc) > maxBoard && clearOfOthers(b, Math.min(y, outward), Math.max(y, outward));
        b[end] = through ? outward : inward;
      } else if (touchesField(b.xc - strip / 2, b.xc + strip / 2, (fe + outward) / 2)) b[end] = inward;
      else b[end] = fe;
    }
  }
  // a run that came to nothing (a breaker shorter than a row) is dropped, before it is given joists or an id
  for (let i = breakerRuns.length - 1; i >= 0; i--) if (breakerRuns[i].y1 - breakerRuns[i].y0 < 50) breakerRuns.splice(i, 1);
  breakerRuns.forEach((b, i) => {
    if (!b.manual) b.id = `B${i + 1}`;
  });

  // ---- joist positions along x: edge joists, double joists under the edge board joint, then even fill per bay ----
  const fixedXs: { x: number; kind: JoistKind }[] = [];
  for (const e of E) {
    if (e.axis !== 'y') continue;
    fixedXs.push({ x: e.a.x - e.outward.x * (jt / 2), kind: 'edge' });
    if (edgeBoardOn && rules.frameJoist && exposed(e)) {
      // a pair of joists touching each other, the joint (edge board width + gap from the edge) falls between them
      const joint = e.a.x - e.outward.x * (ebw + gap);
      fixedXs.push({ x: joint - jt / 2, kind: 'frame' });
      fixedXs.push({ x: joint + jt / 2, kind: 'frame' });
    }
  }
  // a breaker board is carried by one joist under each of its two joints: centred on the gap, so the
  // joist takes the breaker edge on one half and the field board ends on the other. Where joists
  // already there give both their bearing (an edge board line at an inside corner) nothing is added;
  // where a new joist would overlap an existing one it is moved to touch it on the far side.
  const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  for (const b of breakerRuns) {
    for (const s of [-1, 1]) {
      // this side's half of the breaker, and the first joist width of the field boards beyond the gap
      const breakerLo = s > 0 ? b.xc : b.xc - bw / 2;
      const breakerHi = s > 0 ? b.xc + bw / 2 : b.xc;
      const endLine = b.xc + s * (bw / 2 + gap);
      const boardLo = s > 0 ? endLine : endLine - jt;
      const boardHi = s > 0 ? endLine + jt : endLine;
      let breakerOk = false;
      let boardOk = false;
      for (const f of fixedXs) {
        if (f.kind !== 'edge' && f.kind !== 'frame') continue;
        const j0 = f.x - jt / 2;
        const j1 = f.x + jt / 2;
        if (overlap(j0, j1, breakerLo, breakerHi) >= 15) breakerOk = true;
        if (overlap(j0, j1, boardLo, boardHi) >= 15) boardOk = true;
      }
      if (breakerOk && boardOk) continue;
      let x = b.xc + s * (bw / 2 + gap / 2);
      // when a joist is in the way, go to the side whose bearing is still missing
      const towards = boardOk && !breakerOk ? -s : s;
      for (let guard = 0; guard < 4; guard++) {
        const clash = fixedXs.find((f) => Math.abs(f.x - x) < jt - 0.5);
        if (!clash) break;
        x = clash.x + towards * jt;
      }
      fixedXs.push({ x, kind: 'frame' });
    }
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
  const joistXs: { x: number; kind: JoistKind }[] = [];
  const joistBays: JoistBay[] = [];
  for (let i = 0; i < fixedSorted.length; i++) {
    joistXs.push(fixedSorted[i]);
    if (i + 1 < fixedSorted.length) {
      const x0 = fixedSorted[i].x;
      const x1 = fixedSorted[i + 1].x;
      const w = x1 - x0;
      const xs: number[] = [];
      if (ctx.joistSetout) {
        // set out at exact centres from the start of the bay; whatever is left over is the last space
        for (let x = x0 + setoutSpacing; x < x1 - 0.5; x += setoutSpacing) xs.push(x);
        // a mark that lands on the next joist cannot take a joist of its own: that one goes hard against it
        if (xs.length && x1 - xs[xs.length - 1] < jt) xs[xs.length - 1] = x1 - jt;
      } else {
        const n = joistSpaces(w, params, rules, spacingCap);
        for (let k = 1; k < n; k++) xs.push(x0 + (w * k) / n);
      }
      for (const x of xs) joistXs.push({ x, kind: 'field' });
      // the edge-to-frame double is structural, not a spacing bay
      if (w > 200) {
        const pts = [x0, ...xs, x1];
        const spaces = pts.slice(1).map((x, k) => x - pts[k]);
        joistBays.push({ from: x0, to: x1, count: spaces.length, spacing: Math.max(...spaces), spaces });
      }
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
  const bearerJobs: { index: number; xs: number; xe: number; postXs: number[]; onWall: boolean }[] = [];
  lines.forEach((line, li) => {
    const prevGap = li > 0 ? line.pos - lines[li - 1].pos : line.pos - bb.minY;
    const nextGap = li + 1 < lines.length ? lines[li + 1].pos - line.pos : bb.maxY - line.pos;
    const flw = (prevGap + nextGap) / 2;
    const bs = bearerMaxSpan(rules, params.bearerProductId, params.bearerLaminations, flw);
    if (bs.extrapolated && !warnings.some((w) => w.key === 'layout.bearerSpanExtrapolated')) {
      warnings.push({ severity: 'warn', key: 'layout.bearerSpanExtrapolated' });
    }
    const maxSpan = Math.max(300, Math.floor((bs.span * factor) / 10) * 10);
    // a wall bearer only exists where there is a wall (every house edge whose wall line is this line);
    // beyond the walls the same line gets a normal bearer on posts. The pieces abut at the split, so a
    // joist ending there keeps its bearing; only the outer ends are inset from the deck edge
    interface BearerSeg { iv: [number, number]; wall: boolean; edgeIndex?: number; insetS: boolean; insetE: boolean }
    const wallRanges =
      line.kind === 'wall'
        ? houseX
            .map((i) => E[i])
            .filter((e) => Math.abs(e.a.y - e.outward.y * (ctx.bearerWidth / 2) - line.pos) < 1)
            .map((e) => ({ x0: Math.min(e.a.x, e.b.x), x1: Math.max(e.a.x, e.b.x), index: e.index }))
            .sort((p, q) => p.x0 - q.x0)
        : [];
    const segs: BearerSeg[] = [];
    for (const iv of clipHorizontal(poly, line.pos)) {
      const mine: BearerSeg[] = [];
      let cursor = iv[0];
      for (const w of wallRanges) {
        let a = Math.max(cursor, w.x0);
        const b = Math.min(iv[1], w.x1);
        if (b - a <= 200) continue;
        if (a - cursor > 200) mine.push({ iv: [cursor, a], wall: false, insetS: false, insetE: false });
        else a = cursor; // a stub shorter than 200 rides on the wall bearer
        mine.push({ iv: [a, b], wall: true, edgeIndex: w.index, insetS: false, insetE: false });
        cursor = b;
      }
      if (!mine.length) mine.push({ iv, wall: false, insetS: false, insetE: false });
      else if (iv[1] - cursor > 200) mine.push({ iv: [cursor, iv[1]], wall: false, insetS: false, insetE: false });
      else mine[mine.length - 1].iv[1] = iv[1];
      mine[0].insetS = true;
      mine[mine.length - 1].insetE = true;
      segs.push(...mine);
    }
    for (const { iv, wall, edgeIndex, insetS, insetE } of segs) {
      const [x0, x1] = iv;
      const onWall = wall;
      const xs = x0 + (insetS ? rules.bearerEndInset : 0);
      const xe = x1 - (insetE ? rules.bearerEndInset : 0);
      const length = xe - xs;
      if (length < 200) continue;
      const houseStart = onHouseVertical(x0, line.pos);
      const houseEnd = onHouseVertical(x1, line.pos);
      // a bearer end sits fully on its stump (the stump's outer face under the bearer end); at a house wall
      // the stump keeps the house inset clear of the wall footing
      const endSet = (ctx.postWidth ?? 100) / 2 + rules.postEndSetback;
      const sbS = houseStart ? rules.houseBearerInset : endSet;
      const sbE = houseEnd ? rules.houseBearerInset : endSet;
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
      // pieces are cut once the stock length is chosen (below), from these
      bearerJobs.push({ index: bearers.length, xs, xe, postXs, onWall });
      if (onWall) {
        ledgers.push({
          edgeIndex: edgeIndex ?? line.edgeIndex ?? -1,
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
        pieces: [],
        splices: [],
        flw,
        maxSpan,
        postSpacing,
        houseStart,
        houseEnd,
      });
    }
  });
  // ---- stumps on one grid: a bearer takes the stump positions already set out on the longer bearers wherever
  //      that needs no more stumps, so one string line serves every bearer it crosses ----
  {
    const grid: number[] = [];
    const order = bearers
      .map((_, i) => i)
      .filter((i) => !bearers[i].onWall)
      .sort((a, b) => bearers[b].length - bearers[a].length);
    for (const i of order) {
      const b = bearers[i];
      const even = b.posts.map((q) => q.x);
      if (even.length > 2) {
        const p0 = even[0];
        const p1 = even[even.length - 1];
        // grid lines clear of this bearer's end stumps
        const cands = grid.filter((g) => g > p0 + 300 && g < p1 - 300).sort((u, v) => u - v);
        const aligned = [p0];
        let cur = p0;
        while (p1 - cur > b.maxSpan + 0.5) {
          const next = cands.filter((g) => g > cur + 1 && g <= cur + b.maxSpan + 0.5).pop();
          if (next === undefined) break;
          aligned.push(next);
          cur = next;
        }
        if (p1 - cur <= b.maxSpan + 0.5 && aligned.length + 1 <= even.length) {
          aligned.push(p1);
          b.posts = aligned.map((x) => ({ x, y: b.seg.a.y }));
          b.postSpacing = Math.max(...aligned.slice(1).map((x, k) => x - aligned[k]));
          const job = bearerJobs.find((j) => j.index === i);
          if (job) job.postXs = aligned;
        }
      }
      for (const q of b.posts) if (!grid.some((g) => Math.abs(g - q.x) < 1)) grid.push(q.x);
    }
    maxBearerSpanUsed = bearers.reduce((m, b) => Math.max(m, b.postSpacing), 0);
  }
  if (planOnly) {
    let joistLm = 0;
    for (const c of joistXs) for (const [a, b] of clipVertical(poly, c.x)) joistLm += b - a;
    let crossings = 0;
    for (const b of bearers) crossings += joistXs.filter((c) => c.x >= Math.min(b.seg.a.x, b.seg.b.x) - 1 && c.x <= Math.max(b.seg.a.x, b.seg.b.x) + 1).length;
    const lineCount = new Set(bearers.map((b) => b.lineIndex)).size;
    return {
      posts: bearers.reduce((n, b) => n + b.posts.length, 0),
      bearerLm: bearers.reduce((n, b) => n + b.length, 0),
      braceUnits: bearers.reduce((n, b) => n + Math.max(0, Math.ceil((b.posts.length - 1) / 2)), 0) + Math.max(0, lineCount - 1),
      maxBearerSpanUsed,
      joistLm,
      crossings,
    };
  }

  // ---- bearer pieces: a join only over a stump, the two pieces half each; the two laminations join over
  //      different stumps. The fewest joins (pieces up to the longest stick), at the stumps whose pieces cut
  //      cleanly from the stocked lengths; the cut list may mix lengths ----
  const allowance = rules.joistEndAllowance;
  const bStocks = [...new Set(ctx.bearerStockLengths?.length ? ctx.bearerStockLengths : [ctx.bearerMaxStock])].sort((p, q) => p - q);
  const bMaxLen = bStocks[bStocks.length - 1] - allowance;
  type Ply = { pieces: number[]; joins: number[]; off: boolean };
  // a wall bearer can join anywhere: where a piece is a whole stick (or two) from either end
  const wallSpots = (from: number, to: number): number[] => {
    const use = bStocks.map((L) => L - allowance);
    const out: number[] = [];
    for (const u of use) {
      out.push(from + u, to - u);
      for (const v of use) out.push(from + u + v, to - u - v);
    }
    return out;
  };
  /** the plies of a bearer: 'stocked' as a carpenter would (above), or greedily with the longest pieces up to maxLen */
  const splitBearer = (job: (typeof bearerJobs)[number], mode: 'stocked' | number): Ply[] => {
    const sup = job.onWall ? [] : job.postXs;
    const maxLen = mode === 'stocked' ? bMaxLen : mode;
    const a =
      (mode === 'stocked' ? splitRunStocked(job.xs, job.xe, job.onWall ? wallSpots(job.xs, job.xe) : sup, bStocks, allowance, rules.kerf, 600) : null) ??
      splitRun(job.xs, job.xe, sup, maxLen, 600);
    const plies: Ply[] = [{ pieces: a.pieces, joins: a.joins, off: a.offSupport && !job.onWall }];
    if (params.bearerLaminations === 2) {
      const len = job.xe - job.xs;
      // the second lamination is listed from the bearer's far end
      const fromEnd = sup.map((p) => job.xe - p);
      // on stumps the two laminations never join over the same stump; on the wall, where any spot will do, their
      // joins are at least a bolt spacing apart
      const apart = job.onWall ? rules.ledgerBoltSpacing : 1;
      const clash = (r: { joins: number[] }) => r.joins.some((j) => a.joins.some((k) => Math.abs(j - k) < apart));
      if (mode === 'stocked') {
        const spots = job.onWall ? [...wallSpots(0, len), ...a.joins.flatMap((k) => [job.xe - k - apart - 1, job.xe - k + apart + 1])] : fromEnd;
        const r = splitRunStocked(0, len, spots, bStocks, allowance, rules.kerf, 600, (d) => a.joins.some((k) => Math.abs(job.xe - d - k) < apart));
        if (r) {
          plies.push({ pieces: r.pieces, joins: r.joins.map((j) => job.xe - j), off: false });
          return plies;
        }
      }
      const rev = (firstTarget?: number) => {
        const r = splitRun(0, len, fromEnd, maxLen, 600, firstTarget);
        return { pieces: r.pieces, joins: r.joins.map((j) => job.xe - j), off: r.offSupport && !job.onWall };
      };
      let b = rev();
      if (clash(b)) {
        // the second lamination's first join moves back a stump (on the wall: to clear the first's joins) until
        // no join is too close to one of the first's
        const firsts = job.onWall ? a.joins.flatMap((k) => [job.xe - k - apart - 1, job.xe - k + apart + 1]) : fromEnd;
        for (const dist of firsts.filter((x) => x > 600 && x <= maxLen).sort((p, q) => q - p)) {
          const r = rev(dist + 0.5);
          if (!clash(r) && !r.off) {
            b = r;
            break;
          }
        }
      }
      plies.push(b);
    }
    return plies;
  };
  // the carpenter's split and the greedy one with each stick as the longest piece: the fewest joins, then the
  // least timber bought
  let bearerMode: 'stocked' | number = bMaxLen;
  let bearerScore = Infinity;
  const bSeen = new Set<string>();
  for (const mode of ['stocked' as const, ...bStocks.map((L) => L - allowance).reverse()]) {
    const pcs: number[] = [];
    let ok = true;
    let joins = 0;
    const key: string[] = [];
    for (const job of bearerJobs) {
      for (const ply of splitBearer(job, mode)) {
        if (ply.off) ok = false;
        joins += ply.joins.length;
        pcs.push(...ply.pieces.map((p) => p + allowance));
        key.push(ply.joins.map((j) => Math.round(j)).join(','));
      }
    }
    // a split already weighed (the same joins) is not packed again
    if (!ok || bSeen.has(key.join('|'))) continue;
    bSeen.add(key.join('|'));
    const score = joins * 1e7 + packedLength(pcs, bStocks, rules.kerf);
    if (score < bearerScore - 0.5) {
      bearerScore = score;
      bearerMode = mode;
    }
  }
  let bearerJoinOffPost = false;
  for (const job of bearerJobs) {
    const plies = splitBearer(job, bearerMode);
    bearers[job.index].pieces = plies.map((p) => p.pieces.map((x) => x + rules.joistEndAllowance));
    bearers[job.index].splices = plies.map((p) => p.joins);
    if (plies.some((p) => p.off)) bearerJoinOffPost = true;
  }
  if (bearerJoinOffPost) warnings.push({ severity: 'warn', key: 'layout.bearerJoinOffPost' });

  // ---- joists ----
  const bearerPositions = lines.map((l) => l.pos);
  const ledgerPositions: number[] = [];
  const allSupports = lines.map((l) => l.pos).sort((p, q) => p - q);
  const joists: JoistRun[] = [];
  let joistCounter = 0;
  let totalHangers = 0;
  let joistBearerCrossings = 0;
  let offSupportJoins = false;
  let joistJoinOffBearer = false;
  let frameJoists = 0;
  // joist runs; outside flush framing a run longer than a stick is joined only over a bearer (the two pieces
  // half each), every end landing on a bearer: the fewest joins (pieces up to the longest stick), over the
  // bearers whose pieces cut cleanly from the stocked lengths (two 2.5 m joists from a 5.4)
  const jruns: { c: { x: number; kind: JoistKind }; y0: number; y1: number }[] = [];
  for (const c of joistXs) for (const [y0, y1] of clipVertical(poly, c.x)) if (y1 - y0 >= 100) jruns.push({ c, y0, y1 });
  const jStocks = [...new Set(ctx.joistStockLengths?.length ? ctx.joistStockLengths : [ctx.joistMaxStock])].sort((p, q) => p - q);
  const jMaxLen = jStocks[jStocks.length - 1] - rules.joistEndAllowance;
  /** a joist run's pieces: 'stocked' as a carpenter would (above), or greedily with the longest pieces up to maxLen */
  const splitJoist = (y0: number, y1: number, mode: 'stocked' | number) => {
    const sup = bearerPositions.filter((p) => p > y0 && p < y1);
    if (mode === 'stocked') return splitRunStocked(y0, y1, sup, jStocks, rules.joistEndAllowance, rules.kerf, 600) ?? splitRun(y0, y1, sup, jMaxLen, 600);
    return splitRun(y0, y1, sup, mode, 600);
  };
  let joistMode: 'stocked' | number = jMaxLen;
  if (!ctx.flush) {
    // bearers of the same timber are cut from the same sticks
    const shared = ctx.sameTimber ? bearers.flatMap((b) => b.pieces.flat()) : [];
    let jScore = Infinity;
    const jSeen = new Set<string>();
    for (const mode of ['stocked' as const, ...jStocks.map((L) => L - rules.joistEndAllowance).reverse()]) {
      const pcs: number[] = [];
      let ok = true;
      let joins = 0;
      const key: string[] = [];
      for (const r of jruns) {
        const s = splitJoist(r.y0, r.y1, mode);
        if (s.offSupport) {
          ok = false;
          break;
        }
        joins += s.joins.length;
        pcs.push(...s.pieces.map((p) => p + rules.joistEndAllowance));
        key.push(s.joins.map((j) => Math.round(j)).join(','));
      }
      if (!ok || jSeen.has(key.join('|'))) continue;
      jSeen.add(key.join('|'));
      // fewest joins first (a joist that fits one stick is never joined), then the least timber bought
      const score = joins * 1e7 + packedLength([...shared, ...pcs], jStocks, rules.kerf);
      if (score < jScore - 0.5) {
        jScore = score;
        joistMode = mode;
      }
    }
  }
  for (const r of jruns) {
    const c = r.c;
    {
      const y0 = r.y0;
      const y1 = r.y1;
      const length = y1 - y0;
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
      const split = splitJoist(y0, y1, joistMode);
      if (split.offSupport) joistJoinOffBearer = true;
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
  if (joistJoinOffBearer) warnings.push({ severity: 'warn', key: 'layout.joistJoinOffBearer' });
  for (const l of ledgers) l.hangers = ctx.flush ? joists.filter((j) => Math.abs(j.seg.a.y - l.seg.a.y) < 1 || Math.abs(j.seg.b.y - l.seg.a.y) < 1).length : 0;
  const joistPositions = joistXs.map((c) => c.x);

  // ---- field boards (inside the picture frame when edge boards are on) ----
  const boards: BoardRow[] = [];
  let boardLm = 0;
  let boardJoins = 0;
  let screws = 0;
  // a piece of board this short or shorter is taken up by the gaps; anything longer is laid (and shown), never
  // left as a hole in the deck
  const minPiece = 10;
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
          if (s0 - a > minPiece) next.push([a, s0]);
          if (c - s1 > minPiece) next.push([s1, c]);
        }
      }
      parts = next;
    }
    return parts;
  };
  const subtract = (ivs: [number, number][], cuts: [number, number][]): [number, number][] => {
    let out = ivs;
    for (const [c0, c1] of cuts) {
      const next: [number, number][] = [];
      for (const [a, b] of out) {
        if (c1 <= a || c0 >= b) next.push([a, b]);
        else {
          if (c0 - a > 1) next.push([a, c0]);
          if (b - c1 > 1) next.push([c1, b]);
        }
      }
      out = next;
    }
    return out;
  };
  // horizontal lines of the field between which a board row may have to be ripped (notch lines)
  const levelYs = [...new Set(fieldPoly.map((p) => Math.round(p.y * 10) / 10))].sort((p, q) => p - q);
  const makeRun = (x0: number, x1: number, yc: number, width: number, ripped: boolean, k: number): BoardRun | null => {
    const length = x1 - x0;
    if (length <= minPiece) return null;
    const J = joistPositions.filter((x) => x > x0 - 1 && x < x1 + 1);
    const inner = joistPositions.filter((x) => x > x0 + rules.minBoardPiece && x < x1 - rules.minBoardPiece);
    const firstTarget = Math.max(rules.minBoardPiece + 1, maxBoard - (k % 3) * rules.staggerOffset);
    const split = splitRun(x0, x1, inner, maxBoard, rules.minBoardPiece, firstTarget);
    const joins = split.joins.length;
    const runScrews = (J.length + joins) * rules.screwsPerCrossing;
    boardLm += length;
    boardJoins += joins;
    screws += runScrews;
    return {
      seg: { a: { x: x0, y: yc }, b: { x: x1, y: yc } },
      length,
      pieces: split.pieces.map((p) => p + rules.boardEndAllowance),
      joins: split.joins,
      crossings: J.length,
      screws: runScrews,
      width,
      ripped,
    };
  };
  for (let k = 0; k < 2000; k++) {
    let top: number;
    let visible: number;
    if (!houseAtBottom) {
      top = fbb.minY + k * pitch;
      if (top >= fbb.maxY - 1) break;
      visible = Math.min(bw, fbb.maxY - top);
    } else {
      const bottom = fbb.maxY - k * pitch;
      if (bottom <= fbb.minY + 1) break;
      visible = Math.min(bw, bottom - fbb.minY);
      top = bottom - visible;
    }
    // a sliver thinner than 40 mm is absorbed by the gaps rather than cut
    if (visible < 40) break;
    const bot = top + visible;
    const yc = top + visible / 2;
    const rowRipped = visible < bw - 1;
    const inside = levelYs.filter((y) => y > top + 0.5 && y < bot - 0.5);
    const runs: BoardRun[] = [];
    if (!inside.length) {
      for (const [x0, x1] of clipHorizontal(fieldPoly, yc).flatMap((iv) => splitAtBreakers(iv, yc))) {
        const r = makeRun(x0, x1, yc, visible, rowRipped, k);
        if (r) runs.push(r);
      }
    } else {
      // the row crosses a notch line: full boards where the whole width is inside, ripped strips elsewhere
      const full = (() => {
        const t0 = clipHorizontal(fieldPoly, top + 0.5);
        const b0 = clipHorizontal(fieldPoly, bot - 0.5);
        const out: [number, number][] = [];
        for (const [a, b] of t0) for (const [c, d] of b0) if (Math.min(b, d) - Math.max(a, c) > 1) out.push([Math.max(a, c), Math.min(b, d)]);
        return out;
      })();
      for (const [x0, x1] of full.flatMap((iv) => splitAtBreakers(iv, yc))) {
        const r = makeRun(x0, x1, yc, visible, rowRipped, k);
        if (r) runs.push(r);
      }
      const bounds = [top, ...inside, bot];
      for (let i = 0; i + 1 < bounds.length; i++) {
        const pa = bounds[i];
        const pb = bounds[i + 1];
        // a strip thinner than 40 mm is absorbed by the gaps rather than ripped (same rule as the last row)
        if (pb - pa < 40) continue;
        const pc = (pa + pb) / 2;
        const partial = subtract(clipHorizontal(fieldPoly, pc), full);
        for (const [x0, x1] of partial.flatMap((iv) => splitAtBreakers(iv, pc))) {
          const r = makeRun(x0, x1, pc, pb - pa, true, k);
          if (r) runs.push(r);
        }
      }
    }
    if (!runs.length) continue;
    boards.push({ index: k, pos: yc, width: visible, ripped: rowRipped, runs });
  }
  if (offSupportJoins) warnings.push({ severity: 'info', key: 'layout.joinOffSupport' });
  // a breaker hard up to the edge or to another breaker leaves no board between; a little way off it leaves a
  // sliver that is hard to fix down: say so, so the breaker can be moved
  {
    let n = 0;
    let shortest = Infinity;
    for (const row of boards) for (const run of row.runs) {
      if (run.length >= 100) continue;
      const x0 = Math.min(run.seg.a.x, run.seg.b.x);
      const x1 = Math.max(run.seg.a.x, run.seg.b.x);
      const yc = run.seg.a.y;
      const abuts = breakerRuns.some((b) => yc >= b.y0 - 0.5 && yc <= b.y1 + 0.5 && (Math.abs(x1 - (b.xc - strip / 2)) < 1 || Math.abs(x0 - (b.xc + strip / 2)) < 1));
      if (!abuts) continue;
      n++;
      shortest = Math.min(shortest, run.length);
    }
    if (n) warnings.push({ severity: 'warn', key: 'layout.breakerShortPiece', params: { n, len: Math.round(shortest) } });
  }
  // hand-placed breakers that leave a run longer than one board: those rows need joins
  if (manualItems && boardJoins > 0) warnings.push({ severity: 'warn', key: 'layout.breakerJoins', params: { n: boardJoins } });
  const ripMap = new Map<string, RipInfo>();
  for (const row of boards) for (const run of row.runs) {
    if (!run.ripped) continue;
    const w = Math.round(run.width);
    const key = `${row.index}|${w}`;
    const cur = ripMap.get(key) ?? { row: row.index + 1, width: w, boards: 0 };
    cur.boards += run.pieces.length;
    ripMap.set(key, cur);
  }
  const rips = [...ripMap.values()].sort((p, q) => p.row - q.row);
  for (const r of rips) warnings.push({ severity: 'info', key: 'layout.rip', params: { row: r.row, width: r.width, n: r.boards } });
  const lastRow = boards[boards.length - 1];
  if (lastRow && lastRow.ripped && lastRow.width < bw / 2) warnings.push({ severity: 'warn', key: 'layout.narrowRip', params: { width: Math.round(lastRow.width) } });

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
      const extra = (startCorner === 'concave' ? ebw : 0) + (endCorner === 'concave' ? ebw : 0);
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
        const split = splitRun(lo, hi, sup, maxEdge - extra, rules.minBoardPiece);
        pieces = [...split.pieces];
        // the mitre allowance at a concave corner belongs to the piece at that end
        const startIdx = e.dir.x > 0 ? 0 : pieces.length - 1;
        const endIdx = e.dir.x > 0 ? pieces.length - 1 : 0;
        if (startCorner === 'concave') pieces[startIdx] += ebw;
        if (endCorner === 'concave') pieces[endIdx] += ebw;
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
        width: ebw,
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
    const parts = Math.max(1, Math.ceil(length / maxBoard));
    const pieces = Array.from({ length: parts }, () => length / parts + rules.boardEndAllowance);
    const screws = (Math.floor(length / 450) + 1) * rules.screwsPerCrossing;
    breakerLm += length;
    breakerPieces += parts;
    breakerScrews += screws;
    breakers.push({ seg: { a: { x: b.xc, y: b.y0 }, b: { x: b.xc, y: b.y1 } }, width: bw, length, pieces, screws, aligned: b.aligned, id: b.id, manual: b.manual });
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
    startsAtHouse,
    breakerMode: manualItems ? 'manual' : 'auto',
    boardWidth: bw,
    boardGap: gap,
    rips,
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
