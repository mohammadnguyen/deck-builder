import { computeDesign, type DesignResult } from '../engine';
import { nestingLengths } from '../engine/breakerplan';
import { bbox, clipHorizontal, clipVertical, edges } from '../engine/geometry';
import { PRODUCT_MAP, stockLengthsOf } from '../model/catalog';
import type { Project } from '../model/types';
import { breakersForAxis } from './breakers';
import { applyDeckMove, moveEdgeTo } from './shapes';

/** A change that buys less for the same deck, or takes out a breaker or the ripped row for next to nothing. */
export interface SavingTip {
  kind: 'axis' | 'breaker' | 'nest' | 'ripShrink' | 'ripGrow';
  /** what the materials come to less (negative: more) */
  saving: number;
  /** the boards' direction (axis tip), or the outline's size before and after (size tips) */
  axis?: 'x' | 'y';
  from?: [number, number];
  to?: [number, number];
  apply: (p: Project) => Project;
}

/** a smaller deck has to save this much more than its smaller area does; a bigger one may cost this much more */
const BEYOND_AREA = 30;
const RIP_FOR = 50;
/** an axis tip saves at least this much */
const AXIS_SAVES = 50;
/** a run this much over one board is worth a size tip */
const OVERRUN = 200;

/**
 * The ways this deck could buy less, priced by designing them: the boards the other way, and a nudge of one edge that
 * takes out a breaker (a run just over one board) or the ripped last row. Several designs: run it when editing stops.
 */
export function savingTips(project: Project, design: DesignResult): SavingTip[] {
  const lay = design.layout;
  if (!design.ok || !lay || project.deck.length < 4) return [];
  const total = (p: Project): number | null => {
    const d = computeDesign(p);
    return d.ok && d.layout ? d.bom.total : null;
  };
  const base = design.bom.total;
  const tips: SavingTip[] = [];

  // the boards the other way
  const now: 'x' | 'y' = lay.swapped ? 'y' : 'x';
  const other: 'x' | 'y' = now === 'x' ? 'y' : 'x';
  const turned = { ...project, params: { ...project.params, boardAxis: other }, breakers: breakersForAxis(project, other) };
  const t = total(turned);
  if (t !== null && base - t >= AXIS_SAVES) {
    tips.push({ kind: 'axis', saving: base - t, axis: other, apply: (p) => ({ ...p, params: { ...p.params, boardAxis: other }, breakers: breakersForAxis(p, other) }) });
  }

  const bb = bbox(project.deck);
  const size = (poly: { x: number; y: number }[]): [number, number] => {
    const b = bbox(poly);
    return [Math.round(b.width), Math.round(b.height)];
  };
  const exposed = edges(project.deck).filter((e) => !project.houseEdges.includes(e.index));
  // an edge at the outline's extreme across `axis` (an edge along `axis`), moved outward by delta
  const nudges = (along: 'x' | 'y', delta: number) =>
    exposed
      .filter((e) => e.axis === along && (along === 'x' ? Math.abs(e.a.y - bb.minY) < 1 || Math.abs(e.a.y - bb.maxY) < 1 : Math.abs(e.a.x - bb.minX) < 1 || Math.abs(e.a.x - bb.maxX) < 1))
      .map((e) => {
        const at = along === 'x' ? e.a.y + e.outward.y * delta : e.a.x + e.outward.x * delta;
        const deck = moveEdgeTo(project.deck, e.index, at);
        if (!deck) return null;
        const apply = (p: Project): Project => {
          const next = moveEdgeTo(p.deck, e.index, at);
          return next ? applyDeckMove(p, next, [e.index]) : p;
        };
        return { project: applyDeckMove(project, deck, [e.index]), apply };
      })
      .filter((x): x is { project: Project; apply: (p: Project) => Project } => !!x);
  // a smaller deck saves what its area is worth anyway: it has to save more than that to be a tip
  const best = (kind: SavingTip['kind'], cands: ReturnType<typeof nudges>, keep: (d: DesignResult) => boolean) => {
    let pick: SavingTip | null = null;
    for (const c of cands) {
      const d = computeDesign(c.project);
      if (!d.ok || !d.layout || !keep(d)) continue;
      const saving = base - d.bom.total;
      const byArea = base * (1 - d.areaM2 / design.areaM2);
      const ok = d.areaM2 < design.areaM2 ? saving - byArea >= BEYOND_AREA : saving >= -RIP_FOR;
      if (ok && (!pick || saving > pick.saving)) pick = { kind, saving, from: size(project.deck), to: size(c.project.deck), apply: c.apply };
    }
    if (pick) tips.push(pick);
  };

  // the longest run between the edge boards
  const decking = PRODUCT_MAP[project.params.deckingProductId];
  const stocks = stockLengthsOf(decking, project.rules);
  const maxBoard = Math.max(...stocks) - project.rules.boardEndAllowance;
  const ys = [...new Set(lay.fieldPoly.map((q) => Math.round(now === 'x' ? q.y : q.x)))].sort((a, b) => a - b);
  let longest = 0;
  for (let i = 0; i + 1 < ys.length; i++) {
    const mid = (ys[i] + ys[i + 1]) / 2;
    for (const [a, b] of now === 'x' ? clipHorizontal(lay.fieldPoly, mid) : clipVertical(lay.fieldPoly, mid)) longest = Math.max(longest, b - a);
  }
  const shorten = (by: number) => nudges(now === 'x' ? 'y' : 'x', -Math.ceil(by / 5) * 5);
  if (lay.breakers.length) {
    // a run just over one board: a little shorter along the boards and the breaker goes
    const over = longest - maxBoard;
    if (over > 0 && over <= OVERRUN) best('breaker', shorten(over), (d) => d.layout!.breakers.length < lay.breakers.length);
  } else {
    // a run just over half (a third ...) of a board: a little shorter and every board gives one piece more
    const nest = nestingLengths(stocks, project.rules.kerf, project.rules.boardEndAllowance, project.rules.minBoardPiece, maxBoard).filter((l) => l < longest);
    const fit = nest.length ? Math.max(...nest) : 0;
    if (fit && longest - fit <= OVERRUN) best('nest', shorten(longest - fit), () => true);
  }

  // the ripped last row: a little less deck and the row goes, or a little more and it is a whole board
  const last = lay.boards[lay.boards.length - 1];
  if (last && last.ripped) {
    const bw = lay.boardWidth;
    const gap = lay.boardGap;
    const noRip = (d: DesignResult) => {
      const end = d.layout!.boards[d.layout!.boards.length - 1];
      return !!end && !(end.ripped && end.width < bw - 1);
    };
    best('ripShrink', nudges(now, -Math.ceil(last.width + gap)), noRip);
    best('ripGrow', nudges(now, Math.ceil(bw - last.width)), noRip);
  }
  return tips.sort((a, b) => b.saving - a.saving).slice(0, 3);
}
