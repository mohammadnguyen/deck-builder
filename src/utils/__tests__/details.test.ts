import { describe, expect, it } from 'vitest';
import { computeDesign } from '../../engine';
import { detectHouseEdges } from '../../engine/geometry';
import { newProject } from '../../model/defaults';
import type { DetailEdits, Project } from '../../model/types';
import { detailCount, joistEdits, joistTarget, lineEdits, moveJoist, moveLine, removeJoist, removeLine, setDoubled, unmoveJoist, unmoveLine } from '../details';

/** a 6 x 4 m deck against the house along the top, 600 high: bearer lines at 23 (the wall), 1340, 2658, 3975 */
function deck(details: DetailEdits | null = null): Project {
  const p = newProject('detail', false);
  p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }];
  p.house = [[{ x: -500, y: 0 }, { x: 6500, y: 0 }]];
  p.houseEdges = detectHouseEdges(p.deck, p.house);
  p.params.deckHeight = 600;
  p.details = details;
  return p;
}

describe('detail mode helpers: bearer lines and joists', () => {
  it('a bearer line moved takes the stumps put in by hand on it along, and back again', () => {
    const d0: DetailEdits = { stumpsAdded: [{ x: 2500, y: 1340 }, { x: 2500, y: 2658 }], stumpsMoved: [{ from: { x: 1525, y: 1340 }, to: { x: 1700, y: 1340 } }] };
    const moved = moveLine(d0, { x: 3000, y: 1340 }, { x: 3000, y: 1200 }, undefined, 'y')!;
    expect(moved.bearersMoved).toEqual([{ from: { x: 3000, y: 1340 }, to: { x: 3000, y: 1200 } }]);
    expect(moved.stumpsAdded).toEqual([{ x: 2500, y: 1200 }, { x: 2500, y: 2658 }]);
    expect(moved.stumpsMoved).toEqual([{ from: { x: 1525, y: 1340 }, to: { x: 1700, y: 1200 } }]);
    // the engine finds the line moved by hand, the stump put in still on it
    const lay = computeDesign(deck(moved)).layout!;
    const edits = lineEdits(lay, moved);
    const k = lay.supports.findIndex((s) => s.pos === 1200);
    expect(edits.get(k)).toEqual({ kind: 'moved', index: 0 });
    expect(lay.posts.some((q) => q.pt.x === 2500 && q.pt.y === 1200)).toBe(true);
    // back to auto: the line and its stumps go back
    const back = unmoveLine(moved, { kind: 'moved', index: 0 }, 1200, 'y');
    expect(back).toEqual(d0);
  });

  it('a bearer line taken out keeps its spot clear; the stumps put in on it go, a spot one left stays clear', () => {
    const d0: DetailEdits = { stumpsAdded: [{ x: 2500, y: 1340 }], stumpsMoved: [{ from: { x: 1525, y: 1340 }, to: { x: 1700, y: 1340 } }] };
    const out = removeLine(d0, { x: 3000, y: 1340 }, undefined, 'y')!;
    expect(out).toEqual({ bearersOff: [{ x: 3000, y: 1340 }], stumpsOff: [{ x: 1525, y: 1340 }] });
    // one put in by hand just goes
    expect(removeLine({ bearersAdded: [{ x: 3000, y: 900 }] }, { x: 3000, y: 900 }, { kind: 'added', index: 0 }, 'y')).toBeNull();
  });

  it('a joist doubled: both of the pair act as one; taken out, moved or undone together', () => {
    const base = computeDesign(deck()).layout!;
    const field = base.joists.find((j) => j.kind === 'field')!;
    const d1 = setDoubled(null, { x: field.pos, y: 2000 }, true, undefined)!;
    expect(d1).toEqual({ joistsDoubled: [{ x: Math.round(field.pos), y: 2000 }] });
    const lay = computeDesign(deck(d1)).layout!;
    const edits = joistEdits(lay, d1);
    const twin = lay.joists.find((j) => j.twin)!;
    expect(edits.get(Math.round(twin.pos * 10))).toMatchObject({ double: 0, twin: true });
    // picking the second of the pair acts on the first
    const target = joistTarget(lay, d1, twin.pos);
    expect(Math.abs(target.pos - field.pos)).toBeLessThanOrEqual(1);
    expect(target.edit).toMatchObject({ double: 0, byDouble: true });
    // moved: the pair goes (a field joist doubled leaves no spot behind)
    const moved = moveJoist(d1, { x: target.pos, y: 2000 }, { x: target.pos + 100, y: 2000 }, target.edit, 'x')!;
    expect(moved).toEqual({ joistsDoubled: [{ x: Math.round(field.pos) + 100, y: 2000 }] });
    // taken out: both go, the spot kept clear
    expect(removeJoist(d1, { x: target.pos, y: 2000 }, target.edit)).toEqual({ joistsOff: [{ x: Math.round(target.pos), y: 2000 }] });
    expect(unmoveJoist(d1, target.edit!)).toBeNull();
    expect(setDoubled(d1, { x: target.pos, y: 2000 }, false, target.edit)).toBeNull();
  });

  it('a joist put in and moved by hand is found again, and counted', () => {
    const d: DetailEdits = { joistsAdded: [{ x: 2000, y: 1200 }], joistsMoved: [{ from: { x: 968, y: 2000 }, to: { x: 900, y: 2000 } }], bearersOff: [{ x: 3000, y: 2658 }] };
    const lay = computeDesign(deck(d)).layout!;
    const edits = joistEdits(lay, d);
    expect(edits.get(20000)).toEqual({ own: { kind: 'added', index: 0 } });
    expect(edits.get(9000)).toEqual({ own: { kind: 'moved', index: 0 } });
    expect(detailCount(d)).toBe(3);
  });
});
