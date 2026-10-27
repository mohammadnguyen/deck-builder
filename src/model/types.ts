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
  /**
   * auto: the joist and bearer sizes (and single or double bearers) are chosen for the cheapest frame that
   * meets the spans, counting stump labour; fixed: the three sizes below are used as they are
   */
  frameSizing?: 'auto' | 'fixed';
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
  /** breakers per long run: 'auto' = the fewest that work (one in the middle), or a fixed symmetric count */
  breakerCount: 'auto' | 1 | 2 | 3;
  oil: boolean;
  joistTape: boolean;
  weedMat: boolean;
  balustrade: BalustradeParams;
  stairWidth: number;
  /** spare boards on top of the cut list: decking, and each edge board or fascia product */
  spareDeckingBoards: number;
  spareEdgeBoards: number;
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
  /** version of the default rules the set was last brought up to (for one-off upgrades) */
  rulesVersion?: number;
  /** composite decking: joists set out at the decking's spacing from one end of each bay, short space last */
  compositeJoistSetout?: boolean;
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
  /** the ripped last board row goes against the house (else at the far edge board) */
  ripAtHouse?: boolean;
  /** nails through two field joists lapped side by side over a bearer */
  lapNails?: number;
  postEndSetback: number;
  minBearerGap: number;
  bearerEndInset: number;
  /** over a slab: the pedestal row along a slab edge sits this far in from it; a stump hole beside a slab clears its
   *  edge by this much; screws fixing a joist to each pedestal head; where the deck runs past a slab by too little for
   *  a stump, the pads poured beside the slab for the pedestals there (square, and deep) */
  slabEdgeInset?: number;
  slabStumpClear?: number;
  pedestalScrews?: number;
  slabPadSize?: number;
  slabPadDepth?: number;
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
  /** automatic frame sizing: the company's standard frame, kept unless another frame saves more than the margin */
  standardFrame?: FrameSizes;
  /** labour to dig, concrete and set one stump ($), weighed against timber when the frame is sized */
  stumpLabour?: number;
  /** another frame replaces the standard one only when it saves more than this ($) */
  frameSwitchMargin?: number;
  /** timber sizes the automatic frame may use (what the supplier stocks) */
  frameSizes?: string[];
  /** lengths framing pine is bought in (mm), what the yard usually has; a cut list may mix them */
  timberLengths?: number[];
  /** a breaker beyond the fewest a long run needs is laid only when it saves at least this many boards */
  breakerMinSaving?: number;
  /** framing timber: 'simple' (each stick cut into one length, as few lengths as will do) or 'cheapest' (mixed) */
  cutting?: 'simple' | 'cheapest';
  /** simple cutting: dollars a stocked length more must save */
  extraLengthSaving?: number;
}

export interface FrameSizes {
  joist: string;
  bearer: string;
  laminations: 1 | 2;
}

export type Unit = 'm' | 'ea' | 'm2' | 'm3' | 'L' | 'bag' | 'roll';

export type ProductCategory =
  | 'decking'
  | 'framing'
  | 'post'
  | 'balustrade'
  | 'hardware'
  | 'consumable'
  | 'concrete'
  | 'other';

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
  /** an adjustable deck pedestal: the heights it sets to (mm) */
  pedestal?: [number, number];
  isPost?: boolean;
  /** framing pine bought in the lengths the yard stocks (the rule set's timber lengths) */
  yardLengths?: boolean;
}

/**
 * A breaker board placed by hand. Coordinates are world millimetres: `pos` is the centreline
 * position along the boards (x when the boards run along x, else y); `from` / `to` are the
 * extent across the boards, null meaning "to the edge of the field" (the edge board).
 */
export interface ManualBreaker {
  id: string;
  pos: number;
  from: number | null;
  to: number | null;
}

/** A hand change to a calculated order line (keyed by product). */
export interface OrderLineEdit {
  /** left off the order */
  removed?: boolean;
  /** purchase quantity set by hand: units, or pieces for products sold in boxes */
  qty?: number;
  /** timber cut on the cutting diagrams: the spare set by hand (length in mm -> pieces over the cut). The order is
   *  always the cut itself, length for length, plus the spare. */
  spare?: Record<string, number>;
}

/** Existing concrete under part of the deck (a patio slab against the house): no stumps or bearers over it, the joists
 *  sit on adjustable pedestals standing on the slab. */
export interface SlabArea {
  id: string;
  /** outline on the plan (mm, the deck's coordinates) */
  poly: Pt[];
  /** finished deck level above the slab (mm) */
  height: number;
}

/** An item added to the order by hand: a catalogue product, or anything else by name. */
export interface OrderItem {
  id: string;
  productId?: string;
  /** free-text items */
  name?: string;
  unit?: Unit;
  unitPrice?: number;
  /** units, or pieces for products sold in boxes */
  qty?: number;
  /** timber sold by the metre: length in mm -> pieces */
  stock?: Record<string, number>;
}

/** Everything changed by hand on the order list; the calculated list is the starting point. */
export interface OrderEdits {
  lines: Record<string, OrderLineEdit>;
  added: OrderItem[];
  /** printed at the end of the supplier order */
  note?: string;
}

/** Hand-placed breakers, valid for the board direction they were laid out for. */
export interface BreakerLayout {
  axis: Axis;
  items: ManualBreaker[];
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
  /** breaker boards placed by hand; null / absent = laid out automatically */
  breakers?: BreakerLayout | null;
  /** hand changes to the order list; null / absent = as calculated */
  order?: OrderEdits | null;
  /** existing concrete under part of the deck: the joists sit on pedestals there, no bearers or stumps */
  slabs?: SlabArea[];
}
