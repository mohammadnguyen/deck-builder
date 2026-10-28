import type { LayoutResult } from '../engine/layout';
import type { DetailEdits, Pt } from '../model/types';

/*
 * Detail mode: single parts changed by hand (edge boards taken off a side, stumps taken out, moved or put in). The
 * engine lays everything else out round them; these helpers make and undo the changes.
 */

const near = (a: Pt, b: Pt, d: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) < d;

/** what is left of the hand changes: null once there are none */
function tidy(d: DetailEdits): DetailEdits | null {
  const out: DetailEdits = {};
  if (d.noEdgeBoard?.length) out.noEdgeBoard = [...d.noEdgeBoard].sort((a, b) => a - b);
  if (d.stumpsOff?.length) out.stumpsOff = d.stumpsOff;
  if (d.stumpsAdded?.length) out.stumpsAdded = d.stumpsAdded;
  if (d.stumpsMoved?.length) out.stumpsMoved = d.stumpsMoved;
  return Object.keys(out).length ? out : null;
}

/** how many parts were changed by hand */
export function detailCount(d: DetailEdits | null | undefined): number {
  if (!d) return 0;
  return (d.noEdgeBoard?.length ?? 0) + (d.stumpsOff?.length ?? 0) + (d.stumpsAdded?.length ?? 0) + (d.stumpsMoved?.length ?? 0);
}

/** an edge board taken off a side (or put back) */
export function setEdgeBoard(d: DetailEdits | null | undefined, index: number, on: boolean): DetailEdits | null {
  const off = new Set(d?.noEdgeBoard ?? []);
  if (on) off.delete(index);
  else off.add(index);
  return tidy({ ...d, noEdgeBoard: [...off] });
}

/** a stump the engine placed was put there by hand: put in (`added`) or moved (`moved`, with the spot it left) */
export type StumpEdit = { kind: 'added'; index: number } | { kind: 'moved'; index: number };

/** For each stump on the plan put there by hand, which change put it there (the stump nearest each, the engine
 *  having snapped it onto its bearer line within 150). */
export function stumpEdits(layout: LayoutResult | undefined, d: DetailEdits | null | undefined): Map<string, StumpEdit> {
  const out = new Map<string, StumpEdit>();
  if (!layout || !d) return out;
  const claim = (pin: Pt, edit: StumpEdit) => {
    let best: { id: string; dist: number } | null = null;
    for (const q of layout.posts) {
      const dd = Math.hypot(q.pt.x - pin.x, q.pt.y - pin.y);
      if (dd < 151 && (!best || dd < best.dist)) best = { id: q.id, dist: dd };
    }
    if (best && !out.has(best.id)) out.set(best.id, edit);
  };
  (d.stumpsAdded ?? []).forEach((q, index) => claim(q, { kind: 'added', index }));
  (d.stumpsMoved ?? []).forEach((m, index) => claim(m.to, { kind: 'moved', index }));
  return out;
}

/** a stump taken out: one the engine placed leaves its spot clear; one put in goes; one moved leaves both spots clear */
export function removeStump(d: DetailEdits | null | undefined, at: Pt, edit: StumpEdit | undefined): DetailEdits | null {
  const cur = d ?? {};
  if (edit?.kind === 'added') return tidy({ ...cur, stumpsAdded: (cur.stumpsAdded ?? []).filter((_, i) => i !== edit.index) });
  if (edit?.kind === 'moved') {
    const m = (cur.stumpsMoved ?? [])[edit.index];
    return tidy({ ...cur, stumpsMoved: (cur.stumpsMoved ?? []).filter((_, i) => i !== edit.index), stumpsOff: [...(cur.stumpsOff ?? []), ...(m ? [m.from, m.to] : [at])] });
  }
  return tidy({ ...cur, stumpsOff: [...(cur.stumpsOff ?? []), { x: Math.round(at.x), y: Math.round(at.y) }] });
}

/** a stump moved along its bearer to `to`: one the engine placed is moved from where it stood; one put in or moved
 *  by hand before just goes to its new spot */
export function moveStump(d: DetailEdits | null | undefined, from: Pt, to: Pt, edit: StumpEdit | undefined): DetailEdits | null {
  const cur = d ?? {};
  const at = { x: Math.round(to.x), y: Math.round(to.y) };
  if (edit?.kind === 'added') return tidy({ ...cur, stumpsAdded: (cur.stumpsAdded ?? []).map((q, i) => (i === edit.index ? at : q)) });
  if (edit?.kind === 'moved') return tidy({ ...cur, stumpsMoved: (cur.stumpsMoved ?? []).map((m, i) => (i === edit.index ? { ...m, to: at } : m)) });
  return tidy({ ...cur, stumpsMoved: [...(cur.stumpsMoved ?? []), { from: { x: Math.round(from.x), y: Math.round(from.y) }, to: at }] });
}

/** a stump put in by hand at a spot on a bearer */
export function addStump(d: DetailEdits | null | undefined, at: Pt): DetailEdits | null {
  const cur = d ?? {};
  return tidy({ ...cur, stumpsAdded: [...(cur.stumpsAdded ?? []), { x: Math.round(at.x), y: Math.round(at.y) }] });
}

/** a moved stump back where the rules put it */
export function unmoveStump(d: DetailEdits | null | undefined, edit: StumpEdit): DetailEdits | null {
  const cur = d ?? {};
  if (edit.kind === 'added') return tidy({ ...cur, stumpsAdded: (cur.stumpsAdded ?? []).filter((_, i) => i !== edit.index) });
  return tidy({ ...cur, stumpsMoved: (cur.stumpsMoved ?? []).filter((_, i) => i !== edit.index) });
}

/** a stump taken out put back: its spot is no longer kept clear */
export function putBackStump(d: DetailEdits | null | undefined, spot: Pt): DetailEdits | null {
  const cur = d ?? {};
  return tidy({ ...cur, stumpsOff: (cur.stumpsOff ?? []).filter((q) => !near(q, spot, 1)) });
}
