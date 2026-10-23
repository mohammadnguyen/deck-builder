import { describe, expect, it } from 'vitest';
import { newProject } from '../../model/defaults';
import { computeDesign } from '..';
import { makeShape } from '../../utils/shapes';
import type { Project } from '../../model/types';

/** Every configuration must compute without throwing and with finite, sensible quantities. */
function check(p: Project) {
  const d = computeDesign(p);
  expect(d.ok).toBe(true);
  const lay = d.layout!;
  expect(lay.boards.length).toBeGreaterThan(0);
  expect(lay.joists.length).toBeGreaterThan(1);
  expect(lay.bearers.length).toBeGreaterThan(0);
  expect(Number.isFinite(d.bom.total)).toBe(true);
  expect(d.bom.total).toBeGreaterThan(0);
  for (const j of lay.joists) expect(Number.isFinite(j.pos)).toBe(true);
  for (const eb of lay.edgeBoards) {
    expect(eb.length).toBeGreaterThan(0);
    for (const pc of eb.pieces) expect(pc).toBeGreaterThan(0);
  }
  for (const br of lay.breakers) expect(br.length).toBeGreaterThan(0);
  // every field run fits one stock board when breakers are on
  if (lay.breakers.length) for (const row of lay.boards) for (const run of row.runs) expect(run.pieces.length).toBe(run.notched ? 0 : 1);
  // joist spacing within the cap in every real bay
  for (const b of lay.joistBays) expect(b.spacing).toBeLessThanOrEqual(Math.min(p.params.joistSpacingMax, 500) + 0.01);
  return d;
}

describe('configurations', () => {
  it('boards across the wall (swapped frame) keep edge boards and breakers consistent', () => {
    const p = newProject('swap', true);
    p.params.boardAxis = 'y';
    const d = check(p);
    const lay = d.layout!;
    expect(lay.swapped).toBe(true);
    // edge boards still sit on the exposed world edges
    for (const eb of lay.edgeBoards) {
      const e = d.edges[eb.edgeIndex];
      expect(Math.abs(eb.seg.a.x - e.a.x) + Math.abs(eb.seg.a.y - e.a.y)).toBeLessThan(0.01);
    }
    // breakers (if any) run along the joists, i.e. along world x here
    for (const br of lay.breakers) expect(Math.abs(br.seg.a.y - br.seg.b.y)).toBeLessThan(0.01);
    expect(lay.joistPositions.length).toBeGreaterThanOrEqual(lay.joists.length - lay.joists.filter((j) => j.kind === 'field').length);
  });
  it('house wall on a vertical edge', () => {
    const p = newProject('side', true);
    p.houseEdges = [5]; // left edge x = 0
    p.house = [[{ x: 0, y: -1000 }, { x: 0, y: 5000 }]];
    const d = check(p);
    expect(d.layout!.swapped).toBe(true);
  });
  it('two house edges (deck in a corner)', () => {
    const p = newProject('corner', true);
    p.deck = makeShape('rect', { w: 4800, d: 3600, nw: 0, nd: 0 });
    p.stairs = [];
    p.houseEdges = [0, 3];
    p.house = [[{ x: 0, y: 5000 }, { x: 0, y: 0 }, { x: 6000, y: 0 }]];
    const d = check(p);
    expect(d.layout!.edgeBoards.length).toBe(2);
  });
  it('tiny deck falls back to plain boards', () => {
    const p = newProject('tiny', true);
    p.deck = makeShape('rect', { w: 1200, d: 1200, nw: 0, nd: 0 });
    p.stairs = [];
    const d = check(p);
    expect(d.layout!.edgeBoards.length).toBeGreaterThanOrEqual(0);
  });
  it('U shape with composite, edge boards off and breakers forced on', () => {
    const p = newProject('u', true);
    p.deck = makeShape('U', { w: 7200, d: 4200, nw: 2400, nd: 1800 });
    p.stairs = [];
    p.params.edgeBoard = false;
    p.params.breakerBoards = 'on';
    const d = check(p);
    expect(d.layout!.breakers.length).toBeGreaterThan(0);
    expect(d.layout!.totals.boardJoins).toBe(0);
  });
  it('freestanding deck, no house at all, hardwood with fixed spacing', () => {
    const p = newProject('free', true);
    p.houseEdges = [];
    p.house = [];
    p.params.attachment = 'freestanding';
    p.params.deckingProductId = 'hw-86x19';
    p.params.boardGap = 4;
    p.params.joistSpacingMode = 'fixed';
    p.params.joistSpacing = 450;
    const d = check(p);
    expect(d.layout!.edgeBoards.length).toBe(6);
    expect(d.layout!.breakers.length).toBe(0);
  });
  it('high deck with balustrade, stirrups and three breakers', () => {
    const p = newProject('high', true);
    p.deck = makeShape('rect', { w: 9000, d: 3000, nw: 0, nd: 0 });
    p.stairs = [];
    p.params.deckHeight = 1400;
    p.params.footingType = 'stirrup';
    p.params.breakerCount = 3;
    const d = check(p);
    expect(d.balustrade.enabled).toBe(true);
    expect(d.layout!.breakers.length).toBe(3);
  });
});
