import { describe, expect, it } from 'vitest';
import { newProject } from '../../model/defaults';
import { canRedo, canUndo, initHistory, jumpHistory, pushHistory, redoHistory, undoHistory } from '../history';
import { clampEdgeValue, insertNotch, isJogEdge, mirrorProject, moveEdgeTo, moveVertexTo, removeJog } from '../shapes';

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
});
