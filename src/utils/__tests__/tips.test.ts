import { describe, expect, it } from 'vitest';
import { computeDesign } from '../../engine';
import { newProject } from '../../model/defaults';
import { savingTips } from '../tips';

const rect = (w: number, h: number) => {
  const p = newProject('r', true);
  p.deck = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  p.houseEdges = [0];
  p.house = [[{ x: -500, y: 0 }, { x: w + 500, y: 0 }]];
  p.stairs = [];
  return p;
};

describe('saving tips', () => {
  it('shortens a run just over one board so the breaker goes, and offers a whole last row', () => {
    const p = rect(5700, 4000);
    const tips = savingTips(p, computeDesign(p));
    // 5410 between the edge boards: 30 over a board
    const brk = tips.find((t) => t.kind === 'breaker')!;
    expect(brk.to).toEqual([5670, 4000]);
    expect(brk.saving).toBeGreaterThan(100);
    expect(computeDesign(brk.apply(p)).layout!.breakers).toEqual([]);
    // the last row is ripped to 85: 55 more and it is a whole board, for next to nothing
    const grow = tips.find((t) => t.kind === 'ripGrow')!;
    expect(grow.to).toEqual([5700, 4055]);
    expect(grow.saving).toBeGreaterThan(-50);
    const g = computeDesign(grow.apply(p)).layout!;
    expect(g.boards[g.boards.length - 1].ripped).toBe(false);
  });
  it('shortens a run just over half a board so every board gives two pieces, and turns the boards', () => {
    // 3 m along the house: 2710 runs take a board each; 35 shorter they go two to a board
    const p = rect(3000, 2400);
    const tips = savingTips(p, computeDesign(p));
    const nest = tips.find((t) => t.kind === 'nest')!;
    expect(nest.to).toEqual([2965, 2400]);
    expect(nest.saving).toBeGreaterThan(500);
    const axis = tips.find((t) => t.kind === 'axis')!;
    expect(axis.axis).toBe('y');
    expect(axis.apply(p).params.boardAxis).toBe('y');
    expect(computeDesign(p).bom.total - computeDesign(axis.apply(p)).bom.total).toBeCloseTo(axis.saving, 6);
  });
  it('offers nothing where nothing is gained', () => {
    const p = rect(7200, 4200);
    expect(savingTips(p, computeDesign(p))).toEqual([]);
  });
});
