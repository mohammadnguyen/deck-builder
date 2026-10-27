import { describe, expect, it } from 'vitest';
import { computeDesign, type DesignResult } from '../../engine';
import { newProject } from '../../model/defaults';
import type { Project } from '../../model/types';
import { migrateProject } from '../../state';
import { supplierOrderText } from '../order';
import { asCalculated, cutCount, withAdded, withNote, withoutLine, withPrice, withQty, withStock } from '../orderEdits';

const line = (p: Project, key: string) => computeDesign(p).bom.lines.find((l) => l.key === key)!;
const apply = (p: Project, patch: Partial<Project>): Project => ({ ...p, ...patch });
const sum = (p: Project) => {
  const b = computeDesign(p).bom;
  return { lines: b.linesTotal, bySum: b.lines.reduce((s, l) => s + l.total, 0) };
};

describe('order list edits', () => {
  it('starts as calculated', () => {
    const d = computeDesign(newProject('s', true));
    expect(d.bom.removed).toEqual([]);
    expect(d.bom.lines.every((l) => l.key === l.productId && !l.edited)).toBe(true);
  });

  it('changes the pieces of a stock length, and adds another length', () => {
    let p = newProject('s', true);
    const deck = line(p, 'modelo-140x23');
    // 26 boards cut, and the 3 spare boards the company adds
    expect(deck.stockBreakdown).toEqual([{ length: 5400, count: 29 }]);
    p = apply(p, { order: withStock(p, deck, 5400, 42) });
    let l = line(p, 'modelo-140x23');
    expect(l.edited).toBe(true);
    expect(l.calcQty).toBe(29);
    expect(l.calcStock).toEqual([{ length: 5400, count: 29 }]);
    expect(l.qty).toBe(42);
    expect(l.purchasedLm).toBeCloseTo(42 * 5.4, 6);
    expect(l.total).toBeCloseTo(42 * 5.4 * l.unitPrice, 6);
    // add two of a length the joists are not cut from, next to the calculated lengths
    const joist = line(p, 'tp-90x45');
    const calc = joist.stockBreakdown!;
    const free = [6000, 5400, 4800, 3600].find((len) => !calc.some((s) => s.length === len))!;
    p = apply(p, { order: withStock(p, joist, free, 2) });
    l = line(p, 'tp-90x45');
    expect(l.stockBreakdown).toEqual([...calc, { length: free, count: 2 }].sort((a, b) => b.length - a.length));
    // and back to calculated
    p = apply(p, { order: asCalculated(p, 'tp-90x45') });
    expect(line(p, 'tp-90x45').edited).toBeFalsy();
    expect(line(p, 'modelo-140x23').qty).toBe(42);
    const { lines, bySum } = sum(p);
    expect(lines).toBeCloseTo(bySum, 6);
  });

  it('orders boxed products by the box', () => {
    let p = newProject('s', true);
    const screws = line(p, 'screw-colour-10gx65'); // 204 needed, boxes of 100
    p = apply(p, { order: withQty(p, screws, 3 * 100) });
    const l = line(p, 'screw-colour-10gx65');
    expect(l.qty).toBe(300);
    expect(l.calcQty).toBe(204);
    expect(supplierOrderText(p, computeDesign(p), 'zh')).toContain('3 盒（300 个）');
  });

  it('takes a line off the order and puts it back', () => {
    let p = newProject('s', true);
    const before = computeDesign(p).bom.linesTotal;
    const mat = line(p, 'weed-mat');
    p = apply(p, { order: withoutLine(p, mat) });
    const d = computeDesign(p);
    expect(d.bom.lines.some((l) => l.productId === 'weed-mat')).toBe(false);
    expect(d.bom.removed.map((l) => l.productId)).toEqual(['weed-mat']);
    expect(d.bom.linesTotal).toBeCloseTo(before - mat.total, 6);
    expect(supplierOrderText(p, d, 'en')).not.toMatch(/weed/i);
    p = apply(p, { order: asCalculated(p, 'weed-mat') });
    expect(p.order).toBeNull();
    expect(computeDesign(p).bom.linesTotal).toBeCloseTo(before, 6);
  });

  it('adds catalogue products, merging into a line already on the order', () => {
    let p = newProject('s', true);
    // not on the list yet: a line of its own
    let r = withAdded(p, computeDesign(p), { productId: 'concrete-mix-20kg', qty: 4 });
    p = apply(p, { order: r.order });
    expect(r.key).toBe('add:a1');
    let l = line(p, 'add:a1');
    expect(l.tags).toEqual(['added']);
    expect(l.qty).toBe(4);
    // the same product again adds to that line
    r = withAdded(p, computeDesign(p), { productId: 'concrete-mix-20kg', qty: 2 });
    p = apply(p, { order: r.order });
    expect(r.key).toBe('add:a1');
    expect(line(p, 'add:a1').qty).toBe(6);
    // timber by stock length
    r = withAdded(p, computeDesign(p), { productId: 'hw-86x19', qty: 3, length: 4200 });
    p = apply(p, { order: r.order });
    l = line(p, r.key);
    expect(l.stockBreakdown).toEqual([{ length: 4200, count: 3 }]);
    expect(l.total).toBeCloseTo(3 * 4.2 * l.unitPrice, 6);
    // a product the calculation already orders: its line goes up
    r = withAdded(p, computeDesign(p), { productId: 'modelo-140x23', qty: 2, length: 5400 });
    p = apply(p, { order: r.order });
    expect(r.key).toBe('modelo-140x23');
    l = line(p, 'modelo-140x23');
    expect(l.qty).toBe(31);
    expect(l.calcQty).toBe(29);
    const text = supplierOrderText(p, computeDesign(p), 'en');
    expect(text).toMatch(/5\.4m x 31/);
    expect(text).toMatch(/4\.2m x 3/);
  });

  it('adds anything else by name, with its own unit and price', () => {
    let p = newProject('s', true);
    const r = withAdded(p, computeDesign(p), { name: 'Skip bin 4 m³', unit: 'ea', unitPrice: 380, qty: 1 });
    p = apply(p, { order: r.order });
    let l = line(p, r.key);
    expect(l).toMatchObject({ productId: '', name: 'Skip bin 4 m³', category: 'other', qty: 1, unitPrice: 380, total: 380 });
    p = apply(p, withPrice(p, l, 420));
    l = line(p, r.key);
    expect(l.total).toBe(420);
    const zh = supplierOrderText(p, computeDesign(p), 'zh');
    expect(zh).toContain('Skip bin 4 m³ — 1 个');
    // removing an added item deletes it outright
    p = apply(p, { order: withoutLine(p, l) });
    expect(computeDesign(p).bom.lines.some((x) => x.key === r.key)).toBe(false);
    expect(computeDesign(p).bom.removed).toEqual([]);
  });

  it('changes a unit price through the project price list', () => {
    let p = newProject('s', true);
    const bags = line(p, 'rapid-set-20kg');
    p = apply(p, withPrice(p, bags, 12));
    expect(p.prices['rapid-set-20kg']).toBe(12);
    expect(line(p, 'rapid-set-20kg').total).toBeCloseTo(bags.qty * 12, 6);
  });

  it('prints the order note at the end of the supplier order', () => {
    let p = newProject('s', true);
    p = apply(p, { order: withNote(p, 'Deliver Tuesday 7am, side gate') });
    const text = supplierOrderText(p, computeDesign(p), 'en');
    expect(text.trim().split('\n').pop()).toBe('Note: Deliver Tuesday 7am, side gate');
    p = apply(p, { order: withNote(p, '') });
    expect(p.order).toBeNull();
  });

  it('loads saved projects with and without order changes', () => {
    const p = newProject('p', true) as Partial<Project>;
    delete p.order;
    expect(migrateProject(JSON.parse(JSON.stringify(p))).order).toBeNull();
    const bad = migrateProject({ ...JSON.parse(JSON.stringify(p)), order: { lines: 'x', added: 'y' } });
    expect(bad.order).toBeNull();
    expect(computeDesign(bad).ok).toBe(true);
  });

  it('drops timber counts typed in before, so the order follows the cutting diagrams again', () => {
    // a saved order from before: the joists typed in as 42 x 5.4 and the posts as 9, two other changes
    const saved = {
      ...JSON.parse(JSON.stringify(newProject('p', true))),
      order: { lines: { 'tp-90x45': { stock: { '5400': 42 } }, 'post-100x100-h4': { stock: { '3000': 9 } }, 'weed-mat': { removed: true }, 'screw-colour-10gx65': { qty: 300 } }, added: [], note: 'side gate' },
    };
    const p = migrateProject(saved);
    expect(p.order).toEqual({ lines: { 'weed-mat': { removed: true }, 'screw-colour-10gx65': { qty: 300 } }, added: [], note: 'side gate' });
    const d = computeDesign(p);
    const joist = d.bom.lines.find((l) => l.productId === 'tp-90x45')!;
    expect(joist.edited).toBeFalsy();
    expect(joist.stockBreakdown).toEqual(computeDesign({ ...p, order: null }).bom.lines.find((l) => l.productId === 'tp-90x45')!.stockBreakdown);
    // only timber typed in goes: nothing left changed by hand is no order at all
    expect(migrateProject({ ...saved, order: { lines: { 'tp-90x45': { stock: { '5400': 42 } } }, added: [] } }).order).toBeNull();
  });
});

describe('the order follows the cutting diagrams', () => {
  const rect = (w: number, h: number): Project => {
    const p = newProject('r', true);
    p.deck = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    p.houseEdges = [0];
    p.house = [[{ x: -500, y: 0 }, { x: w + 500, y: 0 }]];
    p.stairs = [];
    return p;
  };
  const shop = (axis: 'x' | 'y'): Project => {
    const p = newProject('shop', true);
    p.deck = [{ x: 0, y: 0 }, { x: 10650, y: 0 }, { x: 10650, y: 7800 }, { x: 6100, y: 7800 }, { x: 6100, y: 2350 }, { x: 0, y: 2350 }];
    p.houseEdges = [0, 5];
    p.house = [[{ x: -1500, y: 0 }, { x: 12150, y: 0 }]];
    p.stairs = [];
    p.params.boardAxis = axis;
    return p;
  };
  /** sticks per length on the cutting diagram (the cut, then the spare drawn whole) */
  const drawn = (d: DesignResult, id: string): Record<number, number> => {
    const m: Record<number, number> = {};
    for (const g of d.bom.cutlists.find((c) => c.productId === id)!.groups) m[g.stock] = (m[g.stock] ?? 0) + g.count;
    for (const s of d.bom.lines.find((l) => l.productId === id && !l.addedId)?.spareStock ?? []) m[s.length] = (m[s.length] ?? 0) + s.count;
    return m;
  };
  const ordered = (d: DesignResult, id: string): Record<number, number> =>
    Object.fromEntries((d.bom.lines.find((l) => l.productId === id && !l.addedId)!.stockBreakdown ?? []).map((s) => [s.length, s.count]));

  it('orders every length and count the cutting diagrams draw, and nothing else', () => {
    for (const p of [newProject('s', true), rect(7200, 4200), shop('x'), shop('y')]) {
      for (const cutting of ['simple', 'cheapest'] as const) {
        const q = { ...p, rules: { ...p.rules, cutting } };
        const d = computeDesign(q);
        const text = supplierOrderText(q, d, 'en');
        for (const c of d.bom.cutlists) {
          expect(ordered(d, c.productId)).toEqual(drawn(d, c.productId));
          const l = d.bom.lines.find((x) => x.productId === c.productId)!;
          expect(l.qty).toBe(Object.values(drawn(d, c.productId)).reduce((a, b) => a + b, 0));
          expect(text).toContain(l.stockBreakdown!.map((s) => `${(s.length / 1000).toFixed(1)}m x ${s.count}`).join(', '));
        }
      }
    }
  });

  it('takes more by hand as spares, never fewer than the cut, and keeps them when the deck changes', () => {
    let p = rect(7200, 4200);
    p.params.frameSizing = 'fixed';
    const joist = line(p, 'tp-90x45');
    const [first] = joist.cutStock!;
    // fewer than the cut: the cut is ordered, with no spare of that length
    p = apply(p, { order: withStock(p, joist, first.length, 1) });
    let l = line(p, 'tp-90x45');
    expect(l.stockBreakdown!.find((s) => s.length === first.length)!.count).toBe(cutCount(l, first.length));
    // three over the cut: three spare sticks of that length, drawn whole on the cutting diagram
    p = apply(p, { order: withStock(p, l, first.length, cutCount(l, first.length) + 3) });
    l = line(p, 'tp-90x45');
    expect(l.edited).toBe(true);
    expect(l.spareStock!.find((s) => s.length === first.length)!.count).toBe(3);
    expect(ordered(computeDesign(p), 'tp-90x45')).toEqual(drawn(computeDesign(p), 'tp-90x45'));
    // the deck grows: the order is the new cut and the same spares
    const bigger = { ...p, deck: p.deck.map((q) => ({ x: q.x, y: q.y > 0 ? q.y + 1500 : q.y })) };
    const b = line(bigger, 'tp-90x45');
    expect(b.cutStock).not.toEqual(l.cutStock);
    expect(b.spareStock).toEqual(l.spareStock);
    expect(ordered(computeDesign(bigger), 'tp-90x45')).toEqual(drawn(computeDesign(bigger), 'tp-90x45'));
  });

  it('adds timber taken off the order as a line of its own, not the whole cut back', () => {
    let p = newProject('s', true);
    p = apply(p, { order: withoutLine(p, line(p, 'tp-140x45')) });
    const r = withAdded(p, computeDesign(p), { productId: 'tp-140x45', qty: 2, length: 4800 });
    p = apply(p, { order: r.order });
    const d = computeDesign(p);
    expect(d.bom.removed.map((x) => x.productId)).toEqual(['tp-140x45']);
    expect(d.bom.lines.find((x) => x.key === r.key)!.stockBreakdown).toEqual([{ length: 4800, count: 2 }]);
  });
});

