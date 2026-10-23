import { describe, expect, it } from 'vitest';
import { computeDesign } from '../../engine';
import type { LayoutResult } from '../../engine/layout';
import { newProject } from '../../model/defaults';
import type { Project } from '../../model/types';
import { breakerBays, breakerRoom, breakerSpans, breakersForAxis, currentBreakers, extendedBreaker, freezeBreakers, mainBay, movedBreaker, nextBreakerId, removeBreaker, snapBreakerEnd, suggestBreaker, updateBreaker } from '../breakers';
import { housePolylineFor, makeShape, mirrorProject } from '../shapes';

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
  it('lays the automatic breakers 2.7 | 5.4 | 2.7 and carries one on through the leg to the edge board', () => {
    const p = shopDeck();
    // B1 ends at the strip's own edge board; B2, over the leg, runs on to the bottom edge board, which also splits
    // the leg's 4.5 m rows into pieces that nest
    expect(spans(p)).toEqual([
      ['B1', 2885, 0, 2205],
      ['B2', 8415, 0, 7655],
    ]);
    expect(lay(p).breakerMode).toBe('auto');
  });

  it('freezes the automatic layout without changing anything', () => {
    const p = shopDeck();
    const before = lay(p);
    const frozen = freezeBreakers(before);
    expect(frozen.axis).toBe('x');
    expect(frozen.items).toEqual([
      { id: 'B1', pos: 2885, from: null, to: null },
      { id: 'B2', pos: 8415, from: null, to: null },
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
    expect(runsAt(l, 1000)).toEqual([[145, 2925], [3075, 8340], [8490, 11155]]);
  });

  it('keeps a breaker its length when it is moved over the leg', () => {
    const p = shopDeck();
    const l = lay(p);
    const base = freezeBreakers(l);
    const b1 = breakerSpans(l)[0];
    // B1 runs the depth of the top band; moved to x 9000 it must not grow down the leg
    const bl = updateBreaker(base, 'B1', movedBreaker(l, base.items[0], b1, 9000));
    expect(bl.items[0]).toEqual({ id: 'B1', pos: 9000, from: null, to: 2205 });
    expect(spans({ ...p, breakers: bl }).find((s) => s[0] === 'B1')).toEqual(['B1', 9000, 0, 2175]);
    // moved within the top band it keeps running to the edge boards
    expect(updateBreaker(base, 'B1', movedBreaker(l, base.items[0], b1, 3000)).items[0]).toEqual({ id: 'B1', pos: 3000, from: null, to: null });
  });

  it('runs a breaker to the edges, through the leg to the bottom edge board', () => {
    const p = shopDeck();
    const bl = updateBreaker(freezeBreakers(lay(p)), 'B2', { from: null, to: null });
    const l = lay({ ...p, breakers: bl });
    expect(spans({ ...p, breakers: bl })[1]).toEqual(['B2', 8415, 0, 7655]);
    expect(runsAt(l, 5000)).toEqual([[6645, 8340], [8490, 11155]]);
  });

  it('shortens a breaker to a row edge', () => {
    const p = shopDeck();
    const l0 = lay(p);
    const b1pos = breakerSpans(l0)[0].pos;
    const to = snapBreakerEnd(l0, b1pos, 1200, 'to', 0);
    expect(to).not.toBeNull();
    // a row's far edge: 140 wide rows at a 145 pitch from the house
    expect(((to as number) + 5) % 145).toBeCloseTo(0, 6);
    const bl = updateBreaker(freezeBreakers(l0), 'B1', { to });
    const l = lay({ ...p, breakers: bl });
    expect(spans({ ...p, breakers: bl })[0]).toEqual(['B1', b1pos, 0, Math.round(to as number)]);
    // below its end the rows run through (with joins, as the run is longer than a board)
    expect(runsAt(l, (to as number) + 300).length).toBe(2);
    // at the field edge the end is stored as "to the edge"
    expect(snapBreakerEnd(l0, b1pos, 2190, 'to', 0)).toBeNull();
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
    expect(spans(longer)[1]).toEqual(['B2', 8415, 0, 8855]);
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
    // on the L the longest run is now the 5.4 m middle of the strip, between the breakers; the new breaker covers
    // the strip's rows only
    const shop = shopDeck();
    const sl = lay(shop);
    const sug = suggestBreaker(sl)!;
    expect(sug.pos).toBe(5650);
    expect(sug.from).toBeNull();
    expect(sug.to).toBe(2170);
  });

  it('lets a breaker go anywhere inside the field, up to the next breaker but not onto it', () => {
    const p = shopDeck();
    const l = lay(p);
    const [b1, b2] = breakerSpans(l);
    const [lo, hi] = breakerRoom(l, b1.id, b1.pos, b1.c0, b1.c1);
    // the field edge at 145 plus half a strip (board 140 + a 5 gap each side); the neighbour's board one gap away
    expect(lo).toBe(145 + 75);
    expect(hi).toBe(b2.pos - 140 - 5);
    // side by side: the shared joint gets one joist, and no board is left between them
    const bl = updateBreaker(freezeBreakers(l), 'B1', { pos: hi });
    const l2 = lay({ ...p, breakers: bl });
    expect(breakerSpans(l2).map((b) => b.pos)).toEqual([hi, b2.pos]);
    expect(runsAt(l2, 1000)).toEqual([[145, Math.round(hi - 75)], [Math.round(b2.pos + 75), 11155]]);
    const bands = breakerBays(l, b1.id, b1.pos, b1.c0, b1.c1);
    expect(bands.length).toBe(1);
    const main = mainBay(bands)!;
    expect(Math.round(main.before[1] - main.before[0])).toBe(2665);
    expect(Math.round(main.after[1] - main.after[0])).toBe(5380);
  });

  it('mirrors hand-placed breakers with the deck', () => {
    const p = shopDeck();
    const bl = updateBreaker(freezeBreakers(lay(p)), 'B1', { pos: 3000 });
    const m = mirrorProject({ ...p, breakers: bl });
    expect(m.breakers!.items.map((it) => it.pos)).toEqual([11300 - 3000, 11300 - 8415]);
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


/**
 * Every row is covered once: at each row centre the field is boards or breaker strips, with no stretch over
 * 12 mm left bare (shorter bits are taken up by the gaps) and no board lying under a breaker.
 */
function coverage(l: LayoutResult): { holes: string[]; overlaps: string[] } {
  const P = (q: { x: number; y: number }) => (l.boardAxis === 'x' ? q : { x: q.y, y: q.x });
  const field = l.fieldPoly.map(P);
  const bw = l.boardWidth;
  const strip = bw + 2 * l.boardGap;
  const runs = l.boards.flatMap((r) =>
    r.runs.map((u) => {
      const a = P(u.seg.a);
      const b = P(u.seg.b);
      return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), yc: a.y, w: u.width };
    }),
  );
  const brk = l.breakers.map((b) => {
    const a = P(b.seg.a);
    const c = P(b.seg.b);
    return { id: b.id, xc: a.x, y0: Math.min(a.y, c.y), y1: Math.max(a.y, c.y) };
  });
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  const overlaps: string[] = [];
  for (const r of runs) for (const b of brk) if (ov(r.x0, r.x1, b.xc - bw / 2, b.xc + bw / 2) > 1 && ov(r.yc - r.w / 2, r.yc + r.w / 2, b.y0, b.y1) > 1) overlaps.push(`board y${Math.round(r.yc)} under ${b.id}`);
  for (let i = 0; i < brk.length; i++) for (let j = i + 1; j < brk.length; j++) {
    const a = brk[i];
    const b = brk[j];
    if (ov(a.xc - bw / 2, a.xc + bw / 2, b.xc - bw / 2, b.xc + bw / 2) > 1 && ov(a.y0, a.y1, b.y0, b.y1) > 1) overlaps.push(`${a.id} on ${b.id}`);
  }
  const holes: string[] = [];
  const clipX = (y: number): [number, number][] => {
    const xs: number[] = [];
    for (let i = 0; i < field.length; i++) {
      const a = field[i];
      const b = field[(i + 1) % field.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
  };
  for (const y of new Set(runs.map((r) => r.yc))) {
    const cov = [
      ...runs.filter((r) => y >= r.yc - r.w / 2 - 0.01 && y <= r.yc + r.w / 2 + 0.01).map((r) => [r.x0, r.x1]),
      ...brk.filter((b) => y >= b.y0 - 0.5 && y <= b.y1 + 0.5).map((b) => [b.xc - strip / 2, b.xc + strip / 2]),
    ].sort((p, q) => p[0] - q[0]);
    for (const [a, c] of clipX(y)) {
      let cur = a;
      for (const [m0, m1] of cov) {
        if (m1 <= cur) continue;
        if (m0 >= c) break;
        if (m0 - cur > 12) holes.push(`y${Math.round(y)} x${Math.round(cur)}-${Math.round(m0)}`);
        cur = Math.max(cur, m1);
      }
      if (c - cur > 12) holes.push(`y${Math.round(y)} x${Math.round(cur)}-${Math.round(c)}`);
    }
  }
  return { holes, overlaps };
}
const clean = (l: LayoutResult) => expect(coverage(l)).toEqual({ holes: [], overlaps: [] });

/** a U deck whose boards run along its legs: the 5.9 m runs are split 1.4 | 2.7 | 1.4, so one breaker crosses the
 *  base from edge to edge and each leg gets its own on the same line */
function uDeck(): Project {
  const p = newProject('u', true);
  p.deck = makeShape('U', { w: 10800, d: 6000, nw: 3000, nd: 3000 });
  p.houseEdges = [0];
  p.house = [housePolylineFor(p.deck, 0)];
  p.stairs = [];
  p.params = { ...p.params, boardAxis: 'y' };
  return p;
}

describe('breakers on decks with legs, and at notches', () => {
  it('freezes the breakers of a U deck leg by leg, so editing one leaves the other alone', () => {
    const p = uDeck();
    const l = lay(p);
    const auto = breakerSpans(l);
    expect(auto.length).toBe(3);
    // the base breaker runs edge board to edge board, carried across the base's shorter middle rows
    expect([auto[0].c0, auto[0].c1]).toEqual([145, 10655]);
    // the two leg breakers share a line
    expect(auto[1].pos).toBe(auto[2].pos);
    clean(l);
    const frozen = freezeBreakers(l);
    // the outer end of each leg runs to the edge; the inner end is a number, or it would reach into the other leg
    expect(frozen.items.map((it) => [it.from === null, it.to === null])).toEqual([[true, true], [true, false], [false, true]]);
    const lf = lay({ ...p, breakers: frozen });
    expect(breakerSpans(lf)).toEqual(auto);
    expect(lf.totals.breakerLm).toBeCloseTo(l.totals.breakerLm, 6);
    // delete one leg's: the other leg keeps its breaker, this leg has none
    const del = lay({ ...p, breakers: removeBreaker(frozen, 'B2') });
    expect(breakerSpans(del)).toEqual([auto[0], auto[2]]);
    // nudge one: only that one moves
    const moved = updateBreaker(frozen, 'B2', movedBreaker(l, frozen.items[1], auto[1], auto[1].pos + 10));
    const lm = lay({ ...p, breakers: moved });
    expect(breakerSpans(lm).sort((a, b) => a.id.localeCompare(b.id))).toEqual([auto[0], { ...auto[1], pos: auto[1].pos + 10 }, auto[2]]);
    clean(lm);
  });

  it('keeps end drags, "Run to the edges" and "+ Add one" inside their own leg', () => {
    const p = uDeck();
    const l = lay(p);
    const [, b2] = breakerSpans(l);
    const frozen = freezeBreakers(l);
    // dragging the leg breaker's inner end back to the leg's edge gives a number, not "to the edge"
    const to = snapBreakerEnd(l, b2.pos, b2.c1 + 500, 'to', b2.c0, 'B2');
    expect(to).toBeCloseTo(b2.c1, 6);
    // "Run to the edges" runs to the ends of its own leg
    const ext = extendedBreaker(l, b2);
    expect(ext).toEqual({ from: null, to: b2.c1 });
    expect(breakerSpans(lay({ ...p, breakers: updateBreaker(frozen, 'B2', ext) }))).toEqual(breakerSpans(l));
    // with all deleted, "+ Add one" puts one breaker in one place
    const none = { ...p, breakers: { axis: frozen.axis, items: [] } };
    const s = suggestBreaker(lay(none))!;
    const added = lay({ ...none, breakers: { axis: frozen.axis, items: [{ id: 'B1', ...s }] } });
    expect(breakerSpans(added).length).toBe(1);
    clean(added);
  });

  it('stops "Run to the edges" at a breaker in the way', () => {
    const p = shopDeck();
    const bl = { axis: 'x' as const, items: [{ id: 'B1', pos: 3790, from: null, to: 1010 }, { id: 'B2', pos: 3800, from: 1160, to: null }] };
    const l = lay({ ...p, breakers: bl });
    const b1 = breakerSpans(l).find((b) => b.id === 'B1')!;
    const ext = extendedBreaker(l, b1);
    expect(ext).toEqual({ from: null, to: 1160 });
    const l2 = lay({ ...p, breakers: updateBreaker(bl, 'B1', ext) });
    expect(coverage(l2).overlaps).toEqual([]);
    // and an end dragged towards it stops short of it
    expect(snapBreakerEnd(l, 3790, 2000, 'to', 0, 'B1')).toBeLessThanOrEqual(1160);
  });

  it('adds a breaker over a board run, never on top of a breaker or over a ripped strip', () => {
    // B1 shortened to about 1 m: "+ Add one" covers the rows below it, not the ones B1 already cuts
    const p = shopDeck();
    const l0 = lay(p);
    const to = snapBreakerEnd(l0, breakerSpans(l0)[0].pos, 1000, 'to', 0, 'B1');
    const bl = updateBreaker(freezeBreakers(l0), 'B1', { to });
    const l1 = lay({ ...p, breakers: bl });
    const s = suggestBreaker(l1)!;
    const l2 = lay({ ...p, breakers: { ...bl, items: [...bl.items, { id: nextBreakerId(bl), ...s }] } });
    expect(l2.breakers.length).toBe(3);
    clean(l2);
    // the leg moved over so a ripped strip at the notch line is as long as the leg's rows: still a real breaker
    const q = shopDeck();
    q.deck = [{ x: 0, y: 0 }, { x: 11300, y: 0 }, { x: 11300, y: 7800 }, { x: 6600, y: 7800 }, { x: 6600, y: 2350 }, { x: 0, y: 2350 }];
    q.params = { ...q.params, boardAxis: 'y' };
    const lq = lay(q);
    const sq = suggestBreaker(lq);
    expect(sq).not.toBeNull();
    const base = currentBreakers(q, lq);
    const lq2 = lay({ ...q, breakers: { ...base, items: [...base.items, { id: nextBreakerId(base), ...sq! }] } });
    expect(lq2.breakers.length).toBe(lq.breakers.length + 1);
    clean(lq2);
  });

  it('never leaves a hole or a board under a breaker that ends at a notch', () => {
    // the sample L with a breaker set by hand to continue the inside-corner edge board; moved a little either way
    const p = newProject('l', true);
    clean(lay(p));
    const base = { axis: 'x' as const, items: [{ id: 'B1', pos: 3530, from: null, to: 2255 }] };
    const l = lay({ ...p, breakers: base });
    clean(l);
    const [b1] = breakerSpans(l);
    for (const dx of [-140, -70, -10, 10, 40, 70]) {
      const lm = lay({ ...p, breakers: updateBreaker(base, b1.id, movedBreaker(l, base.items[0], b1, b1.pos + dx)) });
      expect(coverage(lm)).toEqual({ holes: [], overlaps: [] });
    }
    // an end left a little short of the notch line (as a mirror can leave it) runs to the line
    const short = lay({ ...p, breakers: { axis: base.axis, items: [{ ...base.items[0], to: b1.c1 - 15 }] } });
    expect(breakerSpans(short)[0].c1).toBeCloseTo(b1.c1, 6);
  });

  it('lays and lists a breaker one row long, and gives none to a breaker that comes to nothing', () => {
    const p = newProject('hw', true);
    p.deck = makeShape('rect', { w: 8000, d: 3000, nw: 0, nd: 0 });
    p.houseEdges = [0];
    p.house = [housePolylineFor(p.deck, 0)];
    p.stairs = [];
    p.params = { ...p.params, deckingProductId: 'hw-86x19', boardGap: 4, breakerBoards: 'on' };
    const one = lay({ ...p, breakers: { axis: 'x', items: [{ id: 'B1', pos: 4000, from: null, to: 86 }] } });
    expect(breakerSpans(one)).toEqual([{ id: 'B1', pos: 4000, c0: 0, c1: 86 }]);
    expect(one.totals.breakerPieces).toBe(1);
    clean(one);
    const nothing = lay({ ...p, breakers: { axis: 'x', items: [{ id: 'B1', pos: 4000, from: 0, to: 30 }] } });
    expect(nothing.breakers).toEqual([]);
    expect(nothing.joists.some((j) => j.kind === 'frame' && Math.abs(j.pos - 4000) < 100)).toBe(false);
  });

  it('lays a short board piece next to a breaker instead of leaving a hole, and says so', () => {
    const p = newProject('rect', true);
    p.deck = makeShape('rect', { w: 4800, d: 3600, nw: 0, nd: 0 });
    p.houseEdges = [0];
    p.house = [housePolylineFor(p.deck, 0)];
    p.stairs = [];
    // field from 145; a breaker strip 150 wide starting 50 mm in
    const d = computeDesign({ ...p, breakers: { axis: 'x', items: [{ id: 'B1', pos: 145 + 50 + 75, from: null, to: null }] } });
    clean(d.layout!);
    expect(runsAt(d.layout!, 1000)[0]).toEqual([145, 195]);
    expect(d.warnings.find((w) => w.key === 'layout.breakerShortPiece')?.params).toEqual({ n: 24, len: 50 });
  });

  it('applies hand-placed breakers only where breakers are on for the decking, and keeps them for later', () => {
    const p = newProject('l', true);
    const l = lay(p);
    const [b1] = breakerSpans(l);
    const base = freezeBreakers(l);
    const bl = updateBreaker(base, b1.id, movedBreaker(l, base.items[0], b1, b1.pos - 300));
    const hw = computeDesign({ ...p, breakers: bl, params: { ...p.params, deckingProductId: 'hw-86x19', boardGap: 4 } });
    expect(hw.breakersOn).toBe(false);
    expect(hw.layout!.breakers).toEqual([]);
    expect(hw.layout!.breakerMode).toBe('auto');
    const back = lay({ ...p, breakers: bl });
    expect(back.breakerMode).toBe('manual');
    expect(breakerSpans(back)[0].pos).toBe(b1.pos - 300);
  });

  it('keeps hand-placed breakers when the direction picked is the one the boards already run', () => {
    const p = shopDeck();
    const bl = freezeBreakers(lay(p));
    const q = { ...p, breakers: bl };
    expect(breakersForAxis(q, 'x')).toBe(bl);
    expect(breakersForAxis(q, 'auto')).toBe(bl);
    expect(breakersForAxis(q, 'y')).toBeNull();
  });
});

describe('composite joist spacing', () => {
  it('never sets fixed joist centres wider than the decking allows', () => {
    const p = newProject('l', true);
    p.params = { ...p.params, joistSpacingMode: 'fixed', joistSpacing: 450 };
    const d = computeDesign(p);
    expect(d.joistSpacingCap).toBe(400);
    expect(d.joistSetoutSpacing).toBe(400);
    expect(d.layout!.joistSpacingUsed).toBeLessThanOrEqual(400.5);
  });

  it('reports the decking limit before a deck is drawn', () => {
    const p = newProject('blank');
    const d = computeDesign(p);
    expect(d.ok).toBe(false);
    expect(d.joistSpacingCap).toBe(400);
    expect(d.joistSpacingTarget).toBe(400);
  });
});
