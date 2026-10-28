import { PEDESTAL_PRODUCTS, PRODUCT_MAP, POST_PRODUCTS, hangerFor, product, resolveProductId, stockLengthsOf } from '../model/catalog';
import type { FrameSizes, Product, Project, Pt, RuleSet } from '../model/types';
import { designBalustrade, type BalustradeDesign } from './balustrade';
import { buildBom, type BomResult, type CountItem, type Piece } from './bom';
import { assessCompliance, type Pathway } from './compliance';
import { splitRun } from './cutlist';
import { bbox, clipHorizontal, edges, normalizePolygon, perimeter, polygonAreaMm2, validatePolygon, type BBox, type Edge, type PolygonProblem } from './geometry';
import { computeLayout, planFrame, type LayoutContext, type LayoutResult } from './layout';
import { buildMethod, type MethodStep } from './method';
import { designStair, type StairDesign } from './stairs';
import type { WarningItem } from './warnings';

export interface Levels {
  boardT: number;
  joistD: number;
  bearerD: number;
  joistTop: number;
  bearerTop: number;
  postTop: number;
  groundClearance: number;
}

export interface FootingInfo {
  count: number;
  type: 'stump' | 'stirrup' | 'slab';
  depth: number;
  diameter: number;
  padSize: number;
  padDepth: number;
  concreteM3: number;
  bags: number;
}

/** a slab under part of the deck: the deck's level above it, the pedestals' height under the joists, the pedestal that
 *  sets to it (null: none does) and how many */
export interface SlabInfo {
  id: string;
  height: number;
  pedestalHeight: number;
  productId: string | null;
  count: number;
  /** of them, on pads poured beside the slab (the deck runs past it by too little for a stump) */
  pads: number;
}

/** how much of the deck is over the slabs (m²): their outlines clipped to the deck, strip by strip */
function slabUnderDeck(poly: Pt[], slabs: Pt[][]): number {
  if (!slabs.length) return 0;
  const bb = bbox(poly);
  const step = 10;
  let mm2 = 0;
  for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
    const deck = clipHorizontal(poly, y);
    for (const s of slabs) for (const [a, b] of clipHorizontal(s, y)) for (const [c, d] of deck) mm2 += Math.max(0, Math.min(b, d) - Math.max(a, c)) * step;
  }
  return mm2 / 1e6;
}

/** one pad poured beside a slab for a pedestal (m³) */
const padVolume = (rules: RuleSet): number => ((rules.slabPadSize ?? 300) ** 2 * (rules.slabPadDepth ?? 200)) / 1e9;

/** the pedestal that sets to a height with the most room either way; null when none reaches it */
export function pedestalFor(height: number): string | null {
  let best: { id: string; room: number } | null = null;
  for (const p of PEDESTAL_PRODUCTS) {
    const room = Math.min(height - p.pedestal![0], p.pedestal![1] - height);
    if (room >= 0 && (!best || room > best.room)) best = { id: p.id, room };
  }
  return best?.id ?? null;
}

export interface FasciaRun {
  edgeIndex: number;
  length: number;
}

export interface DesignResult {
  ok: boolean;
  problem?: PolygonProblem;
  poly: Pt[];
  edges: Edge[];
  areaM2: number;
  perimeterM: number;
  bb: BBox;
  datum: Pt;
  layout: LayoutResult | null;
  levels: Levels;
  postProductId: string;
  postLength: number;
  stairs: StairDesign[];
  balustrade: BalustradeDesign;
  /** diagonal braces: how many, how long, and where on the plan (from stump to stump, or a stump to the wall bearer) */
  braces: { count: number; length: number; lines: { a: Pt; b: Pt }[] };
  footings: FootingInfo;
  /** the slabs under the deck, with their pedestals */
  slabs: SlabInfo[];
  fascia: FasciaRun[];
  fasciaProductId: string;
  /** product used for the picture-frame edge boards */
  edgeBoardProductId: string;
  /** joist spacing as built, e.g. "439" or "400-461" */
  joistSpacingText: string;
  /** largest joist spacing allowed (the decking's limit and the project cap) and the auto target */
  joistSpacingCap: number;
  joistSpacingTarget: number;
  /** joists set out at exact centres (fixed spacing, or composite by the company rule), short space last */
  joistSetout: boolean;
  joistSetoutSpacing: number;
  /** breaker boards are on for this decking (automatic for composite, or switched on); hand-placed ones apply only then */
  breakersOn: boolean;
  /** the frame used (sized automatically, or as set) */
  frame: FrameInfo;
  bom: BomResult;
  warnings: WarningItem[];
  pathway: Pathway;
  method: MethodStep[];
}

/** the fascia along the sides off the house when it is on: its runs, and the cuts each takes (a run longer than a
 *  board cut where the boards allow, as the fascia runs on past the joist ends) */
function fasciaCuts(project: Project, poly: Pt[], fasciaProductId: string): { runs: FasciaRun[]; cuts: number[] } {
  if (!project.params.fascia || poly.length < 4) return { runs: [], cuts: [] };
  const E = edges(poly);
  const runs = E.filter((e) => !project.houseEdges.includes(e.index)).map((e) => ({ edgeIndex: e.index, length: e.length }));
  const max = maxStock(fasciaProductId, project.rules) - project.rules.boardEndAllowance;
  return { runs, cuts: runs.flatMap((f) => splitRun(0, f.length, [], max, 300).pieces.map((len) => len + project.rules.boardEndAllowance)) };
}

/** the longest length a product is bought in (framing pine: of the yard's lengths) */
const maxStock = (id: string, rules: RuleSet): number => {
  const lengths = stockLengthsOf(product(id), rules);
  return lengths.length ? Math.max(...lengths) : 6000;
};

export interface FrameInfo {
  joistProductId: string;
  bearerProductId: string;
  bearerLaminations: 1 | 2;
  /** sized automatically (else as set in the settings) */
  auto: boolean;
  /** the company's standard frame */
  standard: boolean;
  /** another frame replaced the standard one: stumps with each, and what it saves (materials and stump labour) */
  standardStumps?: number;
  stumps?: number;
  saving?: number;
  /** none of the sizes to choose from fits under the deck: the standard frame is drawn anyway */
  noFit?: boolean;
}

/**
 * The deck's design. With automatic frame sizing the joists and bearers are chosen first: the most practical
 * frame is the cheapest one that meets the spans, counting the labour of every stump, and the company's
 * standard frame is kept unless another one saves more than the margin.
 */
export function computeDesign(project: Project): DesignResult {
  if (project.params.frameSizing === 'auto') return autoFrame(project);
  const p = project.params;
  return designWith(project, { joistProductId: p.joistProductId, bearerProductId: p.bearerProductId, bearerLaminations: p.bearerLaminations, auto: false, standard: false });
}

export function standardFrame(rules: RuleSet): FrameSizes {
  const f = rules.standardFrame;
  return f && PRODUCT_MAP[f.joist] && PRODUCT_MAP[f.bearer] ? f : { joist: 'tp-90x45', bearer: 'tp-140x45', laminations: 1 };
}
const sameFrame = (a: FrameSizes, b: FrameSizes): boolean => a.joist === b.joist && a.bearer === b.bearer && a.laminations === b.laminations;

/** every frame the sizes to choose from allow (joist and bearer sizes with span tables, single or double bearers) */
export function frameCandidates(rules: RuleSet): FrameSizes[] {
  const std = standardFrame(rules);
  const sizes = (rules.frameSizes?.length ? rules.frameSizes : [std.joist, std.bearer]).filter((id) => PRODUCT_MAP[id]);
  const out: FrameSizes[] = [std];
  for (const joist of sizes) {
    if (!rules.joistSpan[joist]) continue;
    for (const bearer of sizes) for (const laminations of [1, 2] as const) {
      if (!rules.bearerSpan[`${bearer}|${laminations}`]) continue;
      const f = { joist, bearer, laminations };
      if (!out.some((g) => sameFrame(g, f))) out.push(f);
    }
  }
  return out;
}

/** stumps, bearer lines, joists or their joins changed by hand */
export function frameEdited(d: Project['details']): boolean {
  if (!d) return false;
  return [d.stumpsOff, d.stumpsAdded, d.stumpsMoved, d.bearersOff, d.bearersAdded, d.bearersMoved, d.joistsOff, d.joistsAdded, d.joistsMoved, d.joistsDoubled, d.bearerJoins, d.joistJoinLines].some((list) => !!list?.length);
}

/** the frame chosen for a deck without its parts changed by hand, by everything else about it: the same while only
 *  those parts change (as they do one by one in detail mode) */
const frameCache = new Map<string, FrameInfo>();

function autoFrame(project: Project): DesignResult {
  // parts of the frame changed by hand tune the frame chosen, they do not choose it (a frame chosen again round them
  // would move the bearer lines and joists they are set out from): the frame is chosen without them, laid out with them
  const d = project.details;
  if (d && frameEdited(d)) {
    const plain = { ...project, details: d.noEdgeBoard?.length ? { noEdgeBoard: d.noEdgeBoard } : null };
    // (the frame chosen does not depend on hand edits to the order list)
    const key = JSON.stringify({ ...plain, order: null });
    let frame = frameCache.get(key);
    if (!frame) {
      frame = autoFrame(plain).frame;
      if (frameCache.size > 20) frameCache.clear();
      frameCache.set(key, frame);
    }
    return designWith({ ...project, params: { ...project.params, joistProductId: frame.joistProductId, bearerProductId: frame.bearerProductId, bearerLaminations: frame.bearerLaminations } }, frame);
  }
  const { rules } = project;
  const std = standardFrame(rules);
  const labour = rules.stumpLabour ?? 40;
  const sized = (f: FrameSizes, order = project.order): Project => ({ ...project, order, params: { ...project.params, joistProductId: f.joist, bearerProductId: f.bearer, bearerLaminations: f.laminations } });
  const info = (f: FrameSizes, extra: Partial<FrameInfo> = {}): FrameInfo => ({ joistProductId: f.joist, bearerProductId: f.bearer, bearerLaminations: f.laminations, auto: true, standard: sameFrame(f, std), ...extra });
  if (!validatePolygon(normalizePolygon(project.deck)).ok) return designWith(sized(std), info(std));
  // price every frame from a quick plan of its bearers and stumps
  let best: { f: FrameSizes; cost: number } | null = null;
  let stdFits = false;
  for (const f of frameCandidates(rules)) {
    const cost = estimateFrame(sized(f), labour);
    if (cost === null) continue;
    if (sameFrame(f, std)) stdFits = true;
    if (!best || cost < best.cost - 0.01) best = { f, cost };
  }
  if (!best) return designWith(sized(std), info(std, { noFit: true }));
  if (sameFrame(best.f, std)) return designWith(sized(std), info(std));
  // the full designs settle it (without hand edits to the order list, which belong to one frame)
  const total = (d: DesignResult) => d.bom.total + labour * (d.layout?.posts.length ?? 0);
  const other = designWith(sized(best.f, null), info(best.f));
  if (stdFits) {
    const standard = designWith(sized(std, null), info(std));
    const saving = total(standard) - total(other);
    if (!(saving > (rules.frameSwitchMargin ?? 100))) return project.order ? designWith(sized(std), info(std)) : standard;
    const frame = info(best.f, { standardStumps: standard.layout?.posts.length ?? 0, stumps: other.layout?.posts.length ?? 0, saving });
    return project.order ? designWith(sized(best.f), frame) : { ...other, frame };
  }
  // the standard frame does not fit under the deck: the cheapest one that does
  const frame = info(best.f, { stumps: other.layout?.posts.length ?? 0 });
  return project.order ? designWith(sized(best.f), frame) : { ...other, frame };
}

/** What a frame costs, from a plan of its bearers and stumps: timber, stumps with their concrete, hardware and
 *  labour, braces and joist fixings. null when the frame does not fit under the deck. */
function estimateFrame(project: Project, labour: number): number | null {
  const s = setup(project);
  if (!s.valid.ok || s.levels.groundClearance < s.rules.minGroundClearance) return null;
  // over a slab the joists stand on pedestals: a frame whose joists leave no pedestal height there does not fit
  const pedestalIds = (project.slabs ?? []).map((slab) => pedestalFor(slab.height - s.boardT - s.joistD));
  if (pedestalIds.some((id) => !id)) return null;
  const { params, rules } = s;
  const E = edges(s.poly);
  const houseEdges = project.houseEdges.filter((i) => i >= 0 && i < E.length);
  const plan = planFrame(s.poly, houseEdges, params, rules, s.ctx);
  const price = (id: string): number => {
    const v = project.prices[id];
    return typeof v === 'number' && Number.isFinite(v) ? v : PRODUCT_MAP[id]?.defaultPrice ?? 0;
  };
  const waste = 1 + params.wasteFramingPct / 100;
  let perStump = (s.postLength / 1000) * price(s.postProductId) + labour;
  if (params.footingType === 'stump') {
    const hole = Math.PI * (params.footingDiameter / 2) ** 2 * params.footingDepth;
    perStump += ((Math.max(0, hole - s.postW * s.postW * params.footingDepth) / 1e9) / rules.concreteBagYield) * price(s.concreteId);
  } else if (params.footingType === 'stirrup') {
    perStump += ((params.padSize * params.padSize * params.padDepth) / 1e9 / rules.concreteBagYield) * price(s.concreteId) + price('stirrup-hdg');
  }
  if (params.bearerToPost === 'bolted') perStump += rules.boltsPerPost * price('bolt-m12-hdg');
  else if (params.bearerToPost === 'screwed' || params.bearerToPost === 'checked') perStump += rules.battenScrewsPerPost * price('screw-batten-14gx100');
  else perStump += price('post-cap-hdg');
  let cost = (plan.joistLm / 1000) * price(s.joist.id) * waste + ((plan.bearerLm * params.bearerLaminations) / 1000) * price(s.bearer.id) * waste + plan.posts * perStump;
  if (s.levels.postTop > rules.braceHeight) {
    const bay = plan.maxBearerSpanUsed > 0 ? Math.min(1800, plan.maxBearerSpanUsed) : 1800;
    cost += plan.braceUnits * (((Math.hypot(bay, s.levels.postTop) + 200) / 1000) * price('tp-90x45') * waste + 2 * price('bolt-m12-hdg'));
  }
  plan.pedestals.forEach((n, k) => (cost += n * (price(pedestalIds[k]!) + (rules.pedestalScrews ?? 2) * price('screw-deck-10gx50'))));
  cost += ((plan.pads * padVolume(rules)) / rules.concreteBagYield) * price(s.concreteId);
  if (s.flush) cost += plan.crossings * 2 * (price(hangerFor(s.joist.id)) + rules.hangerNails * price('nail-75x3.05'));
  else if (params.joistFixing === 'tripleGrip') cost += plan.crossings * (price('triple-grip') + 6 * price('nail-30x2.8-galv'));
  else cost += plan.crossings * rules.skewNailsPerCrossing * price('nail-75x3.05');
  return cost;
}

/** what every design and every frame plan share: levels, spacing, the stump, and the layout settings */
function setup(project: Project) {
  const { params, rules } = project;
  const poly = normalizePolygon(project.deck);
  const valid = validatePolygon(poly);
  const decking = product(params.deckingProductId);
  const joist = product(params.joistProductId);
  const bearer = product(params.bearerProductId);
  const flush = params.joistConnection === 'flush';
  const boardT = decking.thickness ?? 19;
  const joistD = joist.depth ?? 140;
  const bearerD = bearer.depth ?? 140;
  const joistTop = params.deckHeight - boardT;
  // flush: joists hang between bearers with their tops level; on top: joists sit on bearers
  const bearerTop = flush ? joistTop : joistTop - joistD;
  const postTop = params.bearerToPost === 'onTop' ? bearerTop - bearerD : bearerTop;
  const groundClearance = flush ? joistTop - Math.max(joistD, bearerD) : bearerTop - bearerD;
  const levels: Levels = { boardT, joistD, bearerD, joistTop, bearerTop, postTop, groundClearance };
  const bearerWidth = params.bearerLaminations * (bearer.width ?? 45);
  const concreteId = resolveProductId(params.concreteProductId || 'concrete-mix-20kg');
  const maxTreadSpan = rules.deckingMaxJoistSpacing[decking.id] ?? decking.maxJoistSpacing ?? 450;
  const joistSpacingCap = Math.min(params.joistSpacingMax || 500, maxTreadSpan || 500);
  const joistSpacingTarget = Math.min(joistSpacingCap, rules.joistSpacingTarget || joistSpacingCap);
  // fixed spacing is set out from one end of each bay (never wider than the decking allows); composite follows
  // the company rule (set out at its cap)
  const joistSetout = params.joistSpacingMode === 'fixed' || (decking.family === 'composite' && rules.compositeJoistSetout !== false);
  const joistSetoutSpacing = params.joistSpacingMode === 'fixed' ? Math.min(params.joistSpacing, joistSpacingCap) : joistSpacingCap;
  const breakersOn = params.breakerBoards === 'on' || (params.breakerBoards === 'auto' && decking.family === 'composite');
  // ---- edge board product: the decking's solid-edge board, or the decking itself ----
  const edgeBoardProductId =
    params.edgeBoardProductId !== 'auto' && PRODUCT_MAP[resolveProductId(params.edgeBoardProductId)]
      ? resolveProductId(params.edgeBoardProductId)
      : decking.edgeBoardProductId && PRODUCT_MAP[decking.edgeBoardProductId] ? decking.edgeBoardProductId : decking.id;
  // the stump the bearers sit on (sized by height when automatic): a bearer end sits fully on it
  let postProductId = params.postProductId;
  if (postProductId === 'auto' || !PRODUCT_MAP[postProductId]) {
    const fit = POST_PRODUCTS.find((p) => (rules.postMaxHeight[p.id] ?? 0) >= postTop);
    postProductId = (fit ?? POST_PRODUCTS[POST_PRODUCTS.length - 1]).id;
  }
  const postW = product(postProductId).width ?? 90;
  const postLength =
    params.footingType === 'stump' ? Math.max(100, postTop + params.footingDepth)
    : params.footingType === 'stirrup' ? Math.max(100, postTop - rules.stirrupLift)
    : Math.max(50, postTop);
  // simple cutting (the company's rule): a stocked length more has to save its dollars in this timber
  const unitPrice = (id: string): number => {
    const v = project.prices[id];
    return typeof v === 'number' && Number.isFinite(v) ? v : PRODUCT_MAP[id]?.defaultPrice ?? 0;
  };
  const extraLength = (prod: Product): number => ((rules.extraLengthSaving ?? 50) / Math.max(1e-6, unitPrice(prod.id))) * 1000;
  // the edge boards' own board (not the decking): its cut is its own, with the fascia's when that is the same board
  const fasciaProductId = decking.fasciaProductId && PRODUCT_MAP[decking.fasciaProductId] ? decking.fasciaProductId : decking.id;
  const edgeBoardOwn = edgeBoardProductId !== decking.id;
  const d = project.details;
  const ctx: LayoutContext = {
    boardWidth: decking.width ?? 86,
    boardGap: params.boardGap,
    joistThickness: joist.width ?? 45,
    bearerWidth,
    bearerDepth: bearerD,
    flush,
    edgeBoard: params.edgeBoard,
    edgeBoardWidth: PRODUCT_MAP[edgeBoardProductId]?.width ?? decking.width ?? 86,
    breakerBoards: breakersOn,
    manualBreakers: project.breakers ?? null,
    joistSetout,
    joistSetoutSpacing,
    kerf: rules.kerf,
    deckingMaxJoistSpacing: maxTreadSpan,
    deckingMaxStock: maxStock(decking.id, rules),
    deckingStockLengths: stockLengthsOf(decking, rules),
    edgeBoardMaxStock: maxStock(edgeBoardProductId, rules),
    joistMaxStock: maxStock(joist.id, rules),
    bearerMaxStock: maxStock(bearer.id, rules),
    joistStockLengths: stockLengthsOf(joist, rules),
    bearerStockLengths: stockLengthsOf(bearer, rules),
    sameTimber: joist.id === bearer.id,
    postWidth: postW,
    simpleCutting: rules.cutting === 'cheapest' ? undefined : { joist: extraLength(joist), bearer: extraLength(bearer) },
    slabs: (project.slabs ?? []).map((s) => normalizePolygon(s.poly)),
    noEdgeBoard: project.details?.noEdgeBoard ?? [],
    stumpsOff: [...(project.details?.stumpsOff ?? []), ...(project.details?.stumpsMoved ?? []).map((m) => m.from)],
    stumpsAdded: [...(project.details?.stumpsAdded ?? []), ...(project.details?.stumpsMoved ?? []).map((m) => m.to)],
    linesOff: [...(project.details?.bearersOff ?? []), ...(project.details?.bearersMoved ?? []).map((m) => m.from)],
    linesAdded: [...(project.details?.bearersAdded ?? []), ...(project.details?.bearersMoved ?? []).map((m) => m.to)],
    joistsOff: [...(project.details?.joistsOff ?? []), ...(project.details?.joistsMoved ?? []).map((m) => m.from)],
    joistsAdded: [...(project.details?.joistsAdded ?? []), ...(project.details?.joistsMoved ?? []).map((m) => m.to)],
    joistsDoubled: project.details?.joistsDoubled ?? [],
    edgeBoardStockLengths: stockLengthsOf(product(edgeBoardProductId), rules),
    edgeBoardOwn,
    edgeBoardPool: edgeBoardOwn && valid.ok && fasciaProductId === edgeBoardProductId ? fasciaCuts(project, poly, fasciaProductId).cuts : [],
    edgeJoins: d?.edgeJoins ?? [],
    bearerJoins: d?.bearerJoins ?? [],
    joistJoinLines: d?.joistJoinLines ?? [],
  };
  return {
    params, rules, poly, valid, decking, joist, bearer, flush, boardT, joistD, bearerD, levels, concreteId,
    maxTreadSpan, joistSpacingCap, joistSpacingTarget, joistSetout, joistSetoutSpacing, breakersOn, edgeBoardProductId,
    postProductId, postW, postLength, ctx,
  };
}

function designWith(project: Project, frame: FrameInfo): DesignResult {
  const {
    params, rules, poly, valid, decking, joist, bearer, flush, boardT, joistD, bearerD, levels, concreteId,
    maxTreadSpan, joistSpacingCap, joistSpacingTarget, joistSetout, joistSetoutSpacing, breakersOn, edgeBoardProductId,
    postProductId, postW, postLength, ctx,
  } = setup(project);
  const { postTop, groundClearance } = levels;

  const emptyBal: BalustradeDesign = {
    enabled: false, edges: [], segments: [], posts: [], totalLength: 0, railPieces: [], railCount: 2,
    slatCount: 0, slatLength: 0, wireLength: 0, wireKits: 0, postLength: 0,
  };
  const emptyBom: BomResult = { lines: [], removed: [], cutlists: [], linesTotal: 0, discount: 0, delivery: 0, subtotal: 0, exGst: 0, gst: 0, total: 0, pricesIncludeGst: params.pricesIncludeGst };

  if (!valid.ok) {
    return {
      ok: false, problem: valid.problem, poly, edges: [], areaM2: 0, perimeterM: 0, bb: bbox(poly), datum: { x: 0, y: 0 },
      layout: null, levels, postProductId: 'post-90x90-h4', postLength: 0, stairs: [], balustrade: emptyBal,
      braces: { count: 0, length: 0, lines: [] }, slabs: [], footings: { count: 0, type: params.footingType, depth: params.footingDepth, diameter: params.footingDiameter, padSize: params.padSize, padDepth: params.padDepth, concreteM3: 0, bags: 0 },
      fascia: [], fasciaProductId: decking.fasciaProductId ?? decking.id, edgeBoardProductId: decking.edgeBoardProductId ?? decking.id,
      joistSpacingText: String(Math.round(joistSetout ? joistSetoutSpacing : joistSpacingTarget)), joistSpacingCap, joistSpacingTarget, joistSetout, joistSetoutSpacing, breakersOn, frame, bom: emptyBom,
      warnings: [{ severity: 'error', key: `polygon.${valid.problem}` }], pathway: 'approvalRequired', method: [],
    };
  }

  const E = edges(poly);
  const bb = bbox(poly);
  const areaM2 = polygonAreaMm2(poly) / 1e6;
  const perimeterM = perimeter(poly) / 1000;
  const houseEdges = project.houseEdges.filter((i) => i >= 0 && i < E.length);

  const layout = computeLayout(poly, houseEdges, params, rules, ctx);
  const spMin = Math.round(layout.joistSpacingMin);
  const spMax = Math.round(layout.joistSpacingUsed);
  // (joists changed by hand: a bay set out round them is spread evenly, so the spacing is given as built)
  const d = project.details;
  const handJoists = !!(d?.joistsOff?.length || d?.joistsAdded?.length || d?.joistsMoved?.length || d?.joistsDoubled?.length);
  const joistSpacingText = joistSetout && !handJoists ? `${Math.round(joistSetoutSpacing)}` : spMin === spMax ? `${spMax}` : `${spMin}-${spMax}`;

  // ---- stairs ----
  const clampedStairs = project.stairs
    .filter((s) => s.edgeIndex >= 0 && s.edgeIndex < E.length && !houseEdges.includes(s.edgeIndex))
    .map((s) => {
      const e = E[s.edgeIndex];
      const width = Math.min(Math.max(300, s.width), e.length);
      return { ...s, width, offset: Math.max(0, Math.min(s.offset, e.length - width)) };
    });
  const stairs: StairDesign[] = clampedStairs.map((s) =>
    designStair(s, E[s.edgeIndex], params, rules, decking.width ?? 86, params.boardGap, maxTreadSpan),
  );

  // ---- balustrade ----
  const balustrade = designBalustrade(
    E, houseEdges, clampedStairs, params.balustrade, params.deckHeight, rules.balustradeTriggerHeight,
    boardT, joistD, maxStock('tp-90x45', rules), 90,
  );

  // ---- bracing ----
  let braceCount = 0;
  let braceLength = 0;
  const braceLines: { a: Pt; b: Pt }[] = [];
  if (postTop > rules.braceHeight) {
    // along each bearer, every other bay between its stumps; across, one between each pair of bearer lines (from a
    // stump to the next line's nearest stump, or to the wall bearer)
    const alongOf = (b: (typeof layout.bearers)[number]) => (q: Pt) => (Math.abs(b.seg.a.y - b.seg.b.y) < 0.5 ? q.x : q.y);
    for (const b of layout.bearers) {
      const at = alongOf(b);
      const posts = [...b.posts].sort((p, q) => at(p) - at(q));
      for (let i = 0; i + 1 < posts.length; i += 2) braceLines.push({ a: posts[i], b: posts[i + 1] });
    }
    const lines = [...new Set(layout.bearers.map((b) => b.lineIndex))].sort((p, q) => p - q);
    for (let k = 0; k + 1 < lines.length; k++) {
      const here = layout.bearers.filter((b) => b.lineIndex === lines[k]);
      const next = layout.bearers.filter((b) => b.lineIndex === lines[k + 1]);
      const from = [...next.flatMap((b) => b.posts), ...here.flatMap((b) => b.posts)][0];
      if (!from) continue;
      const other = next.some((b) => b.posts.includes(from)) ? here : next;
      const posts = other.flatMap((b) => b.posts);
      const b0 = other[0];
      if (!b0) continue;
      const near = posts.length
        ? posts.reduce((m, q) => (Math.hypot(q.x - from.x, q.y - from.y) < Math.hypot(m.x - from.x, m.y - from.y) ? q : m))
        : Math.abs(b0.seg.a.y - b0.seg.b.y) < 0.5 ? { x: from.x, y: b0.seg.a.y } : { x: b0.seg.a.x, y: from.y };
      braceLines.push({ a: from, b: near });
    }
    braceCount = braceLines.length;
    const bay = layout.maxBearerSpanUsed > 0 ? Math.min(1800, layout.maxBearerSpanUsed) : 1800;
    braceLength = Math.ceil((Math.hypot(bay, postTop) + 200) / 10) * 10;
  }

  // ---- footings ----
  const postCount = layout.posts.length;
  let concreteM3 = 0;
  if (params.footingType === 'stump') {
    const hole = Math.PI * (params.footingDiameter / 2) ** 2 * params.footingDepth;
    const postVol = postW * postW * params.footingDepth;
    concreteM3 = (postCount * Math.max(0, hole - postVol)) / 1e9;
  } else if (params.footingType === 'stirrup') {
    concreteM3 = (postCount * params.padSize * params.padSize * params.padDepth) / 1e9;
  }
  if (params.footingType !== 'slab') concreteM3 += stairs.reduce((s, st) => s + st.padVolumeM3, 0);
  // the pads beside a slab for the pedestals where the deck runs past it by too little for a stump
  concreteM3 += layout.totals.pads * padVolume(rules);
  const bags = Math.ceil(concreteM3 / rules.concreteBagYield);
  const footings: FootingInfo = {
    count: postCount, type: params.footingType, depth: params.footingDepth, diameter: params.footingDiameter,
    padSize: params.padSize, padDepth: params.padDepth, concreteM3, bags,
  };
  // ---- pedestals on the slabs, each set to the slab's level under the joists ----
  const slabs: SlabInfo[] = (project.slabs ?? []).map((s, k) => {
    const pedestalHeight = s.height - boardT - joistD;
    return { id: s.id, height: s.height, pedestalHeight, productId: pedestalFor(pedestalHeight), count: layout.pedestals.filter((p) => p.slab === k).length, pads: layout.pedestals.filter((p) => p.slab === k && p.pad).length };
  });

  // ---- fascia ----
  const fasciaProductId = decking.fasciaProductId && PRODUCT_MAP[decking.fasciaProductId] ? decking.fasciaProductId : decking.id;
  const deckScrew = decking.screwProductId && PRODUCT_MAP[decking.screwProductId] ? decking.screwProductId : 'screw-deck-10gx50';
  const clipId = decking.hiddenClipProductId && PRODUCT_MAP[decking.hiddenClipProductId] ? decking.hiddenClipProductId : null;
  const { runs: fascia, cuts: fasciaPieces } = fasciaCuts(project, poly, fasciaProductId);

  // ---- pieces & counts ----
  const pieces: Piece[] = [];
  const counts: CountItem[] = [];
  const push = (productId: string, length: number, tag: string) => {
    if (length > 0) pieces.push({ productId, length, tag });
  };
  const count = (productId: string, qty: number, tag: string) => {
    if (qty > 0) counts.push({ productId, qty, tag });
  };

  for (const b of layout.bearers) for (const lam of b.pieces) for (const len of lam) push(bearer.id, len, b.onWall ? 'wallBearer' : 'bearer');
  for (const j of layout.joists) for (const len of j.pieces) push(joist.id, flush ? len : len, 'joist');
  for (let i = 0; i < layout.totals.boardJoins; i++) push(joist.id, 300, 'joinBlock');
  for (const row of layout.boards) for (const run of row.runs) for (const len of run.pieces) push(decking.id, len, 'decking');
  for (const eb of layout.edgeBoards) for (const len of eb.pieces) push(edgeBoardProductId, len, 'edgeBoard');
  for (const br of layout.breakers) for (const len of br.pieces) push(decking.id, len, 'breaker');
  for (const len of fasciaPieces) push(fasciaProductId, len, 'fascia');
  const fasciaScrews = fascia.reduce((n, f) => n + Math.ceil(f.length / 450) * 2, 0);
  for (let i = 0; i < postCount; i++) push(postProductId, postLength, 'post');
  for (let i = 0; i < braceCount; i++) push('tp-90x45', braceLength, 'brace');
  if (balustrade.enabled) {
    for (let i = 0; i < balustrade.posts.length; i++) push('post-90x90-h4', balustrade.postLength, 'balustradePost');
    for (const len of balustrade.railPieces) push('tp-90x45', len, 'rail');
    for (let i = 0; i < balustrade.slatCount; i++) push('tp-42x19', balustrade.slatLength, 'slat');
    if (balustrade.wireLength > 0) {
      count('wire-3.2-316', balustrade.wireLength / 1000, 'wire');
      count('wire-kit', balustrade.wireKits, 'wire');
    }
    count('bolt-m12-hdg', balustrade.posts.length * 2, 'balustradePost');
    count('screw-batten-14gx75', balustrade.posts.length * 4, 'rail');
    count('screw-deck-10gx50', balustrade.slatCount * 4, 'slat');
  }
  let treadScrews = 0;
  for (const s of stairs) {
    for (let i = 0; i < s.stringerCount; i++) push(s.stringerProductId, s.stringerLength, 'stringer');
    for (let i = 0; i < s.treads * s.boardsPerTread; i++) push(decking.id, s.treadBoardLength, 'tread');
    push('tp-90x45-h4', s.width + 20, 'stairKicker');
    for (let i = 0; i < s.handrailPosts; i++) push('post-90x90-h4', 1200, 'handrailPost');
    if (s.handrailLength > 0) {
      const split = splitRun(0, s.handrailLength, [], maxStock('tp-90x45', rules), 300);
      for (const len of split.pieces) push('tp-90x45', len, 'handrail');
    }
    treadScrews += s.treads * s.boardsPerTread * s.stringerCount * 2;
    count('bolt-m12-hdg', s.stringerCount * 2 + s.handrailPosts * 2, 'stairs');
  }
  // wall bearers are already in layout.bearers (timber); add their wall anchors
  const wallAnchors = layout.ledgers.reduce((s, l) => s + l.bolts, 0);
  if (wallAnchors > 0) count(params.wallFixing === 'dynabolt' ? 'dynabolt-m12x100' : 'bolt-m12-hdg', wallAnchors, 'wallBearer');
  // ---- decking fixings: hidden clips on grooved boards, screws elsewhere ----
  let clipCount = 0;
  let edgeScrews = 0;
  if (clipId && layout.boards.length) {
    const rows = layout.boards;
    rows.forEach((row, i) => {
      const crossings = row.runs.reduce((s, r) => s + r.crossings, 0);
      const joins = row.runs.reduce((s, r) => s + r.joins.length, 0);
      if (i === 0 || i === rows.length - 1) edgeScrews += (crossings + joins) * rules.screwsPerCrossing;
      else {
        clipCount += crossings + joins;
        edgeScrews += joins * rules.screwsPerCrossing; // board ends at a join are face screwed
      }
    });
    count(clipId, clipCount, 'clip');
    // edge boards have no groove on the exposed side: face screwed with colour screws
    count(deckScrew, edgeScrews + layout.totals.edgeBoardScrews + layout.totals.breakerScrews + treadScrews + fasciaScrews, 'edgeScrew');
  } else {
    count(deckScrew, layout.totals.screws + layout.totals.edgeBoardScrews + layout.totals.breakerScrews + treadScrews + fasciaScrews, 'decking');
  }
  // ---- joist to bearer ----
  if (flush) {
    count(hangerFor(joist.id), layout.totals.hangers, 'joist');
    count('nail-75x3.05', layout.totals.hangers * rules.hangerNails, 'joist');
  } else {
    if (params.joistFixing === 'tripleGrip') {
      count('triple-grip', layout.totals.joistBearerCrossings, 'joist');
      count('nail-30x2.8-galv', layout.totals.joistBearerCrossings * 6, 'joist');
    } else {
      count('nail-75x3.05', layout.totals.joistBearerCrossings * rules.skewNailsPerCrossing, 'joist');
    }
    // two field joists lapped over a bearer are nailed together
    count('nail-75x3.05', layout.totals.joistLaps * (rules.lapNails ?? 3), 'joist');
  }
  // a joist doubled by hand: the two nailed together, two nails every 600 along it
  count('nail-75x3.05', layout.joists.filter((j) => j.twin).reduce((n, j) => n + 2 * (Math.ceil(j.length / 600) + 1), 0), 'joist');
  // ---- bearer to post ----
  if (params.bearerToPost === 'bolted') count('bolt-m12-hdg', postCount * rules.boltsPerPost, 'bearer');
  else if (params.bearerToPost === 'screwed' || params.bearerToPost === 'checked') count('screw-batten-14gx100', postCount * rules.battenScrewsPerPost, 'bearer');
  else count('post-cap-hdg', postCount, 'bearer');
  if (params.footingType === 'stirrup') count('stirrup-hdg', postCount, 'footing');
  count('bolt-m12-hdg', braceCount * 2, 'brace');
  if (params.joistTape) count('tape-joist', Math.ceil(layout.totals.joistLm / rules.joistTapeRoll), 'joist');
  for (const s of slabs) if (s.productId) count(s.productId, s.count, 'pedestal');
  count('screw-deck-10gx50', slabs.reduce((n, s) => n + (s.productId ? s.count : 0), 0) * (rules.pedestalScrews ?? 2), 'pedestal');
  // weed mat on the ground, not over a slab
  if (params.weedMat) count('weed-mat', Math.max(0, areaM2 - slabUnderDeck(poly, ctx.slabs ?? [])) * 1.1, 'ground');
  if (params.oil && decking.family !== 'composite') {
    count('oil-decking', (areaM2 * rules.oilCoats) / rules.oilCoverage, 'finish');
  }
  if (decking.family === 'hardwood') count('end-seal', Math.max(1, Math.ceil(areaM2 / 60)), 'finish');
  count(concreteId, bags, 'footing');

  // spare boards on top of the cut list (the company's habit): the decking, and each edge board or fascia product
  const boardSpares: Record<string, number> = { [decking.id]: params.spareDeckingBoards ?? 3 };
  const edgeProducts = new Set<string>([...(layout.edgeBoards.length ? [edgeBoardProductId] : []), ...(fascia.length ? [fasciaProductId] : [])]);
  for (const id of edgeProducts) boardSpares[id] = (boardSpares[id] ?? 0) + (params.spareEdgeBoards ?? 1);
  const bom = buildBom(pieces, counts, project.prices, rules, boardSpares, params.wasteFramingPct, params.gstPct, {
    pricesIncludeGst: params.pricesIncludeGst,
    supplierDiscountPct: params.supplierDiscountPct,
    deliveryFee: params.deliveryFee,
    edits: project.order ?? null,
  });

  const compliance = assessCompliance({
    params, rules, areaM2, postClear: postTop, groundClearance, layout, balustrade, stairs, houseEdges,
    edgeCount: E.length, deckingMaxJoistSpacing: maxTreadSpan, deckingFamily: decking.family ?? '',
    joistSpacingUsed: layout.joistSpacingUsed,
  });
  if (postTop > (rules.postMaxHeight[postProductId] ?? Infinity)) {
    compliance.warnings.unshift({ severity: 'error', key: 'compliance.postTooTall', params: { height: Math.round(postTop), max: rules.postMaxHeight[postProductId] ?? 0 } });
  }
  if (params.bearerToPost === 'screwed') compliance.warnings.push({ severity: 'info', key: 'compliance.screwedBearers', params: { n: rules.battenScrewsPerPost } });
  if (params.bearerToPost === 'checked') compliance.warnings.push({ severity: 'info', key: 'compliance.checkedPost', params: { n: rules.battenScrewsPerPost } });
  if (params.footingType === 'slab') compliance.warnings.push({ severity: 'info', key: 'compliance.slabBlocks' });
  if (flush) compliance.warnings.push({ severity: 'info', key: 'compliance.flushNotes' });
  if (!flush && params.joistFixing === 'skewNails') compliance.warnings.push({ severity: 'info', key: 'compliance.skewNails', params: { n: rules.skewNailsPerCrossing } });
  if (layout.ledgers.length) compliance.warnings.push({ severity: 'info', key: params.wallFixing === 'dynabolt' ? 'compliance.wallBearerMasonry' : 'compliance.wallBearerTimber', params: { n: wallAnchors } });
  // AS 3660.1: a deck against the house must not hide or bridge the house's termite management
  if (houseEdges.length) compliance.warnings.push({ severity: 'info', key: 'compliance.termite' });
  // over a slab: the joists on pedestals, set to the slab's level; a slab too close to the deck (or too far below it)
  // for the pedestals is said so
  for (const s of slabs) {
    if (s.productId) {
      if (s.count) compliance.warnings.push({ severity: 'info', key: 'compliance.pedestals', params: { n: s.count, h: Math.round(s.pedestalHeight), height: s.height } });
    } else {
      const low = s.pedestalHeight < Math.min(...PEDESTAL_PRODUCTS.map((p) => p.pedestal![0]));
      compliance.warnings.unshift({ severity: 'error', key: low ? 'compliance.slabTooLow' : 'compliance.slabTooHigh', params: { h: Math.round(s.pedestalHeight), height: s.height, joist: joistD } });
    }
  }

  const method = buildMethod({
    params, rules, layout, areaM2, postCount, postTop, postLength, postName: postProductId, concreteM3, bags,
    bearerName: bearer.id, joistName: joist.id, deckingName: decking.id, boardThickness: boardT, joistDepth: joistD,
    bearerDepth: bearerD, balustrade, stairs, braceCount, pathway: compliance.pathway,
    clips: clipId ? clipCount : undefined, composite: decking.family === 'composite',
    joistSpacingText, joistSpacingCap, joistSetout, joistSetoutSpacing, edgeBoardName: edgeBoardProductId, houseSide: layout.startsAtHouse,
    againstHouse: houseEdges.length > 0,
    pedestals: slabs.filter((s) => s.count > 0),
  });

  return {
    ok: true, poly, edges: E, areaM2, perimeterM, bb, datum: { x: bb.minX, y: bb.minY }, layout, levels, postProductId, postLength,
    stairs, balustrade, braces: { count: braceCount, length: braceLength, lines: braceLines }, footings, slabs, fascia, fasciaProductId, edgeBoardProductId, joistSpacingText, joistSpacingCap, joistSpacingTarget, joistSetout, joistSetoutSpacing, breakersOn, frame, bom,
    warnings: compliance.warnings, pathway: compliance.pathway, method,
  };
}
