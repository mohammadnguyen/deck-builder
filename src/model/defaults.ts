import type { DeckParams, Project, RuleSet } from './types';
import { CATALOG } from './catalog';

/**
 * Conservative typical values. They are deliberately on the safe side of the
 * commonly published residential deck tables and MUST be checked against
 * AS 1684.2 / supplier tables (or an engineer) before construction. Everything
 * here is editable in the Rules panel.
 */
/**
 * bumped when a default changes in a way saved rule sets should follow once
 * (2: composite joists at 400; 3: bearers out to the deck edge, end stumps under the bearer ends)
 */
export const RULES_VERSION = 3;

export function defaultRules(): RuleSet {
  return {
    joistSpan: {
      'tp-90x45': { '400': 1500, '450': 1400, '600': 1200 },
      'tp-140x45': { '400': 2300, '450': 2200, '600': 1900 },
      'tp-190x45': { '400': 3000, '450': 2900, '600': 2500 },
      'tp-240x45': { '400': 3700, '450': 3600, '600': 3100 },
    },
    elevatedFactor: 0.9,
    bearerSpan: {
      'tp-90x45|1': [{ flw: 1800, span: 800 }, { flw: 2400, span: 700 }, { flw: 3000, span: 600 }, { flw: 3600, span: 600 }],
      'tp-90x45|2': [{ flw: 1800, span: 1200 }, { flw: 2400, span: 1000 }, { flw: 3000, span: 900 }, { flw: 3600, span: 800 }],
      // company practice: single 140x45 bearers on posts at 1500 centres with joists spanning up to 1500
      'tp-140x45|1': [{ flw: 1800, span: 1500 }, { flw: 2400, span: 1300 }, { flw: 3000, span: 1100 }, { flw: 3600, span: 1000 }],
      'tp-140x45|2': [{ flw: 1800, span: 1800 }, { flw: 2400, span: 1600 }, { flw: 3000, span: 1400 }, { flw: 3600, span: 1300 }],
      'tp-190x45|1': [{ flw: 1800, span: 1800 }, { flw: 2400, span: 1500 }, { flw: 3000, span: 1400 }, { flw: 3600, span: 1200 }],
      'tp-190x45|2': [{ flw: 1800, span: 2400 }, { flw: 2400, span: 2100 }, { flw: 3000, span: 1900 }, { flw: 3600, span: 1700 }],
      'tp-240x45|1': [{ flw: 1800, span: 2200 }, { flw: 2400, span: 1900 }, { flw: 3000, span: 1700 }, { flw: 3600, span: 1500 }],
      'tp-240x45|2': [{ flw: 1800, span: 3000 }, { flw: 2400, span: 2700 }, { flw: 3000, span: 2400 }, { flw: 3600, span: 2200 }],
    },
    postMaxHeight: {
      'post-100x100-h4': 3000,
      'post-90x90-h4': 2400,
    },
    deckingMaxJoistSpacing: Object.fromEntries(
      CATALOG.filter((p) => p.isDecking).map((p) => [p.id, p.maxJoistSpacing ?? 450]),
    ),
    joistSpacingTarget: 450,
    rulesVersion: RULES_VERSION,
    compositeJoistSetout: true,
    frameJoist: true,
    // perimeter bearer sits at the deck edge; joist ends finish flush with its outer face
    bearerEdgeInset: 25,
    houseBearerInset: 200,
    flushHouseInset: 150,
    battenScrewsPerPost: 4,
    hangerNails: 6,
    skewNailsPerCrossing: 3,
    // end stumps sit under the bearer ends (0 = the stump's outer face under the bearer end)
    postEndSetback: 0,
    minBearerGap: 300,
    // bearers run out to the deck edge, under the edge joists
    bearerEndInset: 0,
    braceHeight: 1200,
    engineerHeight: 3000,
    lowDeckClearance: 400,
    minGroundClearance: 100,
    balustradeTriggerHeight: 1000,
    handrailTriggerRise: 1000,
    exemptMaxArea: 25,
    exemptMaxHeight: 1000,
    stair: {
      minRiser: 115,
      maxRiser: 190,
      targetRiser: 175,
      minGoing: 240,
      maxGoing: 355,
      min2RG: 550,
      max2RG: 700,
      maxRisers: 18,
      stringerSpacing: 500,
      nosing: 15,
    },
    kerf: 5,
    staggerOffset: 1200,
    minBoardPiece: 600,
    boardEndAllowance: 20,
    joistEndAllowance: 20,
    screwsPerCrossing: 2,
    boltsPerPost: 2,
    ledgerBoltSpacing: 600,
    oilCoverage: 8,
    oilCoats: 2,
    stirrupLift: 75,
    concreteBagYield: 0.01,
    joistTapeRoll: 20000,
    // automatic frame sizing: the company frame, the labour that a stump costs, and the sizes on hand
    standardFrame: { joist: 'tp-90x45', bearer: 'tp-140x45', laminations: 1 },
    stumpLabour: 40,
    frameSwitchMargin: 100,
    frameSizes: ['tp-90x45', 'tp-140x45'],
    // what the yard usually has; a 2.5 m joist comes from half a 5.4
    timberLengths: [3600, 4800, 5400, 6000],
    // breakers go where the boards waste least; one more only when it saves this many boards
    breakerMinSaving: 2,
  };
}

export function defaultParams(): DeckParams {
  return {
    deckHeight: 450,
    deckingProductId: 'modelo-140x23',
    joistSpacingMode: 'auto',
    joistSpacing: 450,
    joistSpacingMax: 500,
    boardGap: 5,
    boardAxis: 'auto',
    frameSizing: 'auto',
    joistProductId: 'tp-90x45',
    bearerProductId: 'tp-140x45',
    bearerLaminations: 1,
    joistConnection: 'onTop',
    joistFixing: 'skewNails',
    bearerToPost: 'checked',
    postProductId: 'post-100x100-h4',
    attachment: 'wall',
    wallFixing: 'dynabolt',
    footingType: 'stump',
    footingDepth: 500,
    footingDiameter: 200,
    padSize: 400,
    padDepth: 400,
    concreteProductId: 'rapid-set-20kg',
    edgeBoard: true,
    edgeBoardProductId: 'auto',
    fascia: false,
    breakerBoards: 'auto',
    breakerCount: 'auto',
    oil: false,
    joistTape: true,
    weedMat: true,
    balustrade: {
      mode: 'auto',
      height: 1000,
      postSpacing: 1800,
      infill: 'slats',
      wireRuns: 10,
      slatWidth: 42,
      slatGap: 90,
      edgeOverride: {},
    },
    stairWidth: 1000,
    wasteDeckingPct: 5,
    wasteFramingPct: 5,
    gstPct: 10,
    pricesIncludeGst: true,
    supplierDiscountPct: 5,
    deliveryFee: 180,
    notes: '',
  };
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/** A sample L-shaped deck against a house wall so the first launch is not an empty screen. */
export function sampleDeck(): Pick<Project, 'deck' | 'houseEdges' | 'house' | 'stairs'> {
  return {
    deck: [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 2400 },
      { x: 3600, y: 2400 },
      { x: 3600, y: 4200 },
      { x: 0, y: 4200 },
    ],
    houseEdges: [0],
    house: [[{ x: -2000, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: -1500 }]],
    stairs: [{ id: 'S1', edgeIndex: 4, offset: 1300, width: 1000, groundOffset: 0 }],
  };
}

export function newProject(name: string, withSample = false, rules?: RuleSet, prices?: Record<string, number>): Project {
  const now = new Date().toISOString();
  const base = withSample
    ? sampleDeck()
    : { deck: [] as Project['deck'], houseEdges: [] as number[], house: [] as Project['house'], stairs: [] as Project['stairs'] };
  return {
    id: newId('prj'),
    name,
    client: '',
    address: '',
    createdAt: now,
    updatedAt: now,
    ...base,
    params: defaultParams(),
    rules: rules ? JSON.parse(JSON.stringify(rules)) : defaultRules(),
    prices: prices ? { ...prices } : {},
    progress: {},
    breakers: null,
    order: null,
  };
}
