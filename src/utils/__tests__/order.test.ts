import { describe, expect, it } from 'vitest';
import { computeDesign } from '../../engine';
import { newProject } from '../../model/defaults';
import type { Project } from '../../model/types';
import { migrateProject } from '../../state';
import { supplierOrderText } from '../order';
import { asCalculated, withAdded, withNote, withoutLine, withPrice, withQty, withStock } from '../orderEdits';

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
    expect(bad.order).toEqual({ lines: {}, added: [], note: undefined });
    expect(computeDesign(bad).ok).toBe(true);
  });
});
