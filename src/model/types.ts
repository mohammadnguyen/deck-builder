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
  /** ground level at the stair base relative to general ground (+ = ground is higher, less rise); legacy, see rise */
  groundOffset: number;
  /** total rise from the ground at the bottom step to the deck surface; defaults to the deck height */
  rise?: number;
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
  /** auto: joists spread evenly per bay, as close to the target as possible but never over joistSpacingMax */
  joistSpacingMode: 'auto' | 'fixed';
  /** nominal joist spacing when joistSpacingMode is 'fixed' */
  joistSpacing: number;
  /** hard cap for auto spacing */
  joistSpacingMax: number;
  boardGap: number;
  boardAxis: 'auto' | Axis;
  joistProductId: string;
  bearerProductId: string;
  bearerLaminations: 1 | 2;
  /** joists hung flush between bearers on joist supports, or sitting on top of bearers */
  joistConnection: 'flush' | 'onTop';
  /** joist to bearer fixing when joists sit on top */
  joistFixing: 'skewNails' | 'tripleGrip';
  /** checked: bearer housed in a 45 deep check at the post top; screwed/bolted: side of post; onTop: post cap */
  bearerToPost: 'checked' | 'bolted' | 'screwed' | 'onTop';
  postProductId: 'auto' | string;
  /** freestanding: own posts near the wall; wall: house-side bearer anchored to the wall, no posts on that line */
  attachment: 'freestanding' | 'wall';
  /** anchor used for a wall bearer: Dynabolts into masonry, or M12 bolts into a timber frame */
  wallFixing: 'dynabolt' | 'bolt';
  /** stump: post in a concrete-filled hole; stirrup: on a pad; slab: short block sitting on existing concrete */
  footingType: 'stump' | 'stirrup' | 'slab';
  footingDepth: number;
  footingDiameter: number;
  padSize: number;
  padDepth: number;
  concreteProductId: string;
  /** picture-frame edge board around every exposed edge, mitred at the corners */
  edgeBoard: boolean;
  /** 'auto' uses the decking's edge board product (solid edge) or the decking itself */
  edgeBoardProductId: 'auto' | string;
  /** vertical fascia board covering the frame on exposed edges */
  fascia: boolean;
  /** breaker boards instead of staggered butt joins when a run is longer than one board; auto = composite only */
  breakerBoards: 'auto' | 'on' | 'off';
  oil: boolean;
  joistTape: boolean;
  weedMat: boolean;
  balustrade: BalustradeParams;
  stairWidth: number;
  wasteDeckingPct: number;
  wasteFramingPct: number;
  gstPct: number;
  /** supplier prices are quoted GST inclusive (Square invoices) */
  pricesIncludeGst: boolean;
  supplierDiscountPct: number;
  deliveryFee: number;
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
  /** auto joist spacing aims for this value (then evens out within the cap) */
  joistSpacingTarget: number;
  /** extra joist under the edge board / field board joint on edges parallel to the joists */
  frameJoist: boolean;
  bearerEdgeInset: number;
  houseBearerInset: number;
  /** house-side bearer centre inset from the wall when joists are hung flush */
  flushHouseInset: number;
  battenScrewsPerPost: number;
  hangerNails: number;
  skewNailsPerCrossing: number;
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

export type Unit = 'm' | 'ea' | 'm2' | 'm3' | 'L' | 'bag' | 'roll';

export type ProductCategory =
  | 'decking'
  | 'framing'
  | 'post'
  | 'balustrade'
  | 'hardware'
  | 'consumable'
  | 'concrete';

export type ConcreteProduct = 'rapid-set-20kg' | 'concrete-mix-20kg';

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
  /** solid-edge board laid as the outermost (picture frame) board */
  edgeBoardProductId?: string;
  rollLength?: number;
  /** pieces per pack when the supplier sells by the box */
  packSize?: number;
  /** hidden fastener clip used with this grooved board */
  hiddenClipProductId?: string;
  /** screw used for edge boards, fascia and treads of this decking */
  screwProductId?: string;
  /** supplier reference such as an invoice description */
  ref?: string;
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
  /** method step key -> ticked off on site */
  progress: Record<string, boolean>;
}
