// Core domain types. All lengths are millimetres unless stated. Plan coordinates:
// x to the right, y downwards on screen (south). The deck polygon is orthogonal.

export type Axis = 'x' | 'y';
export type Lang = 'zh' | 'en';

export interface Pt {
  x: number;
  y: number;
}

export interface Seg {
  a: Pt;
  b: Pt;
}

export interface Stair {
  id: string;
  edgeIndex: number;
  /** distance from the edge start vertex to the stair's first side, along the edge */
  offset: number;
  width: number;
  /** ground level at the stair base relative to general ground (+ = ground is higher, less rise) */
  groundOffset: number;
}

export type BalustradeInfill = 'slats' | 'wire' | 'none';

export interface BalustradeParams {
  mode: 'auto' | 'on' | 'off';
  height: number;
  postSpacing: number;
  infill: BalustradeInfill;
  wireRuns: number;
  slatWidth: number;
  slatGap: number;
  /** edge index -> forced on/off (overrides auto) */
  edgeOverride: Record<string, boolean>;
}

export interface DeckParams {
  /** finished deck surface above ground */
  deckHeight: number;
  deckingProductId: string;
  joistSpacing: number;
  boardGap: number;
  boardAxis: 'auto' | Axis;
  joistProductId: string;
  bearerProductId: string;
  bearerLaminations: 1 | 2;
  bearerToPost: 'bolted' | 'onTop';
  postProductId: 'auto' | string;
  attachment: 'freestanding' | 'ledger';
  footingType: 'stump' | 'stirrup';
  footingDepth: number;
  footingDiameter: number;
  padSize: number;
  padDepth: number;
  fascia: boolean;
  oil: boolean;
  balustrade: BalustradeParams;
  stairWidth: number;
  wasteDeckingPct: number;
  wasteFramingPct: number;
  gstPct: number;
  notes: string;
}

export interface StairRules {
  minRiser: number;
  maxRiser: number;
  targetRiser: number;
  minGoing: number;
  maxGoing: number;
  min2RG: number;
  max2RG: number;
  maxRisers: number;
  stringerSpacing: number;
  nosing: number;
}

export interface RuleSet {
  /** joist product id -> joist spacing (as string key) -> max span, deck floor below 1 m */
  joistSpan: Record<string, Record<string, number>>;
  /** multiplier applied to joist and bearer spans when the deck is 1 m or higher */
  elevatedFactor: number;
  /** key `${bearerProductId}|${laminations}` -> table of max span for floor load width <= flw */
  bearerSpan: Record<string, { flw: number; span: number }[]>;
  /** post product id -> maximum clear height above ground */
  postMaxHeight: Record<string, number>;
  /** decking product id -> max joist spacing */
  deckingMaxJoistSpacing: Record<string, number>;
  bearerEdgeInset: number;
  houseBearerInset: number;
  postEndSetback: number;
  minBearerGap: number;
  bearerEndInset: number;
  braceHeight: number;
  engineerHeight: number;
  lowDeckClearance: number;
  minGroundClearance: number;
  balustradeTriggerHeight: number;
  handrailTriggerRise: number;
  exemptMaxArea: number;
  exemptMaxHeight: number;
  stair: StairRules;
  kerf: number;
  staggerOffset: number;
  minBoardPiece: number;
  boardEndAllowance: number;
  joistEndAllowance: number;
  screwsPerCrossing: number;
  boltsPerPost: number;
  ledgerBoltSpacing: number;
  oilCoverage: number;
  oilCoats: number;
  stirrupLift: number;
  concreteBagYield: number;
  joistTapeRoll: number;
}

export type Unit = 'm' | 'ea' | 'm3' | 'L' | 'bag' | 'roll';

export type ProductCategory =
  | 'decking'
  | 'framing'
  | 'post'
  | 'balustrade'
  | 'hardware'
  | 'consumable'
  | 'concrete';

export type MaterialFamily = 'hardwood' | 'treatedPine' | 'composite';

export interface Product {
  id: string;
  category: ProductCategory;
  name: { zh: string; en: string };
  /** plan width for boards / section width for framing (the thin dimension for joists) */
  width?: number;
  /** vertical depth for framing members */
  depth?: number;
  /** board thickness */
  thickness?: number;
  stockLengths?: number[];
  unit: Unit;
  defaultPrice: number;
  family?: MaterialFamily;
  defaultGap?: number;
  maxJoistSpacing?: number;
  fasciaProductId?: string;
  rollLength?: number;
  /** true when the product may be chosen as decking */
  isDecking?: boolean;
  /** true when the product may be chosen as joist / bearer */
  isFraming?: boolean;
  isPost?: boolean;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  address: string;
  createdAt: string;
  updatedAt: string;
  deck: Pt[];
  houseEdges: number[];
  house: Pt[][];
  stairs: Stair[];
  params: DeckParams;
  rules: RuleSet;
  /** productId -> unit price override */
  prices: Record<string, number>;
}
