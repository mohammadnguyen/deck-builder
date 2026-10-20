import type { Product } from './types';

/**
 * Product catalog. Prices are the supplier's GST-inclusive unit prices taken from
 * Green Forest Timber invoices (May to October 2026) where available; the rest
 * are estimates flagged `estimate`. All prices are editable in the Prices panel.
 */
const HW_LENGTHS = [1800, 2100, 2400, 2700, 3000, 3300, 3600, 3900, 4200, 4500, 4800, 5100, 5400];
const TP_DECK_LENGTHS = [3000, 3600, 4200, 4800, 5400, 6000];
const GFT_FRAMING_LENGTHS = [4800, 5400, 6000];
const FRAMING_LENGTHS = [3000, 3600, 4200, 4800, 5400, 6000];

export const CATALOG: Product[] = [
  // ---- composite decking (Green Forest Timber) ----
  {
    id: 'modelo-140x23', category: 'decking', isDecking: true, family: 'composite',
    name: { zh: 'Modelo 复合板 140x23 grooved 5.4 m（双色可翻面）', en: 'Modelo composite 140x23 grooved 5.4 m (reversible)' },
    ref: 'Modelo 140x23mm 5.4m Grooved',
    width: 140, thickness: 23, stockLengths: [5400], unit: 'm', defaultPrice: 16.33,
    defaultGap: 5, maxJoistSpacing: 400, fasciaProductId: 'modelo-endboard-140x23',
    hiddenClipProductId: 'camo-edge-clip', screwProductId: 'screw-colour-10gx65',
  },
  {
    id: 'modelo-endboard-140x23', category: 'decking', family: 'composite',
    name: { zh: 'Modelo endboard 140x23 5.4 m（封边 / 实心边板）', en: 'Modelo endboard 140x23 5.4 m (solid edge board)' },
    ref: 'Modelo 140x23mm 5.4m Endboard',
    width: 140, thickness: 23, stockLengths: [5400], unit: 'm', defaultPrice: 17.5,
  },
  {
    id: 'ntw-terrace-us49', category: 'decking', isDecking: true, family: 'composite',
    name: { zh: 'NewTechWood Terrace groove board US49 5.4 m', en: 'NewTechWood Terrace groove board US49 5.4 m' },
    ref: 'NewTechWood Terrace - Groove Board (US49)',
    width: 138, thickness: 23, stockLengths: [5400], unit: 'm', defaultPrice: 21.3,
    defaultGap: 5.5, maxJoistSpacing: 400, fasciaProductId: 'ntw-edge-us63',
    hiddenClipProductId: 'ntw-cobra-tclip', screwProductId: 'screw-colour-10gx65',
  },
  {
    id: 'ntw-edge-us63', category: 'decking', family: 'composite',
    name: { zh: 'NewTechWood edge board US63 5.4 m', en: 'NewTechWood edge board US63 5.4 m' },
    ref: 'NewTechWood Terrace - Edge Board (US63)',
    width: 138, thickness: 23, stockLengths: [5400], unit: 'm', defaultPrice: 23.63,
  },
  // ---- timber decking (estimates) ----
  {
    id: 'hw-86x19', category: 'decking', isDecking: true, family: 'hardwood',
    name: { zh: '硬木地板 86x19 (merbau / spotted gum)，估价', en: 'Hardwood decking 86x19 (merbau / spotted gum), estimate' },
    width: 86, thickness: 19, stockLengths: HW_LENGTHS, unit: 'm', defaultPrice: 10.5,
    defaultGap: 4, maxJoistSpacing: 450, fasciaProductId: 'hw-136x19', screwProductId: 'screw-deck-10gx50',
  },
  {
    id: 'hw-136x19', category: 'decking', isDecking: true, family: 'hardwood',
    name: { zh: '硬木地板 136x19，估价', en: 'Hardwood decking 136x19, estimate' },
    width: 136, thickness: 19, stockLengths: HW_LENGTHS, unit: 'm', defaultPrice: 17,
    defaultGap: 4, maxJoistSpacing: 450, fasciaProductId: 'hw-136x19', screwProductId: 'screw-deck-10gx50',
  },
  {
    id: 'tp-90x22', category: 'decking', isDecking: true, family: 'treatedPine',
    name: { zh: 'Treated pine 地板 90x22 H3，估价', en: 'Treated pine decking 90x22 H3, estimate' },
    width: 90, thickness: 22, stockLengths: TP_DECK_LENGTHS, unit: 'm', defaultPrice: 4.6,
    defaultGap: 3, maxJoistSpacing: 450, fasciaProductId: 'tp-140x22', screwProductId: 'screw-deck-10gx50',
  },
  {
    id: 'tp-140x22', category: 'decking', isDecking: true, family: 'treatedPine',
    name: { zh: 'Treated pine 地板 140x22 H3，估价', en: 'Treated pine decking 140x22 H3, estimate' },
    width: 140, thickness: 22, stockLengths: TP_DECK_LENGTHS, unit: 'm', defaultPrice: 7.5,
    defaultGap: 3, maxJoistSpacing: 450, fasciaProductId: 'tp-140x22', screwProductId: 'screw-deck-10gx50',
  },
  // ---- framing: H3 treated pine F7/MGP10 (Green Forest Timber) ----
  {
    id: 'tp-90x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'H3 treated pine 90x45 F7/MGP10', en: 'H3 treated pine 90x45 F7/MGP10' },
    ref: 'H3 Treated Pine 90x45mm F7/MGP 10, 4.8 m $35.28 / 6.0 m $44.10',
    width: 45, depth: 90, stockLengths: [4800, 6000], unit: 'm', defaultPrice: 7.35,
  },
  {
    id: 'tp-140x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'H3 treated pine 140x45 F7/MGP10', en: 'H3 treated pine 140x45 F7/MGP10' },
    ref: 'H3 Treated Pine 140x45mm F7/MGP10, 4.8 m $50.40 / 5.4 m $56.70 / 6.0 m $63.00',
    width: 45, depth: 140, stockLengths: GFT_FRAMING_LENGTHS, unit: 'm', defaultPrice: 10.5,
  },
  {
    id: 'tp-190x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'H3 treated pine 190x45 MGP10，估价', en: 'H3 treated pine 190x45 MGP10, estimate' },
    width: 45, depth: 190, stockLengths: FRAMING_LENGTHS, unit: 'm', defaultPrice: 14.5,
  },
  {
    id: 'tp-240x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'H3 treated pine 240x45 MGP10，估价', en: 'H3 treated pine 240x45 MGP10, estimate' },
    width: 45, depth: 240, stockLengths: FRAMING_LENGTHS, unit: 'm', defaultPrice: 19.5,
  },
  {
    id: 'tp-290x45', category: 'framing', family: 'treatedPine',
    name: { zh: 'H3 treated pine 290x45（楼梯 stringer），估价', en: 'H3 treated pine 290x45 (stair stringers), estimate' },
    width: 45, depth: 290, stockLengths: [3000, 3600, 4200, 4800, 5400, 6000], unit: 'm', defaultPrice: 25,
  },
  {
    id: 'tp-90x45-h4', category: 'framing', family: 'treatedPine',
    name: { zh: 'H4 treated pine 90x45（接地构件），估价', en: 'H4 treated pine 90x45 (ground contact), estimate' },
    width: 45, depth: 90, stockLengths: [2400, 3600, 4800], unit: 'm', defaultPrice: 8.2,
  },
  {
    id: 'tp-42x19', category: 'balustrade', family: 'treatedPine',
    name: { zh: 'H3 栏杆竖条 42x19，估价', en: 'H3 balustrade slat 42x19, estimate' },
    width: 19, depth: 42, stockLengths: [2400, 3600], unit: 'm', defaultPrice: 2.1,
  },
  // ---- posts ----
  {
    id: 'post-100x100-h4', category: 'post', isPost: true, family: 'treatedPine',
    name: { zh: 'H4 treated pine 柱 100x100 sawn', en: 'H4 treated pine post 100x100 sawn' },
    ref: 'H4 Treated Pine 100x100mm - Sawn 3.0 M $31.50',
    width: 100, depth: 100, stockLengths: [3000], unit: 'm', defaultPrice: 10.5,
  },
  {
    id: 'post-90x90-h4', category: 'post', isPost: true, family: 'treatedPine',
    name: { zh: 'H4 柱 90x90，估价', en: 'H4 post 90x90, estimate' },
    width: 90, depth: 90, stockLengths: [2400, 3000, 3600], unit: 'm', defaultPrice: 9.5,
  },
  // ---- fasteners and connectors ----
  { id: 'camo-edge-clip', category: 'hardware', packSize: 450, ref: 'Camo Edge Clip - 450pcs (Timber) $288.75; 90pc $63.00',
    name: { zh: 'Camo Edge Clip 隐藏扣（450 个/盒）', en: 'Camo Edge Clip hidden fastener (box of 450)' }, unit: 'ea', defaultPrice: 0.642 },
  { id: 'ntw-cobra-tclip', category: 'hardware', packSize: 225, ref: 'Newtechwood Cobra T-clips & Screws 5.5mm Gap 225 Box (TC28T) $180',
    name: { zh: 'NewTechWood Cobra T-clip 含螺丝（225 个/盒）', en: 'NewTechWood Cobra T-clip with screws (box of 225)' }, unit: 'ea', defaultPrice: 0.8 },
  { id: 'screw-colour-10gx65', category: 'hardware', packSize: 100, ref: 'Deck Hedz / Modwood colour head screws 10G x 65mm 100pcs $73.50',
    name: { zh: '复合板彩头螺丝 10G x 65（100 个/盒）', en: 'Composite colour-head screw 10G x 65 (box of 100)' }, unit: 'ea', defaultPrice: 0.735 },
  { id: 'screw-deck-10gx50', category: 'hardware', packSize: 500,
    name: { zh: '地板螺丝 10g x 50（304 不锈钢或 Class 3），估价', en: 'Decking screw 10g x 50 (304 SS or Class 3), estimate' }, unit: 'ea', defaultPrice: 0.09 },
  { id: 'js-9045', category: 'hardware', ref: 'JOIST SUPPORT 90X45MM (JS9045) $2.62',
    name: { zh: 'Joist support 90x45 (JS9045)', en: 'Joist support 90x45 (JS9045)' }, unit: 'ea', defaultPrice: 2.62 },
  { id: 'js-14045', category: 'hardware', ref: 'Tuff Joist Support 140X45mm (JS14045) $3.15',
    name: { zh: 'Joist support 140x45 (JS14045)', en: 'Joist support 140x45 (JS14045)' }, unit: 'ea', defaultPrice: 3.15 },
  { id: 'joist-hanger', category: 'hardware', name: { zh: 'Joist hanger HDG（其他尺寸），估价', en: 'Joist hanger HDG (other sizes), estimate' }, unit: 'ea', defaultPrice: 4.2 },
  { id: 'screw-batten-14gx100', category: 'hardware', packSize: 500, ref: 'Macsim 14G 100mm GAL BATTEN 500 box $89.25; 100 box $31.50',
    name: { zh: 'Macsim 14G x 100 batten 螺丝 Class 3（500 个/盒）', en: 'Macsim 14G x 100 batten screw Class 3 (box of 500)' }, unit: 'ea', defaultPrice: 0.18 },
  { id: 'screw-batten-14gx75', category: 'hardware', packSize: 100, ref: 'Macsim 14G-10x75mm Batten Screws 100pcs $21.00',
    name: { zh: 'Macsim 14G x 75 batten 螺丝（100 个/盒）', en: 'Macsim 14G x 75 batten screw (box of 100)' }, unit: 'ea', defaultPrice: 0.21 },
  { id: 'nail-75x3.05', category: 'hardware', packSize: 3000, ref: 'Macsim 75x3.05 GAL NAIL 3000pcs $90',
    name: { zh: '镀锌框架钉 75 x 3.05（3000 个/盒）', en: 'Galvanised framing nail 75 x 3.05 (box of 3000)' }, unit: 'ea', defaultPrice: 0.03 },
  { id: 'nail-30x2.8-galv', category: 'hardware', packSize: 500, name: { zh: '连接件钉 30 x 2.8 镀锌，估价', en: 'Connector nail 30 x 2.8 galv, estimate' }, unit: 'ea', defaultPrice: 0.02 },
  { id: 'dynabolt-m12x100', category: 'hardware', packSize: 25,
    name: { zh: 'Dynabolt M12 x 100 镀锌膨胀螺栓（25 个/盒），估价', en: 'Dynabolt M12 x 100 galvanised sleeve anchor (box of 25), estimate' }, unit: 'ea', defaultPrice: 2.8 },
  { id: 'bolt-m12-hdg', category: 'hardware', name: { zh: 'M12 热镀锌螺栓套装，估价', en: 'M12 HDG bolt set (cup head, nut, washer), estimate' }, unit: 'ea', defaultPrice: 3.5 },
  { id: 'triple-grip', category: 'hardware', name: { zh: 'Triple grip 框架连接件 HDG，估价', en: 'Triple grip framing anchor HDG, estimate' }, unit: 'ea', defaultPrice: 0.9 },
  { id: 'stirrup-hdg', category: 'hardware', name: { zh: '柱脚 stirrup HDG，估价', en: 'Post stirrup HDG, estimate' }, unit: 'ea', defaultPrice: 13.0 },
  { id: 'post-cap-hdg', category: 'hardware', name: { zh: '柱顶 bearer 连接件 HDG，估价', en: 'Post cap / bearer connector HDG, estimate' }, unit: 'ea', defaultPrice: 9.5 },
  { id: 'wire-kit', category: 'balustrade', name: { zh: '不锈钢拉线套件（每道线），估价', en: 'SS wire run kit (tensioner + terminals per run), estimate' }, unit: 'ea', defaultPrice: 28.0 },
  { id: 'wire-3.2-316', category: 'balustrade', name: { zh: '316 不锈钢钢丝 3.2mm，估价', en: '316 SS wire 3.2 mm, estimate' }, unit: 'm', defaultPrice: 2.4 },
  { id: 'weed-mat', category: 'consumable', name: { zh: '黑色防草布 / 地膜（按 m²），估价', en: 'Black weed mat / ground film (per m²), estimate' }, unit: 'm2', defaultPrice: 1.8 },
  { id: 'tape-joist', category: 'consumable', name: { zh: 'Joist 保护胶带（20 m / 卷），估价', en: 'Joist protection tape (20 m roll), estimate' }, unit: 'roll', rollLength: 20000, defaultPrice: 26.0 },
  // ---- concrete and consumables ----
  { id: 'rapid-set-20kg', category: 'concrete', ref: 'Cement Rapid Set $11.55 (Pro Strength $13.50)',
    name: { zh: 'Rapid set 快干混凝土 20 kg 袋', en: 'Rapid set concrete 20 kg bag' }, unit: 'bag', defaultPrice: 11.55 },
  { id: 'concrete-mix-20kg', category: 'concrete', ref: 'Cement Concrete Mix $11.03',
    name: { zh: 'Concrete mix 混凝土 20 kg 袋', en: 'Concrete mix 20 kg bag' }, unit: 'bag', defaultPrice: 11.03 },
  { id: 'oil-decking', category: 'consumable', name: { zh: '地板油（每升），估价', en: 'Decking oil (per litre), estimate' }, unit: 'L', defaultPrice: 24.0 },
  { id: 'end-seal', category: 'consumable', name: { zh: '端头封闭剂（每升），估价', en: 'End grain sealer (per litre), estimate' }, unit: 'L', defaultPrice: 32.0 },
];

export const PRODUCT_MAP: Record<string, Product> = Object.fromEntries(CATALOG.map((p) => [p.id, p]));

/** ids that older saved projects may still reference */
export const PRODUCT_ALIASES: Record<string, string> = {
  'concrete-20kg': 'concrete-mix-20kg',
  'comp-137x23': 'modelo-140x23',
  'comp-88x23': 'modelo-140x23',
  'comp-fascia-140x12': 'modelo-endboard-140x23',
  'screw-batten-14gx75-old': 'screw-batten-14gx75',
};

export function resolveProductId(id: string): string {
  return PRODUCT_MAP[id] ? id : (PRODUCT_ALIASES[id] ?? id);
}

export function product(id: string): Product {
  const p = PRODUCT_MAP[resolveProductId(id)];
  if (!p) throw new Error(`Unknown product ${id}`);
  return p;
}

/** Short section label such as "140x45" or "140x23". */
export function sizeLabel(p: Product | string | undefined): string {
  const prod = typeof p === 'string' ? PRODUCT_MAP[resolveProductId(p)] : p;
  if (!prod) return '';
  if (prod.depth && prod.width) return `${prod.depth}x${prod.width}`;
  if (prod.width && prod.thickness) return `${prod.width}x${prod.thickness}`;
  return prod.name.en;
}

export function hangerFor(joistProductId: string): string {
  if (joistProductId === 'tp-90x45') return 'js-9045';
  if (joistProductId === 'tp-140x45') return 'js-14045';
  return 'joist-hanger';
}

export const DECKING_PRODUCTS = CATALOG.filter((p) => p.isDecking);
export const FRAMING_PRODUCTS = CATALOG.filter((p) => p.isFraming);
export const POST_PRODUCTS = CATALOG.filter((p) => p.isPost);
export const CONCRETE_PRODUCTS = CATALOG.filter((p) => p.category === 'concrete');
