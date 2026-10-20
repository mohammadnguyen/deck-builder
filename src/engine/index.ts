import { PRODUCT_MAP, POST_PRODUCTS, hangerFor, product, resolveProductId } from '../model/catalog';
import type { Project, Pt } from '../model/types';
import { designBalustrade, type BalustradeDesign } from './balustrade';
import { buildBom, type BomResult, type CountItem, type Piece } from './bom';
import { assessCompliance, type Pathway } from './compliance';
import { splitRun } from './cutlist';
import { bbox, edges, normalizePolygon, perimeter, polygonAreaMm2, validatePolygon, type BBox, type Edge, type PolygonProblem } from './geometry';
import { computeLayout, type LayoutResult } from './layout';
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
  type: 'stump' | 'stirrup';
  depth: number;
  diameter: number;
  padSize: number;
  padDepth: number;
  concreteM3: number;
  bags: number;
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
  braces: { count: number; length: number };
  footings: FootingInfo;
  fascia: FasciaRun[];
  fasciaProductId: string;
  bom: BomResult;
  warnings: WarningItem[];
  pathway: Pathway;
  method: MethodStep[];
}

const maxStock = (id: string): number => Math.max(...(product(id).stockLengths ?? [6000]));

export function computeDesign(project: Project): DesignResult {
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

  const emptyBal: BalustradeDesign = {
    enabled: false, edges: [], segments: [], posts: [], totalLength: 0, railPieces: [], railCount: 2,
    slatCount: 0, slatLength: 0, wireLength: 0, wireKits: 0, postLength: 0,
  };
  const emptyBom: BomResult = { lines: [], cutlists: [], linesTotal: 0, discount: 0, delivery: 0, subtotal: 0, exGst: 0, gst: 0, total: 0, pricesIncludeGst: params.pricesIncludeGst };

  if (!valid.ok) {
    return {
      ok: false, problem: valid.problem, poly, edges: [], areaM2: 0, perimeterM: 0, bb: bbox(poly), datum: { x: 0, y: 0 },
      layout: null, levels, postProductId: 'post-90x90-h4', postLength: 0, stairs: [], balustrade: emptyBal,
      braces: { count: 0, length: 0 }, footings: { count: 0, type: params.footingType, depth: params.footingDepth, diameter: params.footingDiameter, padSize: params.padSize, padDepth: params.padDepth, concreteM3: 0, bags: 0 },
      fascia: [], fasciaProductId: decking.fasciaProductId ?? decking.id, bom: emptyBom,
      warnings: [{ severity: 'error', key: `polygon.${valid.problem}` }], pathway: 'approvalRequired', method: [],
    };
  }

  const E = edges(poly);
  const bb = bbox(poly);
  const areaM2 = polygonAreaMm2(poly) / 1e6;
  const perimeterM = perimeter(poly) / 1000;
  const houseEdges = project.houseEdges.filter((i) => i >= 0 && i < E.length);

  const layout = computeLayout(poly, houseEdges, params, rules, {
    boardWidth: decking.width ?? 86,
    boardGap: params.boardGap,
    joistThickness: joist.width ?? 45,
    bearerWidth,
    flush,
    deckingMaxStock: maxStock(decking.id),
    joistMaxStock: maxStock(joist.id),
    bearerMaxStock: maxStock(bearer.id),
  });

  // ---- posts ----
  let postProductId = params.postProductId;
  if (postProductId === 'auto' || !PRODUCT_MAP[postProductId]) {
    const fit = POST_PRODUCTS.find((p) => (rules.postMaxHeight[p.id] ?? 0) >= postTop);
    postProductId = (fit ?? POST_PRODUCTS[POST_PRODUCTS.length - 1]).id;
  }
  const postProd = product(postProductId);
  const postW = postProd.width ?? 90;
  const postLength = params.footingType === 'stump' ? Math.max(100, postTop + params.footingDepth) : Math.max(100, postTop - rules.stirrupLift);

  // ---- stairs ----
  const maxTreadSpan = rules.deckingMaxJoistSpacing[decking.id] ?? decking.maxJoistSpacing ?? 450;
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
    boardT, joistD, maxStock('tp-90x45'), 90,
  );

  // ---- bracing ----
  let braceCount = 0;
  let braceLength = 0;
  if (postTop > rules.braceHeight) {
    const along = layout.bearers.reduce((s, b) => s + Math.max(0, Math.ceil((b.posts.length - 1) / 2)), 0);
    const lineCount = new Set(layout.bearers.map((b) => b.lineIndex)).size;
    braceCount = along + Math.max(0, lineCount - 1);
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
  } else {
    concreteM3 = (postCount * params.padSize * params.padSize * params.padDepth) / 1e9;
  }
  concreteM3 += stairs.reduce((s, st) => s + st.padVolumeM3, 0);
  const bags = Math.ceil(concreteM3 / rules.concreteBagYield);
  const footings: FootingInfo = {
    count: postCount, type: params.footingType, depth: params.footingDepth, diameter: params.footingDiameter,
    padSize: params.padSize, padDepth: params.padDepth, concreteM3, bags,
  };

  // ---- fascia ----
  const fasciaProductId = decking.fasciaProductId && PRODUCT_MAP[decking.fasciaProductId] ? decking.fasciaProductId : decking.id;
  const deckScrew = decking.screwProductId && PRODUCT_MAP[decking.screwProductId] ? decking.screwProductId : 'screw-deck-10gx50';
  const clipId = decking.hiddenClipProductId && PRODUCT_MAP[decking.hiddenClipProductId] ? decking.hiddenClipProductId : null;
  const fascia: FasciaRun[] = params.fascia ? E.filter((e) => !houseEdges.includes(e.index)).map((e) => ({ edgeIndex: e.index, length: e.length })) : [];

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
  const fasciaMax = maxStock(fasciaProductId) - rules.boardEndAllowance;
  let fasciaScrews = 0;
  for (const f of fascia) {
    const split = splitRun(0, f.length, [], fasciaMax, 300);
    for (const len of split.pieces) push(fasciaProductId, len + rules.boardEndAllowance, 'fascia');
    fasciaScrews += Math.ceil(f.length / 450) * 2;
  }
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
      const split = splitRun(0, s.handrailLength, [], maxStock('tp-90x45'), 300);
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
    count(deckScrew, edgeScrews + treadScrews + fasciaScrews, 'edgeScrew');
  } else {
    count(deckScrew, layout.totals.screws + treadScrews + fasciaScrews, 'decking');
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
  }
  // ---- bearer to post ----
  if (params.bearerToPost === 'bolted') count('bolt-m12-hdg', postCount * rules.boltsPerPost, 'bearer');
  else if (params.bearerToPost === 'screwed') count('screw-batten-14gx100', postCount * rules.battenScrewsPerPost, 'bearer');
  else count('post-cap-hdg', postCount, 'bearer');
  if (params.footingType === 'stirrup') count('stirrup-hdg', postCount, 'footing');
  count('bolt-m12-hdg', braceCount * 2, 'brace');
  if (!flush || decking.family !== 'composite') count('tape-joist', Math.ceil(layout.totals.joistLm / rules.joistTapeRoll), 'joist');
  if (params.oil && decking.family !== 'composite') {
    count('oil-decking', (areaM2 * rules.oilCoats) / rules.oilCoverage, 'finish');
  }
  if (decking.family === 'hardwood') count('end-seal', Math.max(1, Math.ceil(areaM2 / 60)), 'finish');
  count(concreteId, bags, 'footing');

  const bom = buildBom(pieces, counts, project.prices, rules, params.wasteDeckingPct, params.wasteFramingPct, params.gstPct, {
    pricesIncludeGst: params.pricesIncludeGst,
    supplierDiscountPct: params.supplierDiscountPct,
    deliveryFee: params.deliveryFee,
  });

  const compliance = assessCompliance({
    params, rules, areaM2, postClear: postTop, groundClearance, layout, balustrade, stairs, houseEdges,
    edgeCount: E.length, deckingMaxJoistSpacing: maxTreadSpan, deckingFamily: decking.family ?? '',
  });
  if (postTop > (rules.postMaxHeight[postProductId] ?? Infinity)) {
    compliance.warnings.unshift({ severity: 'error', key: 'compliance.postTooTall', params: { height: Math.round(postTop), max: rules.postMaxHeight[postProductId] ?? 0 } });
  }
  if (params.bearerToPost === 'screwed') compliance.warnings.push({ severity: 'info', key: 'compliance.screwedBearers', params: { n: rules.battenScrewsPerPost } });
  if (flush) compliance.warnings.push({ severity: 'info', key: 'compliance.flushNotes' });
  if (!flush && params.joistFixing === 'skewNails') compliance.warnings.push({ severity: 'info', key: 'compliance.skewNails', params: { n: rules.skewNailsPerCrossing } });
  if (layout.ledgers.length) compliance.warnings.push({ severity: 'info', key: params.wallFixing === 'dynabolt' ? 'compliance.wallBearerMasonry' : 'compliance.wallBearerTimber', params: { n: wallAnchors } });

  const method = buildMethod({
    params, rules, layout, areaM2, postCount, postTop, postLength, postName: postProductId, concreteM3, bags,
    bearerName: bearer.id, joistName: joist.id, deckingName: decking.id, boardThickness: boardT, joistDepth: joistD,
    bearerDepth: bearerD, balustrade, stairs, braceCount, pathway: compliance.pathway,
    clips: clipId ? clipCount : undefined, composite: decking.family === 'composite',
  });

  return {
    ok: true, poly, edges: E, areaM2, perimeterM, bb, datum: { x: bb.minX, y: bb.minY }, layout, levels, postProductId, postLength,
    stairs, balustrade, braces: { count: braceCount, length: braceLength }, footings, fascia, fasciaProductId, bom,
    warnings: compliance.warnings, pathway: compliance.pathway, method,
  };
}
