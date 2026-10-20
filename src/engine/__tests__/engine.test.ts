import { describe, expect, it } from 'vitest';
import { newProject } from '../../model/defaults';
import { packPieces, splitRun } from '../cutlist';
import { clipHorizontal, clipVertical, detectHouseEdges, edges, normalizePolygon, polygonAreaMm2, validatePolygon } from '../geometry';
import { computeDesign } from '../index';

const L = [
  { x: 0, y: 0 },
  { x: 6000, y: 0 },
  { x: 6000, y: 2400 },
  { x: 3600, y: 2400 },
  { x: 3600, y: 4200 },
  { x: 0, y: 4200 },
];

describe('geometry', () => {
  it('computes area of an L shape', () => {
    expect(polygonAreaMm2(L) / 1e6).toBeCloseTo(6 * 2.4 + 3.6 * 1.8, 5);
  });
  it('clips horizontal lines through notches', () => {
    expect(clipHorizontal(L, 1000)).toEqual([[0, 6000]]);
    expect(clipHorizontal(L, 3000)).toEqual([[0, 3600]]);
    expect(clipVertical(L, 5000)).toEqual([[0, 2400]]);
    expect(clipVertical(L, 1000)).toEqual([[0, 4200]]);
  });
  it('finds outward normals', () => {
    const E = edges(L);
    expect(E[0].outward).toEqual({ x: 0, y: -1 });
    expect(E[1].outward).toEqual({ x: 1, y: 0 });
    expect(E[2].outward).toEqual({ x: 0, y: 1 }); // notch edge faces down/out
    expect(E[3].outward).toEqual({ x: 1, y: 0 });
  });
  it('validates and normalizes', () => {
    expect(validatePolygon(L).ok).toBe(true);
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }]).ok).toBe(false);
    const merged = normalizePolygon([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]);
    expect(merged.length).toBe(4);
  });
  it('detects house edges from a wall polyline', () => {
    expect(detectHouseEdges(L, [[{ x: -1000, y: 0 }, { x: 7000, y: 0 }]])).toEqual([0]);
  });
});

describe('cutlist', () => {
  it('packs pieces into stock and shrinks bins', () => {
    const r = packPieces([2300, 2300, 1100, 1100, 600], [2400, 3000, 3600, 4800], 5);
    expect(r.totalPieceLength).toBe(7400);
    expect(r.oversize).toEqual([]);
    expect(r.totalStockLength).toBeLessThanOrEqual(2 * 3600 + 2400);
    for (const b of r.bins) expect(b.used).toBeLessThanOrEqual(b.stock);
  });
  it('splits long runs at supports', () => {
    const r = splitRun(0, 9000, [450, 900, 1350, 1800, 2250, 2700, 3150, 3600, 4050, 4500, 4950, 5400, 5850, 6300, 6750, 7200, 7650, 8100, 8550], 5380, 600);
    expect(r.pieces.reduce((s, p) => s + p, 0)).toBe(9000);
    expect(r.joins).toEqual([4950]);
    expect(r.offSupport).toBe(false);
  });
});

describe('design', () => {
  it('designs the sample L deck', () => {
    const p = newProject('test', true);
    const d = computeDesign(p);
    expect(d.ok).toBe(true);
    expect(d.areaM2).toBeCloseTo(20.88, 2);
    expect(d.layout).not.toBeNull();
    const lay = d.layout!;
    // three bearer lines: house side, notch edge and far edge (far-side edge of the notch leg)
    expect(lay.supports.filter((s) => s.kind !== 'inter').length).toBe(3);
    expect(lay.posts.length).toBeGreaterThan(6);
    expect(lay.joists.length).toBeGreaterThan(10);
    for (const j of lay.joists) expect(j.bearerCrossings).toBeGreaterThanOrEqual(2);
    expect(lay.joistSpanUsed).toBeLessThanOrEqual(lay.maxJoistSpan + 1);
    for (const b of lay.bearers) expect(b.postSpacing).toBeLessThanOrEqual(b.maxSpan + 1);
    expect(d.stairs.length).toBe(1);
    expect(d.stairs[0].risers).toBeGreaterThanOrEqual(3);
    expect(d.bom.lines.length).toBeGreaterThan(5);
    expect(d.bom.total).toBeGreaterThan(0);
    expect(d.method.length).toBeGreaterThan(5);
    const boardLm = lay.totals.boardLm / 1000;
    expect(boardLm).toBeGreaterThan((d.areaM2 * 1000) / (86 + 4) * 0.9);
  });
  it('switches to balustrade and elevated loads at 1 m', () => {
    const p = newProject('high', true);
    p.params.deckHeight = 1500;
    const d = computeDesign(p);
    expect(d.balustrade.enabled).toBe(true);
    expect(d.balustrade.posts.length).toBeGreaterThan(4);
    expect(d.warnings.some((w) => w.key === 'compliance.heightExempt')).toBe(true);
    expect(d.braces.count).toBeGreaterThan(0);
  });
  it('rejects a non orthogonal polygon', () => {
    const p = newProject('bad');
    p.deck = [{ x: 0, y: 0 }, { x: 1000, y: 200 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];
    const d = computeDesign(p);
    expect(d.ok).toBe(false);
    expect(d.problem).toBe('notOrthogonal');
  });
  it('handles boards along y with a ledger', () => {
    const p = newProject('ledger', true);
    p.params.attachment = 'ledger';
    const d = computeDesign(p);
    expect(d.layout!.attachment).toBe('ledger');
    expect(d.layout!.ledgers.length).toBe(1);
    expect(d.layout!.totals.hangers).toBeGreaterThan(5);
    p.params.boardAxis = 'y';
    const d2 = computeDesign(p);
    expect(d2.layout!.swapped).toBe(true);
    expect(d2.layout!.attachment).toBe('freestanding');
  });
});
