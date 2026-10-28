import type { LayoutResult } from '../engine/layout';
import type { DetailEdits, Pt } from '../model/types';

/*
 * Detail mode: single parts changed by hand (edge boards taken off a side; stumps, bearer lines and joists taken out,
 * moved or put in; joists doubled). The engine lays everything else out round them; these helpers make and undo the
 * changes.
 */

const near = (a: Pt, b: Pt, d: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) < d;
const round = (q: Pt): Pt => ({ x: Math.round(q.x), y: Math.round(q.y) });
type Axis = 'x' | 'y';

/** what is left of the hand changes: null once there are none */
function tidy(d: DetailEdits): DetailEdits | null {
  const out: DetailEdits = {};
  if (d.noEdgeBoard?.length) out.noEdgeBoard = [...d.noEdgeBoard].sort((a, b) => a - b);
  for (const k of ['stumpsOff', 'stumpsAdded', 'stumpsMoved', 'bearersOff', 'bearersAdded', 'bearersMoved', 'joistsOff', 'joistsAdded', 'joistsMoved', 'joistsDoubled'] as const) {
    const list = d[k];
    if (list?.length) (out as Record<string, unknown>)[k] = list;
  }
  return Object.keys(out).length ? out : null;
}

/** how many parts were changed by hand */
export function detailCount(d: DetailEdits | null | undefined): number {
  if (!d) return 0;
  return Object.values(d).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

/** an edge board taken off a side (or put back) */
export function setEdgeBoard(d: DetailEdits | null | undefined, index: number, on: boolean): DetailEdits | null {
  const off = new Set(d?.noEdgeBoard ?? []);
  if (on) off.delete(index);
  else off.add(index);
  return tidy({ ...d, noEdgeBoard: [...off] });
}

/** a part the engine placed was put there by hand: put in (`added`) or moved (`moved`, with the spot it left) */
export type PartEdit = { kind: 'added'; index: number } | { kind: 'moved'; index: number };
export type StumpEdit = PartEdit;

/** the hand changes of one kind of part: the spots they were taken out of, the ones put in, the ones moved */
const PARTS = {
  stump: { off: 'stumpsOff', added: 'stumpsAdded', moved: 'stumpsMoved' },
  bearer: { off: 'bearersOff', added: 'bearersAdded', moved: 'bearersMoved' },
  joist: { off: 'joistsOff', added: 'joistsAdded', moved: 'joistsMoved' },
} as const;
type Part = keyof typeof PARTS;

/** taken out: one the engine placed leaves its spot clear; one put in goes; one moved leaves both spots clear */
function removePart(part: Part, cur: DetailEdits, at: Pt, edit: PartEdit | undefined): DetailEdits {
  const k = PARTS[part];
  if (edit?.kind === 'added') return { ...cur, [k.added]: (cur[k.added] ?? []).filter((_, i) => i !== edit.index) };
  if (edit?.kind === 'moved') {
    const m = (cur[k.moved] ?? [])[edit.index];
    return { ...cur, [k.moved]: (cur[k.moved] ?? []).filter((_, i) => i !== edit.index), [k.off]: [...(cur[k.off] ?? []), ...(m ? [m.from, m.to] : [round(at)])] };
  }
  return { ...cur, [k.off]: [...(cur[k.off] ?? []), round(at)] };
}

/** moved to `to`: one the engine placed is moved from where it stood; one put in or moved by hand before just goes */
function movePart(part: Part, cur: DetailEdits, from: Pt, to: Pt, edit: PartEdit | undefined): DetailEdits {
  const k = PARTS[part];
  const at = round(to);
  if (edit?.kind === 'added') return { ...cur, [k.added]: (cur[k.added] ?? []).map((q, i) => (i === edit.index ? at : q)) };
  if (edit?.kind === 'moved') return { ...cur, [k.moved]: (cur[k.moved] ?? []).map((m, i) => (i === edit.index ? { ...m, to: at } : m)) };
  return { ...cur, [k.moved]: [...(cur[k.moved] ?? []), { from: round(from), to: at }] };
}

/** back where the rules put it: one put in goes, one moved goes back */
function unmovePart(part: Part, cur: DetailEdits, edit: PartEdit): DetailEdits {
  const k = PARTS[part];
  if (edit.kind === 'added') return { ...cur, [k.added]: (cur[k.added] ?? []).filter((_, i) => i !== edit.index) };
  return { ...cur, [k.moved]: (cur[k.moved] ?? []).filter((_, i) => i !== edit.index) };
}

/** a spot a part was taken out of, put back: it is no longer kept clear */
function putBackPart(part: Part, cur: DetailEdits, spot: Pt): DetailEdits {
  const k = PARTS[part];
  return { ...cur, [k.off]: (cur[k.off] ?? []).filter((q) => !near(q, spot, 1)) };
}

/** For each part put there by hand (`places`: where each such part stands), which change put it there: the part
 *  nearest each hand-placed point within `reach`. */
function claimEdits(places: { key: number; at: number }[], added: Pt[] | undefined, moved: { to: Pt }[] | undefined, along: (q: Pt) => number, reach: number): Map<number, PartEdit> {
  const out = new Map<number, PartEdit>();
  const claim = (pin: Pt, edit: PartEdit) => {
    let best: { key: number; dist: number } | null = null;
    for (const p of places) {
      const dd = Math.abs(p.at - along(pin));
      if (dd < reach && (!best || dd < best.dist)) best = { key: p.key, dist: dd };
    }
    if (best && !out.has(best.key)) out.set(best.key, edit);
  };
  (added ?? []).forEach((q, index) => claim(q, { kind: 'added', index }));
  (moved ?? []).forEach((m, index) => claim(m.to, { kind: 'moved', index }));
  return out;
}

// ---- stumps ----

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
  return tidy(removePart('stump', d ?? {}, at, edit));
}

/** a stump moved along its bearer to `to`: one the engine placed is moved from where it stood; one put in or moved
 *  by hand before just goes to its new spot */
export function moveStump(d: DetailEdits | null | undefined, from: Pt, to: Pt, edit: StumpEdit | undefined): DetailEdits | null {
  return tidy(movePart('stump', d ?? {}, from, to, edit));
}

/** a stump put in by hand at a spot on a bearer */
export function addStump(d: DetailEdits | null | undefined, at: Pt): DetailEdits | null {
  const cur = d ?? {};
  return tidy({ ...cur, stumpsAdded: [...(cur.stumpsAdded ?? []), round(at)] });
}

/** a moved stump back where the rules put it */
export function unmoveStump(d: DetailEdits | null | undefined, edit: StumpEdit): DetailEdits | null {
  return tidy(unmovePart('stump', d ?? {}, edit));
}

/** a stump taken out put back: its spot is no longer kept clear */
export function putBackStump(d: DetailEdits | null | undefined, spot: Pt): DetailEdits | null {
  return tidy(putBackPart('stump', d ?? {}, spot));
}

// ---- bearer lines (each across the deck; `axis`: the coordinate a line's place is measured in) ----

/** the axis a layout's bearer lines are placed along (y when they run along x) */
export const lineAxis = (layout: LayoutResult): Axis => layout.supportAxis;

/** For each bearer line put there by hand (by its index, as the bearers' lineIndex), which change put it there. */
export function lineEdits(layout: LayoutResult | undefined, d: DetailEdits | null | undefined): Map<number, PartEdit> {
  if (!layout || !d) return new Map();
  const ax = lineAxis(layout);
  return claimEdits(layout.supports.map((s, key) => ({ key, at: s.pos })), d.bearersAdded, d.bearersMoved, (q) => q[ax], 1);
}

/** the stumps put in (or moved) by hand that stand on the bearer line at `pos` */
const onLine = (q: Pt, pos: number, ax: Axis): boolean => Math.abs(q[ax] - pos) <= 150;

/** a bearer line taken out (like a stump); the stumps put in by hand on it go with it, a spot one was moved from
 *  staying clear */
export function removeLine(d: DetailEdits | null | undefined, at: Pt, edit: PartEdit | undefined, ax: Axis): DetailEdits | null {
  const cur = removePart('bearer', d ?? {}, at, edit);
  const pos = at[ax];
  const moved = cur.stumpsMoved ?? [];
  return tidy({
    ...cur,
    stumpsAdded: (cur.stumpsAdded ?? []).filter((q) => !onLine(q, pos, ax)),
    stumpsMoved: moved.filter((m) => !onLine(m.to, pos, ax)),
    stumpsOff: [...(cur.stumpsOff ?? []), ...moved.filter((m) => onLine(m.to, pos, ax)).map((m) => m.from)],
  });
}

/** the stumps put in by hand on the line at `pos` moved `by` across with it */
function carryStumps(cur: DetailEdits, pos: number, by: number, ax: Axis): DetailEdits {
  if (Math.abs(by) < 0.5) return cur;
  const shift = (q: Pt): Pt => (ax === 'x' ? { x: Math.round(q.x + by), y: q.y } : { x: q.x, y: Math.round(q.y + by) });
  return {
    ...cur,
    stumpsAdded: (cur.stumpsAdded ?? []).map((q) => (onLine(q, pos, ax) ? shift(q) : q)),
    stumpsMoved: (cur.stumpsMoved ?? []).map((m) => (onLine(m.to, pos, ax) ? { ...m, to: shift(m.to) } : m)),
  };
}

/** a bearer line moved across the joists to `to`, the stumps put in by hand on it going with it */
export function moveLine(d: DetailEdits | null | undefined, from: Pt, to: Pt, edit: PartEdit | undefined, ax: Axis): DetailEdits | null {
  return tidy(carryStumps(movePart('bearer', d ?? {}, from, to, edit), from[ax], to[ax] - from[ax], ax));
}

/** a bearer line put in by hand through a spot */
export function addLine(d: DetailEdits | null | undefined, at: Pt): DetailEdits | null {
  const cur = d ?? {};
  return tidy({ ...cur, bearersAdded: [...(cur.bearersAdded ?? []), round(at)] });
}

/** a bearer line back where the rules put it: one put in goes (with the stumps put in on it), one moved goes back
 *  (they go back with it); `pos`: where it is now */
export function unmoveLine(d: DetailEdits | null | undefined, edit: PartEdit, pos: number, ax: Axis): DetailEdits | null {
  const cur = d ?? {};
  if (edit.kind === 'added') {
    return tidy({ ...unmovePart('bearer', cur, edit), stumpsAdded: (cur.stumpsAdded ?? []).filter((q) => !onLine(q, pos, ax)), stumpsMoved: (cur.stumpsMoved ?? []).filter((m) => !onLine(m.to, pos, ax)) });
  }
  const m = (cur.bearersMoved ?? [])[edit.index];
  const back = m ? m.from[ax] - m.to[ax] : 0;
  return tidy(carryStumps(unmovePart('bearer', cur, edit), pos, back, ax));
}

/** a spot a bearer line was taken out of, put back */
export function putBackLine(d: DetailEdits | null | undefined, spot: Pt): DetailEdits | null {
  return tidy(putBackPart('bearer', d ?? {}, spot));
}

// ---- joists (each along the deck; `at`: a joist's place across the boards) ----

/** what was done to a joist by hand: put in or moved (`own`); doubled (`double`, the index of the change; `twin`: this
 *  is the second joist of the pair; `byDouble`: the first stands only because it was doubled, a field joist) */
export interface JoistEdit {
  own?: PartEdit;
  double?: number;
  twin?: boolean;
  byDouble?: boolean;
}

/** the axis a layout's joists are placed along (x when they run along y) */
export const joistAxis = (layout: LayoutResult): Axis => layout.boardAxis;

/** For each joist line on the plan changed by hand (keyed by its place, to a tenth of a mm), what was done to it. */
export function joistEdits(layout: LayoutResult | undefined, d: DetailEdits | null | undefined): Map<number, JoistEdit> {
  const out = new Map<number, JoistEdit>();
  if (!layout || !d) return out;
  const ax = joistAxis(layout);
  const jt = layout.joistThickness;
  const lines = [...new Map(layout.joists.map((j) => [Math.round(j.pos * 10), j])).values()];
  const places = lines.map((j) => ({ key: Math.round(j.pos * 10), at: j.pos }));
  const get = (key: number): JoistEdit => {
    const e = out.get(key) ?? {};
    out.set(key, e);
    return e;
  };
  for (const [key, own] of claimEdits(places, d.joistsAdded, d.joistsMoved, (q) => q[ax], jt + 1)) get(key).own = own;
  (d.joistsDoubled ?? []).forEach((q, index) => {
    let member: (typeof lines)[number] | undefined;
    for (const j of lines) if (!j.twin && Math.abs(j.pos - q[ax]) < jt + 1 && (!member || Math.abs(j.pos - q[ax]) < Math.abs(member.pos - q[ax]))) member = j;
    if (!member) return;
    const m = member;
    const e = get(Math.round(m.pos * 10));
    if (e.double !== undefined) return;
    e.double = index;
    e.byDouble = m.kind === 'double' && !e.own;
    const twin = lines.find((j) => j.twin && Math.abs(Math.abs(j.pos - m.pos) - jt) < 1 && !out.get(Math.round(j.pos * 10))?.twin);
    if (twin) Object.assign(get(Math.round(twin.pos * 10)), { double: index, twin: true });
  });
  return out;
}

/** a joist (a pair doubled by hand: the first one, `at`) taken out: one the engine placed leaves its spot clear, one
 *  put in goes, one moved leaves both spots clear; a pair goes whole */
export function removeJoist(d: DetailEdits | null | undefined, at: Pt, edit: JoistEdit | undefined): DetailEdits | null {
  let cur = d ?? {};
  if (edit?.double !== undefined) {
    cur = { ...cur, joistsDoubled: (cur.joistsDoubled ?? []).filter((_, i) => i !== edit.double) };
    // a field joist that stood only for the pair goes with it, its spot kept clear like any
  }
  return tidy(removePart('joist', cur, at, edit?.own));
}

/** a joist (a pair: the first one, from `from`) moved across the boards to `to` */
export function moveJoist(d: DetailEdits | null | undefined, from: Pt, to: Pt, edit: JoistEdit | undefined, ax: Axis): DetailEdits | null {
  let cur = d ?? {};
  if (edit?.double !== undefined) {
    const by = to[ax] - from[ax];
    cur = { ...cur, joistsDoubled: (cur.joistsDoubled ?? []).map((q, i) => (i === edit.double ? round(ax === 'x' ? { x: q.x + by, y: q.y } : { x: q.x, y: q.y + by }) : q)) };
    // a field joist doubled stands where its pair is put: nothing more to move
    if (edit.byDouble) return tidy(cur);
  }
  return tidy(movePart('joist', cur, from, to, edit?.own));
}

/** a joist put in by hand through a spot */
export function addJoist(d: DetailEdits | null | undefined, at: Pt): DetailEdits | null {
  const cur = d ?? {};
  return tidy({ ...cur, joistsAdded: [...(cur.joistsAdded ?? []), round(at)] });
}

/** a joist back where the rules put it: put in, moved and doubled by hand undone */
export function unmoveJoist(d: DetailEdits | null | undefined, edit: JoistEdit): DetailEdits | null {
  let cur = d ?? {};
  if (edit.double !== undefined) cur = { ...cur, joistsDoubled: (cur.joistsDoubled ?? []).filter((_, i) => i !== edit.double) };
  return tidy(edit.own ? unmovePart('joist', cur, edit.own) : cur);
}

/** a joist doubled (a second one hard beside it) or back to one */
export function setDoubled(d: DetailEdits | null | undefined, at: Pt, on: boolean, edit: JoistEdit | undefined): DetailEdits | null {
  const cur = d ?? {};
  if (on) return edit?.double !== undefined ? tidy(cur) : tidy({ ...cur, joistsDoubled: [...(cur.joistsDoubled ?? []), round(at)] });
  return tidy({ ...cur, joistsDoubled: (cur.joistsDoubled ?? []).filter((_, i) => i !== edit?.double) });
}

/** a spot a joist was taken out of, put back */
export function putBackJoist(d: DetailEdits | null | undefined, spot: Pt): DetailEdits | null {
  return tidy(putBackPart('joist', d ?? {}, spot));
}

/** the joist a change to the one at `pos` acts on: the first of a pair when this is the second (`twin`), else itself */
export function joistTarget(layout: LayoutResult | undefined, d: DetailEdits | null | undefined, pos: number): { pos: number; edit: JoistEdit | undefined } {
  const edits = joistEdits(layout, d);
  const e = edits.get(Math.round(pos * 10));
  if (e?.twin) for (const [key, m] of edits) if (!m.twin && m.double === e.double) return { pos: key / 10, edit: m };
  return { pos, edit: e };
}
