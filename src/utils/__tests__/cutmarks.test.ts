import { describe, expect, it } from 'vitest';
import { computeDesign, type DesignResult } from '../../engine';
import { PRODUCT_MAP } from '../../model/catalog';
import { defaultRules, newProject } from '../../model/defaults';
import type { Project } from '../../model/types';
import { bearerPieces, cutMarks, finishedLength, joistGroups, type CutMarks } from '../cutmarks';

/** the deck from the shop: 11.3 m along the house, a 4.8 m leg running 7.8 m out on the right */
function shopDeck(axis: 'x' | 'y'): Project {
  const p = newProject('shop', true);
  p.deck = [{ x: 0, y: 0 }, { x: 11300, y: 0 }, { x: 11300, y: 7800 }, { x: 6500, y: 7800 }, { x: 6500, y: 2350 }, { x: 0, y: 2350 }];
  p.houseEdges = [0];
  p.house = [[{ x: -1500, y: 0 }, { x: 12800, y: 0 }]];
  p.stairs = [];
  p.params.boardAxis = axis;
  return p;
}

function marked(p: Project): { d: DesignResult; cm: CutMarks } {
  const d = computeDesign(p);
  return { d, cm: cutMarks(d, p.rules, p.params.joistConnection === 'flush') };
}

/** how many pieces of each mark the framing plan shows: joist groups times their joists, every bearer ply piece */
function planTally(d: DesignResult, cm: CutMarks): Map<string, number> {
  const lay = d.layout!;
  const tally = new Map<string, number>();
  const add = (mark: string | undefined, n: number) => tally.set(mark ?? '?', (tally.get(mark ?? '?') ?? 0) + n);
  for (const g of joistGroups(lay, d.frame.joistProductId, cm)) for (const pc of g.pieces) add(pc.mark?.mark, g.joists.length);
  for (const b of lay.bearers) for (const ply of bearerPieces(b, d.frame.bearerProductId, cm)) for (const pc of ply) add(pc.mark?.mark, 1);
  return tally;
}

describe('piece marks', () => {
  it('letters every framing and post cut, longest first within a product', () => {
    for (const p of [newProject('sample', true), shopDeck('x'), shopDeck('y')]) {
      const { d, cm } = marked(p);
      expect(cm.marks.map((m) => m.mark)).toEqual(cm.marks.map((_, i) => String.fromCharCode(65 + i)));
      for (const c of d.bom.cutlists) {
        const cat = PRODUCT_MAP[c.productId]?.category;
        if (cat !== 'framing' && cat !== 'post') continue;
        for (const g of c.groups) for (const cut of g.cuts) expect(cm.of(c.productId, cut)).toBeDefined();
      }
      for (let i = 1; i < cm.marks.length; i++) {
        const [a, b] = [cm.marks[i - 1], cm.marks[i]];
        if (a.productId === b.productId) expect(a.length).toBeGreaterThan(b.length);
      }
    }
  });

  it('puts every joist and bearer piece of the cut list on the plan, under its letter', () => {
    for (const p of [newProject('sample', true), shopDeck('x'), shopDeck('y')]) {
      const { d, cm } = marked(p);
      const tally = planTally(d, cm);
      expect(tally.has('?')).toBe(false);
      for (const m of cm.marks) {
        if (!m.tags.every((t) => t === 'joist' || t === 'bearer' || t === 'wallBearer')) continue;
        expect([m.mark, tally.get(m.mark)]).toEqual([m.mark, m.count]);
      }
    }
  });

  it('labels the shop deck along y: one group for the leg, the long bearers joined once over a stump', () => {
    const { d, cm } = marked(shopDeck('y'));
    const groups = joistGroups(d.layout!, d.frame.joistProductId, cm);
    expect(groups.reduce((n, g) => n + g.joists.length, 0)).toBe(d.layout!.joists.length);
    const leg = groups.find((g) => g.joists.length === 17)!;
    expect(leg.pieces.map((pc) => `${pc.mark?.mark} ${pc.mark?.length}`)).toEqual(['D 4800']);
    // the label sits between two bearers, not on one
    const at = leg.pieces[0].labelAt;
    expect(d.layout!.supports.every((s) => Math.abs(s.pos - at) > 100)).toBe(true);
    const long = d.layout!.bearers.filter((b) => !b.onWall && b.pieces[0].length === 2);
    expect(long.length).toBe(4);
    for (const b of long) {
      const [ply] = bearerPieces(b, d.frame.bearerProductId, cm);
      // scarfed over the stump: each piece runs on 70 past the stump's centre (half the 140 bearer's depth)
      expect(ply.map((pc) => `${pc.mark?.mark} ${pc.mark?.length}`)).toEqual(['C 5304', 'G 2637']);
      // the join over a stump, the labels between stumps
      const stumps = b.posts.map((s) => s.y === b.seg.a.y ? s.x : s.y);
      expect(stumps.some((s) => Math.abs(s - ply[0].to) < 1)).toBe(true);
      for (const pc of ply) expect(stumps.every((s) => Math.abs(s - pc.labelAt) > 50)).toBe(true);
    }
  });

  it('cuts the two plies of a double bearer from opposite ends, so their joins are staggered', () => {
    const { d, cm } = marked(shopDeck('x'));
    expect(d.frame.bearerLaminations).toBe(2);
    let joined = 0;
    for (const b of d.layout!.bearers) {
      const [p1, p2] = bearerPieces(b, d.frame.bearerProductId, cm);
      const j1 = p1.slice(1).map((pc) => pc.from);
      const j2 = p2.slice(1).map((pc) => pc.from);
      if (j1.length) joined++;
      for (const x of j1) expect(j2.every((y) => Math.abs(x - y) > 100)).toBe(true);
      // the second ply is the first one reversed: the same letters, from the other end
      expect(p2.map((pc) => pc.mark?.mark)).toEqual([...p1].reverse().map((pc) => pc.mark?.mark));
    }
    expect(joined).toBeGreaterThan(0);
  });

  it('gives a joist hung flush its clear span between the bearers', () => {
    const p = shopDeck('y');
    p.params.joistConnection = 'flush';
    const { d, cm } = marked(p);
    const bw = d.frame.bearerLaminations * (PRODUCT_MAP[d.frame.bearerProductId]?.width ?? 45);
    const joistMarks = cm.marks.filter((m) => m.tags.includes('joist'));
    expect(joistMarks.length).toBeGreaterThan(0);
    for (const m of joistMarks) expect(m.length).toBe(m.cut);
    for (const g of joistGroups(d.layout!, d.frame.joistProductId, cm)) {
      for (const pc of g.pieces) expect(Math.abs(pc.to - pc.from - bw - pc.mark!.length)).toBeLessThanOrEqual(2);
    }
  });

  it('gives lengths a few mm apart one letter, cut to the longer', () => {
    const p = newProject('big', true);
    p.deck = [{ x: 0, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 9000 }, { x: 0, y: 9000 }];
    p.houseEdges = [0];
    p.house = [[{ x: -500, y: 0 }, { x: 14500, y: 0 }]];
    p.stairs = [];
    const { d, cm } = marked(p);
    // the joists in line under the edge boards and breakers are cut 4519 and 4522; the lapped field joists run on to
    // the bearer's far face, 22.5 longer: 4542 and 4544. Each pair a few mm apart shares a letter, cut to the longer
    const joistCuts = [...new Set(d.layout!.joists.flatMap((j) => j.pieces.map((x) => Math.ceil(x))))].sort((a, b) => a - b);
    expect(joistCuts).toEqual([4519, 4522, 4542, 4544]);
    const marks = joistCuts.map((c) => cm.of(d.frame.joistProductId, c)!);
    expect(marks.map((m) => `${m.mark} ${m.length}`)).toEqual(['H 4502', 'H 4502', 'G 4524', 'G 4524']);
    expect(marks[0].count + marks[2].count).toBe(d.layout!.joists.reduce((n, j) => n + j.pieces.length, 0));
    for (const g of joistGroups(d.layout!, d.frame.joistProductId, cm)) {
      for (const pc of g.pieces) expect(pc.mark!.length - (pc.to - pc.from)).toBeGreaterThanOrEqual(-1);
    }
  });

  it('takes the end allowance off the cut for the finished length', () => {
    const r = defaultRules();
    expect(finishedLength(4820, ['joist'], r)).toBe(4820 - r.joistEndAllowance);
    expect(finishedLength(4820, ['joist'], r, true)).toBe(4820);
    expect(finishedLength(4820, ['bearer'], r, true)).toBe(4820 - r.joistEndAllowance);
    expect(finishedLength(5400, ['decking'], r)).toBe(5400 - r.boardEndAllowance);
    expect(finishedLength(787, ['post'], r)).toBe(787);
  });
});
