import { describe, expect, it } from 'vitest';
import { computeDesign } from '../../engine';
import type { LayoutResult } from '../../engine/layout';
import { newProject } from '../../model/defaults';
import type { Project } from '../../model/types';
import { breakerBays, breakerRoom, breakerSpans, currentBreakers, freezeBreakers, mainBay, nextBreakerId, removeBreaker, snapBreakerEnd, suggestBreaker, updateBreaker } from '../breakers';
import { mirrorProject } from '../shapes';

/** the deck from the shop: 11.3 m along the house, a 4.8 m leg running 7.8 m out on the right */
function shopDeck(): Project {
  const p = newProject('shop', true);
  p.deck = [{ x: 0, y: 0 }, { x: 11300, y: 0 }, { x: 11300, y: 7800 }, { x: 6500, y: 7800 }, { x: 6500, y: 2350 }, { x: 0, y: 2350 }];
  p.houseEdges = [0];
  p.house = [[{ x: -1500, y: 0 }, { x: 12800, y: 0 }]];
  p.stairs = [];
  return p;
}
const lay = (p: Project): LayoutResult => computeDesign(p).layout!;
const spans = (p: Project) => breakerSpans(lay(p)).map((b) => [b.id, Math.round(b.pos), Math.round(b.c0), Math.round(b.c1)]);
/** board runs of the row through `c` across, as [from, to] along */
const runsAt = (l: LayoutResult, c: number) =>
  l.boards
    .filter((r) => Math.abs(r.pos - c) <= r.width / 2)
    .flatMap((r) => r.runs.map((u) => [Math.round(Math.min(u.seg.a.x, u.seg.b.x)), Math.round(Math.max(u.seg.a.x, u.seg.b.x))]));

describe('breakers placed by hand', () => {
  it('stops an automatic breaker at the leg instead of poking one row into it', () => {
    const p = shopDeck();
    expect(spans(p)).toEqual([
      ['B1', 3790, 0, 2205],
      ['B2', 7510, 0, 2175],
    ]);
    expect(lay(p).breakerMode).toBe('auto');
  });

  it('freezes the automatic layout without changing anything', () => {
    const p = shopDeck();
    const before = lay(p);
    const frozen = freezeBreakers(before);
    expect(frozen.axis).toBe('x');
    expect(frozen.items).toEqual([
      { id: 'B1', pos: 3790, from: null, to: null },
      { id: 'B2', pos: 7510, from: null, to: 2175 },
    ]);
    const after = lay({ ...p, breakers: frozen });
    expect(after.breakerMode).toBe('manual');
    expect(breakerSpans(after)).toEqual(breakerSpans(before));
    expect(after.joistPositions).toEqual(before.joistPositions);
    expect(after.totals.boardLm).toBeCloseTo(before.totals.boardLm, 6);
  });

  it('moves a breaker, and the joists under it follow', () => {
    const p = shopDeck();
    const bl = updateBreaker(freezeBreakers(lay(p)), 'B1', { pos: 3000 });
    const l = lay({ ...p, breakers: bl });
    expect(spans({ ...p, breakers: bl })[0]).toEqual(['B1', 3000, 0, 2205]);
    // one joist under each joint of the breaker (board 140, gap 5: joints at 3000 +/- 75)
    const frames = l.joists.filter((j) => j.kind === 'frame').map((j) => Math.round(j.pos * 10) / 10);
    expect(frames.some((x) => Math.abs(x - (3000 - 72.5)) < 1)).toBe(true);
    expect(frames.some((x) => Math.abs(x - (3000 + 72.5)) < 1)).toBe(true);
    // the rows of the top band stop either side of it
    expect(runsAt(l, 1000)).toEqual([[145, 2925], [3075, 7435], [7585, 11155]]);
  });

  it('runs a breaker to the edges, through the leg to the bottom edge board', () => {
    const p = shopDeck();
    const bl = updateBreaker(freezeBreakers(lay(p)), 'B2', { from: null, to: null });
    const l = lay({ ...p, breakers: bl });
    expect(spans({ ...p, breakers: bl })[1]).toEqual(['B2', 7510, 0, 7655]);
    expect(runsAt(l, 5000)).toEqual([[6645, 7435], [7585, 11155]]);
  });

  it('shortens a breaker to a row edge', () => {
    const p = shopDeck();
    const l0 = lay(p);
    const to = snapBreakerEnd(l0, 3790, 1200, 'to', 0);
    expect(to).not.toBeNull();
    // a row's far edge: 140 wide rows at a 145 pitch from the house
    expect(((to as number) + 5) % 145).toBeCloseTo(0, 6);
    const bl = updateBreaker(freezeBreakers(l0), 'B1', { to });
    const l = lay({ ...p, breakers: bl });
    expect(spans({ ...p, breakers: bl })[0]).toEqual(['B1', 3790, 0, Math.round(to as number)]);
    // below its end the rows run through (with joins, as the run is longer than a board)
    expect(runsAt(l, (to as number) + 300).length).toBe(2);
    // at the field edge the end is stored as "to the edge"
    expect(snapBreakerEnd(l0, 3790, 2190, 'to', 0)).toBeNull();
  });

  it('warns about joins when a deleted breaker leaves runs longer than a board', () => {
    const p = shopDeck();
    const bl = removeBreaker(freezeBreakers(lay(p)), 'B1');
    const d = computeDesign({ ...p, breakers: bl });
    expect(d.layout!.breakers.length).toBe(1);
    expect(d.layout!.totals.boardJoins).toBeGreaterThan(0);
    expect(d.warnings.some((w) => w.key === 'layout.breakerJoins')).toBe(true);
    expect(d.method.some((s) => s.notes.some((n) => n.key === 'm.decking.breaker.manual'))).toBe(true);
  });

  it('ignores hand-placed breakers made for the other board direction, and respects "no breakers"', () => {
    const p = shopDeck();
    const bl = freezeBreakers(lay(p));
    const turned = { ...p, breakers: bl, params: { ...p.params, boardAxis: 'y' as const } };
    expect(lay(turned).breakerMode).toBe('auto');
    expect(lay(turned).boardAxis).toBe('y');
    const off = { ...p, breakers: bl, params: { ...p.params, breakerBoards: 'off' as const } };
    expect(lay(off).breakers).toEqual([]);
  });

  it('keeps "to the edge" ends on the edge when the deck grows', () => {
    const p = shopDeck();
    const bl = updateBreaker(freezeBreakers(lay(p)), 'B2', { from: null, to: null });
    const longer = { ...p, breakers: bl, deck: p.deck.map((q) => (q.y === 7800 ? { ...q, y: 9000 } : q)) };
    expect(spans(longer)[1]).toEqual(['B2', 7510, 0, 8855]);
  });

  it('adds a breaker across the middle of the longest run', () => {
    const p = newProject('rect', true);
    p.deck = [{ x: 0, y: 0 }, { x: 4800, y: 0 }, { x: 4800, y: 3600 }, { x: 0, y: 3600 }];
    p.houseEdges = [0];
    p.stairs = [];
    const l0 = lay(p);
    expect(l0.breakers).toEqual([]);
    const s = suggestBreaker(l0)!;
    expect(s).toEqual({ pos: 2400, from: null, to: null });
    const base = currentBreakers(p, l0);
    const id = nextBreakerId(base);
    expect(id).toBe('B1');
    const l = lay({ ...p, breakers: { ...base, items: [...base.items, { id, ...s }] } });
    expect(breakerSpans(l)).toEqual([{ id: 'B1', pos: 2400, c0: 0, c1: 3455 }]);
    // on the L the longest run is the leg's 4.5 m; the new breaker covers the leg's rows only
    const shop = shopDeck();
    const sl = lay(shop);
    const sug = suggestBreaker(sl)!;
    expect(sug.pos).toBe(8900);
    expect(sug.from).toBe(2175);
    expect(sug.to).toBeNull();
  });

  it('keeps a dragged breaker inside the field and clear of its neighbours', () => {
    const p = shopDeck();
    const l = lay(p);
    const [b1, b2] = breakerSpans(l);
    const [lo, hi] = breakerRoom(l, b1.id, b1.pos, b1.c0, b1.c1);
    // 145 field edge + 75 half strip + 300 board on the left; the neighbour's strip + 300 on the right
    expect(lo).toBe(145 + 75 + 300);
    expect(hi).toBe(b2.pos - 75 - 75 - 300);
    const bands = breakerBays(l, b1.id, b1.pos, b1.c0, b1.c1);
    expect(bands.length).toBe(1);
    const main = mainBay(bands)!;
    expect(Math.round(main.before[1] - main.before[0])).toBe(3570);
    expect(Math.round(main.after[1] - main.after[0])).toBe(3570);
  });

  it('mirrors hand-placed breakers with the deck', () => {
    const p = shopDeck();
    const bl = updateBreaker(freezeBreakers(lay(p)), 'B1', { pos: 3000 });
    const m = mirrorProject({ ...p, breakers: bl });
    expect(m.breakers!.items.map((it) => it.pos)).toEqual([11300 - 3000, 11300 - 7510]);
    expect(lay(m).breakerMode).toBe('manual');
  });

  it('edits breakers across the boards when the boards run along y', () => {
    const p = shopDeck();
    p.params.boardAxis = 'y';
    const l = lay(p);
    // one breaker across the leg, continuing the notch edge board line
    expect(breakerSpans(l)).toEqual([{ id: 'B1', pos: 2280, c0: 6645, c1: 11155 }]);
    const bl = updateBreaker(freezeBreakers(l), 'B1', { pos: 4000 });
    expect(bl.axis).toBe('y');
    const l2 = lay({ ...p, breakers: bl });
    expect(breakerSpans(l2)).toEqual([{ id: 'B1', pos: 4000, c0: 6645, c1: 11155 }]);
    const m = mirrorProject({ ...p, breakers: bl });
    expect(m.breakers!.items[0]).toEqual({ id: 'B1', pos: 4000, from: null, to: null });
  });
});
