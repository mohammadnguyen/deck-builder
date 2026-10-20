import { describe, expect, it } from 'vitest';
import { newProject } from '../../model/defaults';
import { canRedo, canUndo, initHistory, jumpHistory, pushHistory, redoHistory, undoHistory } from '../history';
import { clampEdgeValue, insertNotch, isJogEdge, mirrorProject, moveEdgeTo, moveVertexTo, remapEdgeData, removeJog, samePoly, setEdgeLengthAnchored, shiftHouseLine } from '../shapes';

const L = [
  { x: 0, y: 0 },
  { x: 6000, y: 0 },
  { x: 6000, y: 2400 },
  { x: 3600, y: 2400 },
  { x: 3600, y: 4200 },
  { x: 0, y: 4200 },
];

describe('history', () => {
  it('undoes, redoes, coalesces and truncates', () => {
    let h = initHistory('a', 'open', 0);
    h = pushHistory(h, 'b', 'edge', 1000);
    h = pushHistory(h, 'c', 'edge', 1500); // coalesces with b
    expect(h.entries.length).toBe(2);
    expect(h.entries[1].state).toBe('c');
    h = pushHistory(h, 'd', 'shape', 5000);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    h = undoHistory(h);
    expect(h.entries[h.index].state).toBe('c');
    h = undoHistory(h);
    expect(h.entries[h.index].state).toBe('a');
    expect(canUndo(h)).toBe(false);
    h = redoHistory(h);
    expect(h.entries[h.index].state).toBe('c');
    h = pushHistory(h, 'e', 'stairs', 9000); // drops the redo branch
    expect(h.entries.map((e) => e.state)).toEqual(['a', 'c', 'e']);
    h = jumpHistory(h, 0);
    expect(h.index).toBe(0);
  });
  it('never coalesces into an entry reached by undo', () => {
    let h = initHistory('a', 'open', 0);
    h = pushHistory(h, 'b', 'edge', 1000);
    h = pushHistory(h, 'c', 'edge', 5000);
    h = undoHistory(h); // back at b
    h = pushHistory(h, 'd', 'edge', 5100); // same label, right away: must not overwrite b
    expect(h.entries.map((e) => e.state)).toEqual(['a', 'b', 'd']);
    expect(h.index).toBe(2);
    // an unchanged state is not recorded
    expect(pushHistory(h, 'd', 'edge', 9000)).toBe(h);
  });
});

describe('direct editing', () => {
  it('clamps an edge so its neighbours keep 100 mm', () => {
    // notch bottom edge (index 2, y = 2400) between y 0 (edge 1 start) and y 4200 (edge 3 end)
    expect(clampEdgeValue(L, 2, 50)).toBe(100);
    expect(clampEdgeValue(L, 2, 5000)).toBe(4100);
    const moved = moveEdgeTo(L, 2, 3000)!;
    expect(moved[2].y).toBe(3000);
    expect(moved[3].y).toBe(3000);
  });
  it('moves a vertex with its neighbours and refuses collapsed shapes', () => {
    const moved = moveVertexTo(L, 3, { x: 3000, y: 2000 })!;
    expect(moved[3]).toEqual({ x: 3000, y: 2000 });
    expect(moved[2].y).toBe(2000);
    expect(moved[4].x).toBe(3000);
    const clamped = moveVertexTo(L, 3, { x: 6500, y: 2000 })!;
    expect(clamped[3].x).toBe(5900); // 100 short of the right edge
  });
  it('inserts and removes a notch', () => {
    const rect = [{ x: 0, y: 0 }, { x: 4800, y: 0 }, { x: 4800, y: 3600 }, { x: 0, y: 3600 }];
    const notched = insertNotch(rect, 2, 1200, 600, false)!;
    expect(notched.length).toBe(8);
    const jog = notched.findIndex((_, i) => isJogEdge(notched, i));
    expect(jog).toBeGreaterThanOrEqual(0);
    expect(removeJog(notched, jog)).toEqual(rect);
    const bump = insertNotch(rect, 2, 1200, 600, true)!;
    expect(bump.length).toBe(8);
    expect(Math.max(...bump.map((p) => p.y))).toBe(4200);
    expect(insertNotch(rect, 2, 4700, 600, false)).toBeNull();
  });
  it('mirrors a project and keeps stairs on their edge', () => {
    const p = newProject('m', true);
    const m = mirrorProject(p);
    expect(m.deck[0]).toEqual({ x: 6000, y: 0 });
    expect(m.deck[3]).toEqual({ x: 2400, y: 2400 });
    expect(m.stairs[0].edgeIndex).toBe(4);
    expect(m.stairs[0].offset).toBe(3600 - 1300 - 1000);
    expect(m.houseEdges).toEqual([0]);
  });
  it('does not read the body of a deck as a jog', () => {
    for (let i = 0; i < L.length; i++) expect(isJogEdge(L, i)).toBe(false);
    // a 600 deep notch in a 4800 x 600 strip has the same shoulder length as the body: still only the notch is a jog
    const strip = insertNotch([{ x: 0, y: 0 }, { x: 4800, y: 0 }, { x: 4800, y: 1200 }, { x: 0, y: 1200 }], 2, 1200, 600, false)!;
    const jogs = strip.map((_, i) => isJogEdge(strip, i));
    expect(jogs.filter(Boolean).length).toBe(1);
  });
  it('sets an edge length without sliding the deck off its wall', () => {
    // edge 1 (x = 6000, from the wall at y 0 down to 2400): the far end moves
    const a = setEdgeLengthAnchored(L, 1, 3000, [0])!;
    expect(a[2]).toEqual({ x: 6000, y: 3000 });
    expect(a[1]).toEqual({ x: 6000, y: 0 });
    // edge 5 (x = 0, from 4200 up to the wall at y 0): the start moves, the wall corner stays
    const b = setEdgeLengthAnchored(L, 5, 3000, [0])!;
    expect(b[0]).toEqual({ x: 0, y: 0 });
    expect(b[5]).toEqual({ x: 0, y: 3000 });
    expect(samePoly(b, L)).toBe(false);
    expect(setEdgeLengthAnchored(L, 1, 50, [0])).toBeNull();
  });
  it('keeps house flags and stairs on their edges when a notch is added', () => {
    const p = newProject('r', true);
    p.deck = L;
    p.houseEdges = [0];
    p.stairs = [{ id: 'S1', edgeIndex: 4, offset: 1300, width: 1000, groundOffset: 0 }];
    p.params.balustrade.edgeOverride = { 1: false };
    const notched = insertNotch(L, 5, 1200, 600, false)!; // notch in the left edge: edges after 5 shift
    const r = remapEdgeData(p, notched);
    expect(r.houseEdges).toEqual([0]);
    expect(r.stairs[0].edgeIndex).toBe(4);
    expect(r.stairs[0].offset).toBe(1300);
    expect(r.params.balustrade.edgeOverride).toEqual({ 1: false });
    // a notch in the stair's own edge (edge 4, 3600 long, running from x 3600 to 0): a centred 600 notch
    // cuts x 2100-1500, so a stair at 2300-1300 is lost and a stair at 3500-2500 stays on the first piece
    const n4 = insertNotch(L, 4, 600, 300, false)!;
    expect(remapEdgeData(p, n4).stairs).toEqual([]);
    p.stairs = [{ id: 'S1', edgeIndex: 4, offset: 100, width: 1000, groundOffset: 0 }];
    const r4 = remapEdgeData(p, n4);
    expect(r4.stairs.length).toBe(1);
    expect(r4.stairs[0].edgeIndex).toBe(4);
    expect(r4.stairs[0].offset).toBe(100);
  });
  it('moves the wall line with a dragged house edge', () => {
    const house = [[{ x: -1500, y: 0 }, { x: 7500, y: 0 }], [{ x: 9000, y: 500 }, { x: 9000, y: 3000 }]];
    const moved = shiftHouseLine(house, 'x', 0, -200);
    expect(moved[0]).toEqual([{ x: -1500, y: -200 }, { x: 7500, y: -200 }]);
    expect(moved[1]).toEqual(house[1]);
  });
});
