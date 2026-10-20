import type { Product } from './types';

const HW_LENGTHS = [1800, 2100, 2400, 2700, 3000, 3300, 3600, 3900, 4200, 4500, 4800, 5100, 5400];
const TP_DECK_LENGTHS = [3000, 3600, 4200, 4800, 5400, 6000];
const FRAMING_LENGTHS = [2400, 3000, 3600, 4200, 4800, 5400, 6000];
const POST_LENGTHS = [2400, 3000, 3600];

export const CATALOG: Product[] = [
  // ---- decking ----
  {
    id: 'hw-86x19', category: 'decking', isDecking: true, family: 'hardwood',
    name: { zh: '硬木地板 86x19 (merbau / spotted gum)', en: 'Hardwood decking 86x19 (merbau / spotted gum)' },
    width: 86, thickness: 19, stockLengths: HW_LENGTHS, unit: 'm', defaultPrice: 9.5,
    defaultGap: 4, maxJoistSpacing: 450, fasciaProductId: 'hw-136x19',
  },
  {
    id: 'hw-136x19', category: 'decking', isDecking: true, family: 'hardwood',
    name: { zh: '硬木地板 136x19', en: 'Hardwood decking 136x19' },
    width: 136, thickness: 19, stockLengths: HW_LENGTHS, unit: 'm', defaultPrice: 15.5,
    defaultGap: 4, maxJoistSpacing: 450, fasciaProductId: 'hw-136x19',
  },
  {
    id: 'tp-90x22', category: 'decking', isDecking: true, family: 'treatedPine',
    name: { zh: 'Treated pine 地板 90x22 H3', en: 'Treated pine decking 90x22 H3' },
    width: 90, thickness: 22, stockLengths: TP_DECK_LENGTHS, unit: 'm', defaultPrice: 4.2,
    defaultGap: 3, maxJoistSpacing: 450, fasciaProductId: 'tp-140x22',
  },
  {
    id: 'tp-140x22', category: 'decking', isDecking: true, family: 'treatedPine',
    name: { zh: 'Treated pine 地板 140x22 H3', en: 'Treated pine decking 140x22 H3' },
    width: 140, thickness: 22, stockLengths: TP_DECK_LENGTHS, unit: 'm', defaultPrice: 6.8,
    defaultGap: 3, maxJoistSpacing: 450, fasciaProductId: 'tp-140x22',
  },
  {
    id: 'comp-137x23', category: 'decking', isDecking: true, family: 'composite',
    name: { zh: '复合地板 137x23 (ModWood / Ekodeck 类)', en: 'Composite decking 137x23 (ModWood / Ekodeck type)' },
    width: 137, thickness: 23, stockLengths: [5400], unit: 'm', defaultPrice: 16.5,
    defaultGap: 6, maxJoistSpacing: 400, fasciaProductId: 'comp-fascia-140x12',
  },
  {
    id: 'comp-88x23', category: 'decking', isDecking: true, family: 'composite',
    name: { zh: '复合地板 88x23', en: 'Composite decking 88x23' },
    width: 88, thickness: 23, stockLengths: [5400], unit: 'm', defaultPrice: 11.5,
    defaultGap: 6, maxJoistSpacing: 400, fasciaProductId: 'comp-fascia-140x12',
  },
  {
    id: 'comp-fascia-140x12', category: 'decking', family: 'composite',
    name: { zh: '复合封边板 140x12', en: 'Composite fascia 140x12' },
    width: 140, thickness: 12, stockLengths: [5400], unit: 'm', defaultPrice: 12.0,
  },
  // ---- framing (MGP10 H3 treated pine) ----
  {
    id: 'tp-90x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'MGP10 H3 90x45', en: 'MGP10 H3 90x45' },
    width: 45, depth: 90, stockLengths: FRAMING_LENGTHS, unit: 'm', defaultPrice: 6.5,
  },
  {
    id: 'tp-140x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'MGP10 H3 140x45', en: 'MGP10 H3 140x45' },
    width: 45, depth: 140, stockLengths: FRAMING_LENGTHS, unit: 'm', defaultPrice: 9.8,
  },
  {
    id: 'tp-190x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'MGP10 H3 190x45', en: 'MGP10 H3 190x45' },
    width: 45, depth: 190, stockLengths: FRAMING_LENGTHS, unit: 'm', defaultPrice: 13.5,
  },
  {
    id: 'tp-240x45', category: 'framing', isFraming: true, family: 'treatedPine',
    name: { zh: 'MGP10 H3 240x45', en: 'MGP10 H3 240x45' },
    width: 45, depth: 240, stockLengths: FRAMING_LENGTHS, unit: 'm', defaultPrice: 18.5,
  },
  {
    id: 'tp-290x45', category: 'framing', family: 'treatedPine',
    name: { zh: 'MGP10 H3 290x45 (楼梯 stringer)', en: 'MGP10 H3 290x45 (stair stringers)' },
    width: 45, depth: 290, stockLengths: [3000, 3600, 4200, 4800, 5400, 6000], unit: 'm', defaultPrice: 24.0,
  },
  {
    id: 'tp-90x45-h4', category: 'framing', family: 'treatedPine',
    name: { zh: 'H4 90x45 (接地构件)', en: 'H4 90x45 (ground contact)' },
    width: 45, depth: 90, stockLengths: [2400, 3600, 4800], unit: 'm', defaultPrice: 7.5,
  },
  {
    id: 'tp-42x19', category: 'balustrade', family: 'treatedPine',
    name: { zh: 'H3 栏杆竖条 42x19', en: 'H3 balustrade slat 42x19' },
    width: 19, depth: 42, stockLengths: [2400, 3600], unit: 'm', defaultPrice: 1.9,
  },
  // ---- posts ----
  {
    id: 'post-90x90-h4', category: 'post', isPost: true, family: 'treatedPine',
    name: { zh: 'H4 柱 90x90', en: 'H4 post 90x90' },
    width: 90, depth: 90, stockLengths: POST_LENGTHS, unit: 'm', defaultPrice: 14.5,
  },
  {
    id: 'post-100x100-h4', category: 'post', isPost: true, family: 'treatedPine',
    name: { zh: 'H4 柱 100x100', en: 'H4 post 100x100' },
    width: 100, depth: 100, stockLengths: POST_LENGTHS, unit: 'm', defaultPrice: 19.5,
  },
  // ---- hardware ----
  { id: 'screw-deck-10gx50', category: 'hardware', name: { zh: '地板螺丝 10g x 50 (304 不锈钢或 Class 3)', en: 'Decking screw 10g x 50 (304 SS or Class 3)' }, unit: 'ea', defaultPrice: 0.09 },
  { id: 'screw-batten-14gx75', category: 'hardware', name: { zh: 'Batten 螺丝 14g x 75 HDG', en: 'Batten screw 14g x 75 HDG' }, unit: 'ea', defaultPrice: 0.28 },
  { id: 'bolt-m12-hdg', category: 'hardware', name: { zh: 'M12 热镀锌螺栓套装 (cup head, 螺母, 垫片)', en: 'M12 HDG bolt set (cup head, nut, washer)' }, unit: 'ea', defaultPrice: 3.5 },
  { id: 'triple-grip', category: 'hardware', name: { zh: 'Triple grip 框架连接件 HDG', en: 'Triple grip framing anchor HDG' }, unit: 'ea', defaultPrice: 0.9 },
  { id: 'nail-30x2.8-galv', category: 'hardware', name: { zh: '连接件钉 30 x 2.8 镀锌', en: 'Connector nail 30 x 2.8 galv' }, unit: 'ea', defaultPrice: 0.02 },
  { id: 'joist-hanger', category: 'hardware', name: { zh: 'Joist hanger HDG', en: 'Joist hanger HDG' }, unit: 'ea', defaultPrice: 4.2 },
  { id: 'stirrup-hdg', category: 'hardware', name: { zh: '柱脚 stirrup HDG', en: 'Post stirrup HDG' }, unit: 'ea', defaultPrice: 13.0 },
  { id: 'post-cap-hdg', category: 'hardware', name: { zh: '柱顶 bearer 连接件 HDG', en: 'Post cap / bearer connector HDG' }, unit: 'ea', defaultPrice: 9.5 },
  { id: 'wire-kit', category: 'balustrade', name: { zh: '不锈钢拉线套件 (每道线含张紧器和端头)', en: 'SS wire run kit (tensioner + terminals per run)' }, unit: 'ea', defaultPrice: 28.0 },
  { id: 'wire-3.2-316', category: 'balustrade', name: { zh: '316 不锈钢钢丝 3.2mm', en: '316 SS wire 3.2 mm' }, unit: 'm', defaultPrice: 2.4 },
  { id: 'tape-joist', category: 'consumable', name: { zh: 'Joist 保护胶带 (20 m / 卷)', en: 'Joist protection tape (20 m roll)' }, unit: 'roll', rollLength: 20000, defaultPrice: 26.0 },
  // ---- consumables ----
  { id: 'oil-decking', category: 'consumable', name: { zh: '地板油 (每升)', en: 'Decking oil (per litre)' }, unit: 'L', defaultPrice: 24.0 },
  { id: 'end-seal', category: 'consumable', name: { zh: '端头封闭剂 (每升)', en: 'End grain sealer (per litre)' }, unit: 'L', defaultPrice: 32.0 },
  { id: 'concrete-20kg', category: 'concrete', name: { zh: '预拌混凝土 20 kg 袋', en: 'Premix concrete 20 kg bag' }, unit: 'bag', defaultPrice: 9.5 },
];

export const PRODUCT_MAP: Record<string, Product> = Object.fromEntries(CATALOG.map((p) => [p.id, p]));

export function product(id: string): Product {
  const p = PRODUCT_MAP[id];
  if (!p) throw new Error(`Unknown product ${id}`);
  return p;
}

/** Short section label such as "140x45" or "86x19". */
export function sizeLabel(p: Product | string | undefined): string {
  const prod = typeof p === 'string' ? PRODUCT_MAP[p] : p;
  if (!prod) return '';
  if (prod.depth && prod.width) return `${prod.depth}x${prod.width}`;
  if (prod.width && prod.thickness) return `${prod.width}x${prod.thickness}`;
  return prod.name.en;
}

export const DECKING_PRODUCTS = CATALOG.filter((p) => p.isDecking);
export const FRAMING_PRODUCTS = CATALOG.filter((p) => p.isFraming);
export const POST_PRODUCTS = CATALOG.filter((p) => p.isPost);
