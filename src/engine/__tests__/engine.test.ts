import { describe, expect, it } from 'vitest';
import { defaultRules, newProject } from '../../model/defaults';
import { PRODUCT_MAP } from '../../model/catalog';
import type { Project } from '../../model/types';
import { bestBreakerSplit, nestingLengths, symmetricSplits } from '../breakerplan';
import { packPieces, pieceWaste, splitRun, splitRunStocked } from '../cutlist';
import { bayLabel, joistMaxSpan, joistSpaces } from '../layout';
import { clipHorizontal, clipVertical, detectHouseEdges, edges, normalizePolygon, polygonAreaMm2, validatePolygon } from '../geometry';
import { computeDesign } from '../index';

const L = [
  { x: 0, y: 0 },
  { x: 6000, y: 0 },
  { x: 6000, y: 2400 },
  { x: 3600, y: 2400 },
  { x: 3600, y: 4200 },
  { x: 0, y: 4200 },
];

describe('geometry', () => {
  it('computes area of an L shape', () => {
    expect(polygonAreaMm2(L) / 1e6).toBeCloseTo(6 * 2.4 + 3.6 * 1.8, 5);
  });
  it('clips horizontal lines through notches', () => {
    expect(clipHorizontal(L, 1000)).toEqual([[0, 6000]]);
    expect(clipHorizontal(L, 3000)).toEqual([[0, 3600]]);
    expect(clipVertical(L, 5000)).toEqual([[0, 2400]]);
    expect(clipVertical(L, 1000)).toEqual([[0, 4200]]);
  });
  it('finds outward normals', () => {
    const E = edges(L);
    expect(E[0].outward).toEqual({ x: 0, y: -1 });
    expect(E[1].outward).toEqual({ x: 1, y: 0 });
    expect(E[2].outward).toEqual({ x: 0, y: 1 }); // notch edge faces down/out
    expect(E[3].outward).toEqual({ x: 1, y: 0 });
  });
  it('validates and normalizes', () => {
    expect(validatePolygon(L).ok).toBe(true);
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }]).ok).toBe(false);
    const merged = normalizePolygon([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]);
    expect(merged.length).toBe(4);
  });
  it('detects house edges from a wall polyline', () => {
    expect(detectHouseEdges(L, [[{ x: -1000, y: 0 }, { x: 7000, y: 0 }]])).toEqual([0]);
  });
});

describe('cutlist', () => {
  it('packs pieces into stock and shrinks bins', () => {
    const r = packPieces([2300, 2300, 1100, 1100, 600], [2400, 3000, 3600, 4800], 5);
    expect(r.totalPieceLength).toBe(7400);
    expect(r.oversize).toEqual([]);
    expect(r.totalStockLength).toBeLessThanOrEqual(2 * 3600 + 2400);
    for (const b of r.bins) expect(b.used).toBeLessThanOrEqual(b.stock);
  });
  it('mixes lengths in one cut list when that buys less timber', () => {
    // two 4.5 m pieces from 4.8s, four 2.5 m pieces from two 5.4s cut in half
    const r = packPieces([4500, 4500, 2500, 2500, 2500, 2500], [3600, 4800, 5400, 6000], 5);
    expect(r.totalStockLength).toBe(2 * 4800 + 2 * 5400);
    expect(r.stockCount).toEqual([{ length: 5400, count: 2 }, { length: 4800, count: 2 }]);
    expect(r.groups.find((g) => g.stock === 5400)!.cuts).toEqual([2500, 2500]);
  });
  it('never buys more than the best single length would', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stocks = [3600, 4800, 5400, 6000];
    for (let t = 0; t < 60; t++) {
      const pieces = Array.from({ length: 3 + Math.floor(rnd() * 25) }, () => 300 + Math.round(rnd() * 5600));
      const mixed = packPieces(pieces, stocks, 5).totalStockLength;
      const longest = Math.max(...pieces);
      for (const L of stocks.filter((s) => s >= longest)) expect(mixed).toBeLessThanOrEqual(packPieces(pieces, [L], 5).totalStockLength);
    }
  });
  it('weighs a cut by how cleanly it comes out of the stocked lengths', () => {
    const stocks = [3600, 4800, 5400, 6000];
    // half a 5.4: 2 x 2520 + kerf leaves 355, shared by two pieces
    expect(pieceWaste(2520, stocks, 5)).toBeCloseTo(177.5, 6);
    expect(pieceWaste(5400, stocks, 5)).toBe(0);
    expect(pieceWaste(6100, stocks, 5)).toBe(Infinity);
  });
  it('splits a run with the fewest joins, over supports, where the pieces cut cleanly', () => {
    const stocks = [3600, 4800, 5400, 6000];
    // a 9 m run over bearers every 900: one join is enough; of the bearers that allow it, the one that leaves
    // a whole 5.4 and a whole 3.6 (less the end trim)
    const sup = [900, 1800, 2700, 3600, 4500, 5400, 6300, 7200, 8100];
    const r = splitRunStocked(0, 9000, sup, stocks, 20, 5, 600)!;
    expect(r.joins.length).toBe(1);
    expect(r.pieces.reduce((s, p) => s + p, 0)).toBe(9000);
    expect(sup).toContain(r.joins[0]);
    expect(r.pieces.map((p) => pieceWaste(p + 20, stocks, 5)).reduce((s, w) => s + w, 0)).toBeLessThanOrEqual(
      splitRun(0, 9000, sup, 5980, 600).pieces.map((p) => pieceWaste(p + 20, stocks, 5)).reduce((s, w) => s + w, 0),
    );
    // a run that fits one stick is never joined
    expect(splitRunStocked(0, 5900, sup, stocks, 20, 5, 600)!.joins).toEqual([]);
    // no support in reach: no carpenter's split (the caller joins off a support and warns)
    expect(splitRunStocked(0, 9000, [], stocks, 20, 5, 600)).toBeNull();
  });
  it('splits long runs at supports', () => {
    const r = splitRun(0, 9000, [450, 900, 1350, 1800, 2250, 2700, 3150, 3600, 4050, 4500, 4950, 5400, 5850, 6300, 6750, 7200, 7650, 8100, 8550], 5380, 600);
    expect(r.pieces.reduce((s, p) => s + p, 0)).toBe(9000);
    expect(r.joins).toEqual([4950]);
    expect(r.offSupport).toBe(false);
  });
});

describe('design', () => {
  it('designs the sample L deck', () => {
    const p = newProject('test', true);
    const d = computeDesign(p);
    expect(d.ok).toBe(true);
    expect(d.areaM2).toBeCloseTo(20.88, 2);
    expect(d.layout).not.toBeNull();
    const lay = d.layout!;
    // three bearer lines: house side, notch edge and far edge (far-side edge of the notch leg)
    expect(lay.supports.filter((s) => s.kind !== 'inter').length).toBe(3);
    expect(lay.posts.length).toBeGreaterThan(6);
    expect(lay.joists.length).toBeGreaterThan(10);
    for (const j of lay.joists) expect(j.pieces.length).toBeGreaterThanOrEqual(1);
    expect(lay.joistSpanUsed).toBeLessThanOrEqual(lay.maxJoistSpan + 1);
    for (const b of lay.bearers) expect(b.postSpacing).toBeLessThanOrEqual(b.maxSpan + 1);
    // single 140x45 bearers follow the company grid: posts at up to 1500 centres
    for (const b of lay.bearers) expect(b.maxSpan).toBe(1500);
    expect(Math.max(...lay.bearers.map((b) => b.postSpacing))).toBeLessThanOrEqual(1500);
    expect(d.stairs.length).toBe(1);
    // 450 rise: 3 risers of 150, two 140 boards per tread give a 270 going, 2R+G = 570
    expect(d.stairs[0].risers).toBe(3);
    expect(d.stairs[0].riser).toBeCloseTo(150, 3);
    expect(d.stairs[0].going).toBe(270);
    expect(d.stairs[0].boardsPerTread).toBe(2);
    expect(d.stairs[0].twoRG).toBeCloseTo(570, 3);
    expect(d.bom.lines.length).toBeGreaterThan(5);
    expect(d.bom.total).toBeGreaterThan(0);
    expect(d.method.length).toBeGreaterThan(5);
    // field boards + edge boards + breakers cover the area
    const boardLm = (lay.totals.boardLm + lay.totals.edgeBoardLm + lay.totals.breakerLm) / 1000;
    expect(boardLm).toBeGreaterThan((d.areaM2 * 1000) / (140 + 5) * 0.9);
    // joists on top of single 140x45 bearers, skew nailed, composite boards on hidden clips
    expect(lay.totals.joistBearerCrossings).toBeGreaterThan(20);
    expect(lay.totals.hangers).toBe(0);
    expect(d.bom.lines.some((l) => l.productId === 'nail-75x3.05')).toBe(true);
    expect(d.bom.lines.some((l) => l.productId === 'triple-grip')).toBe(false);
    const clip = d.bom.lines.find((l) => l.productId === 'camo-edge-clip');
    expect(clip && clip.qty).toBeGreaterThan(100);
    expect(d.bom.lines.some((l) => l.productId === 'screw-batten-14gx100')).toBe(true);
    expect(d.bom.lines.some((l) => l.productId === 'weed-mat')).toBe(true);
    expect(d.bom.lines.some((l) => l.productId === 'tape-joist')).toBe(true);
    // perimeter bearers sit at the deck edge (25 mm to centre), joist ends flush
    const last = lay.supports[lay.supports.length - 1];
    expect(Math.abs(last.pos - (4200 - 25))).toBeLessThan(1);
    // composite is set out at 400 centres from the start of each bay, the short space last
    expect(d.joistSetout).toBe(true);
    expect(d.joistSpacingText).toBe('400');
    expect(lay.joistSpacingUsed).toBeLessThanOrEqual(400);
    // the 6 m strip is split 1.78 | 1.86 | 1.78 by two breakers (thirds of 5.4 m boards at the ends); the notch
    // edge at 3.6 m splits the middle bay
    expect(lay.joistBays.map((b) => bayLabel(b))).toEqual(['4 x @400 + 156', '3 x @400 + 164', '354', '4 x @400 + 156']);
    expect(d.method.some((s) => s.notes.some((n) => n.key === 'm.joists.setout'))).toBe(true);
    // picture frame: one edge board per exposed edge, four mitred corners, field inset by board + gap
    expect(lay.edgeBoards.length).toBe(5);
    expect(lay.totals.mitres).toBe(4);
    expect(lay.edgeBoards.find((e) => e.edgeIndex === 1)!.startCorner).toBe('butt');
    expect(lay.edgeBoards.find((e) => e.edgeIndex === 2)!.endCorner).toBe('concave');
    expect(lay.edgeBoards.find((e) => e.edgeIndex === 2)!.length).toBeCloseTo(2400 + 140, 3);
    expect(lay.fieldPoly).toEqual([{ x: 145, y: 0 }, { x: 5855, y: 0 }, { x: 5855, y: 2255 }, { x: 3455, y: 2255 }, { x: 3455, y: 4055 }, { x: 145, y: 4055 }]);
    // a touching pair under each of the three exposed joist-parallel edges, and one joist under each joint of the
    // two breakers (at 1996 and 4004, symmetric on the 6 m strip)
    expect(lay.totals.frameJoists).toBe(10);
    expect(lay.joists.filter((j) => j.kind === 'frame').map((j) => Math.round(j.pos * 10) / 10)).toEqual([122.5, 167.5, 1923.5, 2068.5, 3432.5, 3477.5, 3931.5, 4076.5, 5832.5, 5877.5]);
    // 4055 of field is exactly 28 rows, but row 16 (2175-2315) crosses the notch line at 2255:
    // right of the notch that row is an 80 mm strip against the notch edge board, in two pieces either side of
    // the breaker; left of it full boards either side of the other breaker
    expect(lay.rips).toEqual([{ row: 16, width: 80, boards: 2 }]);
    const row16 = lay.boards[15];
    expect(row16.runs.filter((r) => r.ripped).map((r) => [Math.round(r.seg.a.x), Math.round(r.seg.b.x), Math.round(r.width)])).toEqual([[3455, 3929, 80], [4079, 5855, 80]]);
    expect(row16.runs.filter((r) => !r.ripped).map((r) => [Math.round(r.seg.a.x), Math.round(r.seg.b.x), Math.round(r.width)])).toEqual([[145, 1921, 140], [2071, 3455, 140]]);
    expect(d.footings.diameter).toBe(200);
    expect(d.footings.bags).toBeLessThan(30);
    expect(d.edgeBoardProductId).toBe('modelo-endboard-140x23');
    // composite: the 5710 run above the notch is split 1.78 | 1.86 | 1.78 by two symmetric breakers (thirds of a
    // 5.4 m board at the ends); the one over the leg carries on through the leg to the far edge board (its 1.78 and
    // 1.38 m pieces go three to a board, where a whole 3.31 m run takes a board of its own), the other stops at the
    // notch line
    expect(lay.breakers.map((b) => [b.seg.a.x, b.seg.a.y, b.seg.b.y, b.aligned])).toEqual([[1996, 0, 4055, false], [4004, 0, 2255, false]]);
    expect(lay.totals.boardJoins).toBe(0);
    for (const row of lay.boards) for (const run of row.runs) expect(run.pieces.length).toBe(1);
    expect(lay.boards[0].runs.map((r) => Math.round(r.length))).toEqual([1776, 1858, 1776]);
    expect(lay.boards[20].runs.map((r) => Math.round(r.length))).toEqual([1776, 1384]);
    expect(d.bom.lines.find((l) => l.productId === 'modelo-140x23')!.tags).toContain('breaker');
    const eb = d.bom.lines.find((l) => l.productId === 'modelo-endboard-140x23');
    expect(eb && eb.tags).toEqual(['edgeBoard']);
    expect(d.bom.lines.some((l) => l.tags.includes('fascia'))).toBe(false);
    expect(d.bom.pricesIncludeGst).toBe(true);
    expect(d.bom.total).toBeCloseTo(d.bom.linesTotal - d.bom.discount + d.bom.delivery, 6);
    expect(d.levels.groundClearance).toBe(450 - 23 - 90 - 140);
  });
  it('hangs joists flush between bearers on joist supports', () => {
    const p = newProject('flush', true);
    p.params.joistConnection = 'flush';
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.totals.hangers).toBe(lay.joists.reduce((s, j) => s + j.pieces.length * 2, 0));
    expect(lay.totals.joistBearerCrossings).toBe(0);
    expect(Math.abs(lay.supports[0].pos - 22.5)).toBeLessThan(1); // wall bearer against the wall
    expect(Math.abs(lay.supports[lay.supports.length - 1].pos - 4200 + 45)).toBeLessThan(1); // perimeter bearer at the edge
    expect(d.bom.lines.some((l) => l.productId === 'js-9045')).toBe(true);
    expect(d.levels.groundClearance).toBe(450 - 23 - 140);
  });
  it('supports joists on top of bearers with triple grips', () => {
    const p = newProject('ontop', true);
    p.params.joistConnection = 'onTop';
    p.params.joistFixing = 'tripleGrip';
    p.params.bearerToPost = 'bolted';
    p.params.deckingProductId = 'hw-86x19';
    p.params.boardGap = 4;
    p.params.joistSpacing = 450;
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.totals.joistBearerCrossings).toBeGreaterThan(20);
    expect(lay.totals.hangers).toBe(0);
    expect(d.bom.lines.some((l) => l.productId === 'triple-grip')).toBe(true);
    expect(d.bom.lines.some((l) => l.productId === 'bolt-m12-hdg')).toBe(true);
    expect(d.bom.lines.some((l) => l.productId === 'screw-deck-10gx50')).toBe(true);
    expect(d.levels.groundClearance).toBe(450 - 19 - 90 - 140);
  });
  it('switches to balustrade and elevated loads at 1 m', () => {
    const p = newProject('high', true);
    p.params.deckHeight = 1500;
    const d = computeDesign(p);
    expect(d.balustrade.enabled).toBe(true);
    expect(d.balustrade.posts.length).toBeGreaterThan(4);
    expect(d.warnings.some((w) => w.key === 'compliance.heightExempt')).toBe(true);
    expect(d.braces.count).toBeGreaterThan(0);
  });
  it('puts blocks on an existing slab without concrete', () => {
    const p = newProject('slab', true);
    p.params.footingType = 'slab';
    p.params.attachment = 'freestanding';
    const d = computeDesign(p);
    expect(d.footings.concreteM3).toBe(0);
    expect(d.footings.bags).toBe(0);
    expect(d.bom.lines.some((l) => l.productId === 'rapid-set-20kg')).toBe(false);
    expect(d.postLength).toBe(Math.round(d.levels.postTop));
    expect(d.warnings.some((w) => w.key === 'compliance.slabBlocks')).toBe(true);
  });
  it('spreads joists evenly within the cap and interpolates spans', () => {
    const rules = defaultRules();
    const auto = { ...newProject('a', true).params, joistSpacingMode: 'auto' as const, joistSpacingMax: 500 };
    expect(joistSpaces(3310, auto, rules, 500)).toBe(7); // 472.9
    expect(joistSpaces(1050, auto, rules, 500)).toBe(3); // 525 would break the cap
    expect(joistSpaces(900, auto, rules, 500)).toBe(2); // 450
    expect(joistMaxSpan(rules, 'tp-90x45', 400).span).toBe(1500);
    expect(joistMaxSpan(rules, 'tp-90x45', 425).span).toBe(1450);
    expect(joistMaxSpan(rules, 'tp-90x45', 500).span).toBe(1330);
    expect(joistMaxSpan(rules, 'tp-90x45', 350).span).toBe(1500);
    expect(joistMaxSpan(rules, 'tp-90x45', 900).extrapolated).toBe(true);
  });
  it('sets fixed spacing out from the start of each bay, with the short space last', () => {
    // hardwood, fixed 450: 7 x 450 + 223 and 5 x 450 + 59 in the sample bays
    const p = newProject('hw', true);
    p.params.deckingProductId = 'hw-86x19';
    p.params.boardGap = 4;
    p.params.joistSpacingMode = 'fixed';
    p.params.joistSpacing = 450;
    const d = computeDesign(p);
    expect(d.joistSetout).toBe(true);
    expect(d.joistSpacingText).toBe('450');
    for (const b of d.layout!.joistBays) {
      expect(b.spaces.slice(0, -1).every((s) => Math.abs(s - 450) < 1e-6)).toBe(true);
      expect(b.spaces[b.spaces.length - 1]).toBeLessThanOrEqual(450 + 1e-6);
    }
    // composite can be evened out instead with the company rule switched off
    const even = newProject('even', true);
    even.rules.compositeJoistSetout = false;
    const de = computeDesign(even);
    expect(de.joistSetout).toBe(false);
    expect(de.layout!.joistBays.map((b) => bayLabel(b))).toEqual(['5 x @351', '4 x @341', '354', '5 x @351']);
  });
  it('puts the last set-out joist hard against a fixed joist it would land on', () => {
    // 2055 wide, no edge boards: edge joists at 22.5 and 2032.5, a 2010 bay; the 5th mark at 2022.5 sits on the edge joist
    const p = newProject('t', true);
    p.deck = [{ x: 0, y: 0 }, { x: 2055, y: 0 }, { x: 2055, y: 2000 }, { x: 0, y: 2000 }];
    p.houseEdges = [0];
    p.stairs = [];
    p.params.edgeBoard = false;
    p.params.breakerBoards = 'off';
    const lay = computeDesign(p).layout!;
    expect(lay.joistBays.map((b) => bayLabel(b))).toEqual(['4 x @400 + 365 + 45']);
    const xs = [...lay.joistPositions].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(45 - 1e-6);
  });
  it('keeps fixed spacing and respects the decking cap', () => {
    const p = newProject('fixed', true);
    p.params.joistSpacingMode = 'fixed';
    p.params.joistSpacing = 400;
    const d = computeDesign(p);
    expect(d.layout!.joistSpacingUsed).toBeLessThanOrEqual(400);
    const hw = newProject('hw', true);
    hw.params.deckingProductId = 'hw-86x19';
    hw.params.boardGap = 4;
    const dh = computeDesign(hw);
    expect(dh.layout!.joistSpacingUsed).toBeLessThanOrEqual(450); // 19 mm hardwood caps at 450
    expect(dh.edgeBoardProductId).toBe('hw-86x19'); // no solid-edge product: same board, counted separately
    expect(dh.bom.lines.find((l) => l.productId === 'hw-86x19')!.tags).toContain('edgeBoard');
  });
  it('lays breakers where the boards waste least, symmetric, and skips them for timber', () => {
    const p = newProject('rect', true);
    p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3600 }, { x: 0, y: 3600 }];
    p.stairs = [];
    const d = computeDesign(p);
    const lay = d.layout!;
    // a 5.71 m run: one breaker leaves two 2.78 m pieces, each a whole board; three leave quarters of a 5.4,
    // four to a board, which saves far more than the two breakers they add
    expect(lay.breakers.map((b) => Math.round(b.seg.a.x))).toEqual([1535, 3000, 4465]);
    expect(lay.breakers.every((b) => !b.aligned && Math.abs(b.length - 3455) < 1)).toBe(true); // wall to the far edge board
    expect(lay.boards[0].runs.map((r) => Math.round(r.length))).toEqual([1315, 1315, 1315, 1315]);
    const deckCuts = d.bom.cutlists.find((c) => c.productId === 'modelo-140x23')!;
    const main = deckCuts.groups.reduce((a, g) => (g.count > a.count ? g : a));
    expect(main.cuts).toEqual([1335, 1335, 1335, 1335]);
    expect(lay.totals.boardJoins).toBe(0);
    // one joist under each breaker joint, centred on the gap so it carries both the breaker and the board ends
    const frames = lay.joists.filter((j) => j.kind === 'frame').map((j) => Math.round(j.pos * 10) / 10);
    expect(frames).toEqual([122.5, 167.5, 1462.5, 1607.5, 2927.5, 3072.5, 4392.5, 4537.5, 5832.5, 5877.5]);
    // 3455 of field = 23 full rows + 120: the last row is ripped and reported
    expect(lay.rips).toEqual([{ row: 24, width: 120, boards: 4 }]);
    expect(d.warnings.some((w) => w.key === 'layout.rip')).toBe(true);
    expect(d.warnings.some((w) => w.key === 'layout.breakerSaving')).toBe(false);
    // one breaker set by hand: in the middle, and the tool says three would save boards
    p.params.breakerCount = 1;
    const d1 = computeDesign(p);
    expect(d1.layout!.breakers.map((b) => Math.round(b.seg.a.x))).toEqual([3000]);
    const saving = d1.warnings.find((w) => w.key === 'layout.breakerSaving');
    expect(saving && saving.params && saving.params.n).toBe(3);
    const boards = (dd: typeof d) => dd.bom.lines.find((l) => l.productId === 'modelo-140x23')!.qty;
    expect(boards(d)).toBeLessThan(boards(d1) - 20);
    const hw = newProject('hw', true);
    hw.params.deckingProductId = 'hw-86x19';
    hw.params.boardGap = 4;
    const dh = computeDesign(hw);
    expect(dh.layout!.breakers.length).toBe(0);
    expect(dh.layout!.totals.boardJoins).toBeGreaterThan(0);
    hw.params.breakerBoards = 'on';
    expect(computeDesign(hw).layout!.breakers.length).toBeGreaterThan(0);
  });
  it('lays no breaker on a run that fits one board, and whole boards where they fit', () => {
    const rect = (w: number, h: number) => {
      const p = newProject('r', true);
      p.deck = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
      p.houseEdges = [0];
      p.house = [[{ x: -500, y: 0 }, { x: w + 500, y: 0 }]];
      p.stairs = [];
      return computeDesign(p);
    };
    // 5.6 m: a 5.31 m run fits one board
    expect(rect(5600, 3000).layout!.breakers).toEqual([]);
    // the shop's 11.3 m strip: 2.7 | 5.4 | 2.7, two boards a row with next to nothing left over
    const p = newProject('shop', true);
    p.deck = [{ x: 0, y: 0 }, { x: 11300, y: 0 }, { x: 11300, y: 7800 }, { x: 6500, y: 7800 }, { x: 6500, y: 2350 }, { x: 0, y: 2350 }];
    p.houseEdges = [0];
    p.house = [[{ x: -1500, y: 0 }, { x: 12800, y: 0 }]];
    p.stairs = [];
    p.params.boardAxis = 'x';
    const d = computeDesign(p);
    const xs = d.layout!.breakers.map((b) => b.seg.a.x);
    expect(xs.length).toBe(2);
    expect(xs[0] + xs[1]).toBeCloseTo(11300, 0); // symmetric
    expect(d.layout!.boards[0].runs.map((r) => Math.round(r.length))).toEqual([2665, 5380, 2665]);
  });
  it('lays boards to the edge when the picture frame is off', () => {
    const p = newProject('plain', true);
    p.params.edgeBoard = false;
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.edgeBoards.length).toBe(0);
    expect(lay.fieldPoly).toEqual(d.poly);
    // composite still gets its breakers: the 6 m run split 1.5 | 2.7 | 1.5, symmetric
    expect(lay.breakers.map((b) => b.seg.a.x)).toEqual([1586.5, 4413.5]);
    expect(lay.boards[0].runs.map((r) => Math.round(r.length))).toEqual([1512, 2677, 1512]);
    expect(lay.totals.frameJoists).toBe(4); // the breakers' own joists
    expect(d.bom.lines.some((l) => l.productId === 'modelo-endboard-140x23')).toBe(false);
  });
  it('sizes stairs from a given height to the NCC band', () => {
    const p = newProject('stairs', true);
    p.stairs[0].rise = 1200;
    const d = computeDesign(p);
    const s = d.stairs[0];
    expect(s.rise).toBe(1200);
    expect(s.risers).toBe(7); // 171 risers
    expect(s.riser).toBeGreaterThanOrEqual(115);
    expect(s.riser).toBeLessThanOrEqual(190);
    expect(s.going).toBeGreaterThanOrEqual(240);
    expect(s.going).toBeLessThanOrEqual(355);
    expect(s.twoRG).toBeGreaterThanOrEqual(550);
    expect(s.twoRG).toBeLessThanOrEqual(700);
    expect(s.boardsPerTread * (140 + 5) - 5 - 15).toBe(s.going);
    expect(s.warnings.length).toBe(0);
    expect(s.handrail).toBe(true);
    // 19 mm hardwood: three 86 boards make a 251 going
    const hw = newProject('hw stairs', true);
    hw.params.deckHeight = 700;
    hw.params.deckingProductId = 'hw-86x19';
    hw.params.boardGap = 4;
    const sh = computeDesign(hw).stairs[0];
    expect(sh.boardsPerTread).toBe(3);
    expect(sh.going).toBe(251);
    expect(sh.twoRG).toBeGreaterThanOrEqual(550);
  });
  it('rejects a non orthogonal polygon', () => {
    const p = newProject('bad');
    p.deck = [{ x: 0, y: 0 }, { x: 1000, y: 200 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];
    const d = computeDesign(p);
    expect(d.ok).toBe(false);
    expect(d.problem).toBe('notOrthogonal');
  });
  it('anchors the house-side bearer to the wall and drops its posts', () => {
    // the same frame on both, so only the wall makes the difference
    const wall = newProject('wall', true);
    wall.params.attachment = 'wall';
    wall.params.frameSizing = 'fixed';
    const free = newProject('free', true);
    free.params.attachment = 'freestanding';
    free.params.frameSizing = 'fixed';
    const dw = computeDesign(wall);
    const df = computeDesign(free);
    expect(dw.layout!.attachment).toBe('wall');
    expect(dw.layout!.ledgers.length).toBe(1);
    const wallRun = dw.layout!.bearers.find((b) => b.onWall)!;
    expect(wallRun.posts.length).toBe(0);
    expect(Math.abs(wallRun.seg.a.y - 22.5)).toBeLessThan(1); // single 45 bearer against the wall
    expect(dw.layout!.posts.length).toBeLessThan(df.layout!.posts.length);
    expect(dw.bom.lines.some((l) => l.productId === 'dynabolt-m12x100')).toBe(true);
    expect(dw.layout!.totals.hangers).toBe(0); // joists sit on the wall bearer
    // a wall bearer needs a house edge parallel to the bearers
    wall.params.boardAxis = 'y';
    const d2 = computeDesign(wall);
    expect(d2.layout!.swapped).toBe(true);
    expect(d2.layout!.attachment).toBe('freestanding');
  });
  it('puts a wall bearer only along the house wall and posts under the rest of that line', () => {
    // the house sits in the inside corner of the L: wall on the notch bottom (edge 2, x 3600-6000)
    const p = newProject('wall', true);
    p.deck = L;
    p.houseEdges = [2];
    p.house = [[{ x: 3600, y: 2400 }, { x: 7500, y: 2400 }]];
    p.stairs = [];
    const d = computeDesign(p);
    expect(d.ok).toBe(true);
    const lay = d.layout!;
    const wallLine = lay.bearers.filter((b) => b.onWall);
    expect(wallLine.length).toBe(1);
    expect(Math.round(wallLine[0].seg.a.x)).toBeGreaterThanOrEqual(3600);
    expect(Math.round(wallLine[0].seg.b.x)).toBeLessThanOrEqual(6000);
    const sameLine = lay.bearers.filter((b) => Math.abs(b.seg.a.y - wallLine[0].seg.a.y) < 0.5 && !b.onWall);
    expect(sameLine.length).toBe(1);
    expect(sameLine[0].posts.length).toBeGreaterThan(0);
    // the two pieces abut at the wall end, so the joists ending there keep their bearing
    expect(Math.round(sameLine[0].seg.b.x)).toBe(3600);
    expect(Math.round(wallLine[0].seg.a.x)).toBe(3600);
    expect(Math.round(wallLine[0].seg.b.x)).toBe(6000 - defaultRules().bearerEndInset);
  });
  it('gives every house wall on a line its wall bearer and keeps the rows clear of the breakers', () => {
    // a deck wrapping a projecting room: two walls on y = 0 either side of the bump-in
    const p = newProject('bump', true);
    p.deck = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 4000, y: 1000 }, { x: 4000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 0, y: 3000 }];
    p.houseEdges = [0, 1, 2, 3, 4];
    p.house = [[{ x: -1500, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 4000, y: 1000 }, { x: 4000, y: 0 }, { x: 7500, y: 0 }]];
    p.stairs = [];
    const d = computeDesign(p);
    expect(d.ok).toBe(true);
    const lay = d.layout!;
    const topLine = lay.bearers.filter((b) => b.seg.a.y < 100);
    expect(topLine.length).toBe(2);
    expect(topLine.every((b) => b.onWall && b.posts.length === 0)).toBe(true);
    expect(lay.ledgers.map((l) => l.edgeIndex).sort()).toEqual([0, 2, 4]);
    // no strip thinner than 40 mm is ripped
    expect(lay.rips.every((r) => r.width >= 40)).toBe(true);
    expect(lay.boards.flatMap((r) => r.runs).every((r) => r.width >= 40 && r.length >= 50)).toBe(true);
  });
  it('stops the boards at a breaker that crosses a notch line', () => {
    // wide composite L: the upper band's breaker and the lower band's breaker sit at different x
    const p = newProject('wide', true);
    p.deck = [{ x: 0, y: 0 }, { x: 7000, y: 0 }, { x: 7000, y: 2400 }, { x: 6000, y: 2400 }, { x: 6000, y: 4200 }, { x: 0, y: 4200 }];
    p.houseEdges = [0];
    p.house = [[{ x: -1500, y: 0 }, { x: 8500, y: 0 }]];
    p.stairs = [];
    const d = computeDesign(p);
    expect(d.ok).toBe(true);
    const lay = d.layout!;
    expect(lay.breakers.length).toBeGreaterThanOrEqual(2);
    type S = { a: { x: number; y: number }; b: { x: number; y: number } };
    const rect = (seg: S, w: number) => {
      const horizontal = Math.abs(seg.a.y - seg.b.y) < 0.5;
      return horizontal
        ? { x0: Math.min(seg.a.x, seg.b.x), x1: Math.max(seg.a.x, seg.b.x), y0: seg.a.y - w / 2, y1: seg.a.y + w / 2 }
        : { x0: seg.a.x - w / 2, x1: seg.a.x + w / 2, y0: Math.min(seg.a.y, seg.b.y), y1: Math.max(seg.a.y, seg.b.y) };
    };
    const overlaps: string[] = [];
    for (const br of lay.breakers) {
      const B = rect(br.seg, br.width);
      for (const row of lay.boards) {
        for (const run of row.runs) {
          const R = rect(run.seg, run.width);
          const ox = Math.min(B.x1, R.x1) - Math.max(B.x0, R.x0);
          const oy = Math.min(B.y1, R.y1) - Math.max(B.y0, R.y0);
          if (ox > 1 && oy > 1) overlaps.push('row ' + (row.index + 1) + ' x ' + Math.round(R.x0) + '..' + Math.round(R.x1) + ' vs breaker ' + Math.round(B.x0) + '..' + Math.round(B.x1));
        }
      }
    }
    expect(overlaps).toEqual([]);
    // the breakers end on board-row boundaries, never part-way through a row they cross
    for (const br of lay.breakers) {
      for (const y of [br.seg.a.y, br.seg.b.y]) {
        const inRow = lay.boards.some((row) => y > row.pos - row.width / 2 + 0.5 && y < row.pos + row.width / 2 - 0.5 && row.runs.some((r) => Math.min(r.seg.a.x, r.seg.b.x) <= br.seg.a.x && Math.max(r.seg.a.x, r.seg.b.x) >= br.seg.a.x));
        expect(inRow).toBe(false);
      }
    }
  });
  it('frames by the company rules: stumps under bearer ends and joins, joist joins over bearers, the yard lengths', () => {
    const decks: [string, { x: number; y: number }[], number[]][] = [
      ['sample L', L, [0]],
      ['shop L', [{ x: 0, y: 0 }, { x: 11300, y: 0 }, { x: 11300, y: 7800 }, { x: 6500, y: 7800 }, { x: 6500, y: 2350 }, { x: 0, y: 2350 }], [0]],
      ['wide rect, freestanding', [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 4800 }, { x: 0, y: 4800 }], []],
    ];
    for (const [name, deck, houseEdges] of decks) {
      for (const lam of [1, 2] as const) {
        for (const axis of ['x', 'y'] as const) {
          const p = newProject(name, true);
          p.deck = deck;
          p.houseEdges = houseEdges;
          p.house = houseEdges.length ? [[{ x: -1500, y: 0 }, { x: 13500, y: 0 }]] : [];
          p.stairs = [];
          p.params.bearerLaminations = lam;
          p.params.boardAxis = axis;
          if (!houseEdges.length) p.params.attachment = 'freestanding';
          const d = computeDesign(p);
          const lay = d.layout!;
          const half = (d.postProductId === 'post-100x100-h4' ? 100 : 90) / 2;
          for (const b of lay.bearers) {
            if (b.onWall) continue;
            const horizontal = Math.abs(b.seg.a.y - b.seg.b.y) < 0.5;
            const at = (q: { x: number; y: number }) => (horizontal ? q.x : q.y);
            const posts = b.posts.map(at).sort((a, c) => a - c);
            const lo = Math.min(at(b.seg.a), at(b.seg.b));
            const hi = Math.max(at(b.seg.a), at(b.seg.b));
            // every join sits on a stump centre (each piece half), and the two laminations join on different stumps
            for (const joins of b.splices) for (const j of joins) expect(posts.some((x) => Math.abs(x - j) < 0.5)).toBe(true);
            if (b.splices.length === 2) for (const j of b.splices[0]) expect(b.splices[1].some((k) => Math.abs(k - j) < 0.5)).toBe(false);
            // the ends sit fully on their stumps (a house end keeps its stump off the wall)
            if (!b.houseStart) expect(posts[0] - half).toBeLessThanOrEqual(lo + 0.5);
            if (!b.houseEnd) expect(posts[posts.length - 1] + half).toBeGreaterThanOrEqual(hi - 0.5);
          }
          // joist joins only over a bearer
          const supports = lay.supports.map((s) => s.pos);
          for (const j of lay.joists) for (const sp of j.splices) expect(supports.some((x) => Math.abs(x - sp) < 0.5)).toBe(true);
          // framing pine in the yard's lengths only (a cut list may mix them), and no join warnings
          for (const l of d.bom.lines) if (PRODUCT_MAP[l.productId]?.yardLengths) for (const s of l.stockBreakdown ?? []) expect(p.rules.timberLengths).toContain(s.length);
          expect(d.warnings.some((w) => w.key === 'layout.bearerJoinOffPost' || w.key === 'layout.joistJoinOffBearer')).toBe(false);
        }
      }
    }
  });
  it('never joins a joist or a bearer that fits one stick', () => {
    const d = computeDesign(newProject('s', true)); // 4.2 m joists, 6 m bearers on stumps
    expect(d.layout!.joists.every((j) => j.splices.length === 0)).toBe(true);
    // the joists come in the lengths the yard stocks
    const joists = d.bom.lines.find((l) => l.productId === 'tp-90x45')!;
    for (const s of joists.stockBreakdown!) expect([3600, 4800, 5400, 6000]).toContain(s.length);
  });
  it('cuts 2.5 m joists from 5.4 m sticks in half, like a carpenter', () => {
    const p = newProject('2.5 m', true);
    p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 2500 }, { x: 0, y: 2500 }];
    p.houseEdges = [0];
    p.house = [[{ x: -500, y: 0 }, { x: 6500, y: 0 }]];
    p.stairs = [];
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.joists.every((j) => j.splices.length === 0 && Math.round(j.length) === 2500)).toBe(true);
    const cuts = d.bom.cutlists.find((c) => c.productId === d.frame.joistProductId)!;
    const joistSticks = cuts.groups.filter((g) => g.cuts.includes(2520));
    expect(joistSticks.every((g) => g.stock === 5400 && g.cuts.length === 2)).toBe(true);
    expect(joistSticks.reduce((n, g) => n + g.count * 2, 0)).toBe(lay.joists.length);
  });
  it('buys only the lengths the owner ticks', () => {
    const p = newProject('s', true);
    p.rules.timberLengths = [4800, 6000];
    const d = computeDesign(p);
    for (const l of d.bom.lines) if (PRODUCT_MAP[l.productId]?.yardLengths) for (const s of l.stockBreakdown ?? []) expect([4800, 6000]).toContain(s.length);
  });
});

describe('the most practical frame', () => {
  const shop = (): Project => {
    const p = newProject('shop', true);
    p.deck = [{ x: 0, y: 0 }, { x: 11300, y: 0 }, { x: 11300, y: 7800 }, { x: 6500, y: 7800 }, { x: 6500, y: 2350 }, { x: 0, y: 2350 }];
    p.houseEdges = [0];
    p.house = [[{ x: -1500, y: 0 }, { x: 12800, y: 0 }]];
    p.stairs = [];
    return p;
  };
  const fixedOf = (p: Project): Project => ({ ...p, params: { ...p.params, frameSizing: 'fixed' } });

  it('keeps the standard frame where nothing else is clearly cheaper', () => {
    const d = computeDesign(newProject('sample', true));
    expect(d.frame).toMatchObject({ auto: true, standard: true, joistProductId: 'tp-90x45', bearerProductId: 'tp-140x45', bearerLaminations: 1 });
    expect(d.layout!.posts.length).toBe(computeDesign(fixedOf(newProject('sample', true))).layout!.posts.length);
  });

  it('uses deeper joists on a big deck when the stumps they save pay for them, and says how much', () => {
    const p = shop();
    const d = computeDesign(p);
    const std = computeDesign(fixedOf(p));
    expect(d.frame.standard).toBe(false);
    expect(d.frame.joistProductId).toBe('tp-140x45');
    expect(d.layout!.posts.length).toBeLessThan(std.layout!.posts.length);
    expect(d.frame.standardStumps).toBe(std.layout!.posts.length);
    // the saving is real: materials plus stump labour, more than the margin
    const labour = p.rules.stumpLabour ?? 40;
    const saving = std.bom.total + labour * std.layout!.posts.length - (d.bom.total + labour * d.layout!.posts.length);
    expect(d.frame.saving).toBeCloseTo(saving, 6);
    expect(saving).toBeGreaterThan(p.rules.frameSwitchMargin ?? 100);
    // the frame used is the one drawn, listed and ordered
    expect(d.bom.lines.some((l) => l.productId === 'tp-140x45' && l.tags.includes('joist'))).toBe(true);
    expect(d.method.length).toBeGreaterThan(0);
    // with no labour counted the timber alone decides, and the standard frame is cheaper
    const noLabour = computeDesign({ ...p, rules: { ...p.rules, stumpLabour: 0 } });
    expect(noLabour.frame.standard).toBe(true);
  });

  it('only uses the sizes on the list, and only frames that fit under the deck', () => {
    const p = shop();
    p.params.deckHeight = 2000;
    p.rules.frameSizes = ['tp-90x45', 'tp-140x45'];
    const used = (d: ReturnType<typeof computeDesign>) => [d.frame.joistProductId, d.frame.bearerProductId];
    for (const id of used(computeDesign(p))) expect(['tp-90x45', 'tp-140x45']).toContain(id);
    // a low deck: no stocked frame leaves 100 mm under the bearers, so the standard one is drawn and flagged
    const low = shop();
    low.params.deckHeight = 300;
    const dl = computeDesign(low);
    expect(dl.frame.noFit).toBe(true);
    expect(dl.frame.standard).toBe(true);
  });

  it('uses the sizes set by hand when the frame is fixed', () => {
    const p = shop();
    p.params = { ...p.params, frameSizing: 'fixed', joistProductId: 'tp-190x45', bearerProductId: 'tp-190x45', bearerLaminations: 2 };
    const d = computeDesign(p);
    expect(d.frame).toMatchObject({ auto: false, joistProductId: 'tp-190x45', bearerProductId: 'tp-190x45', bearerLaminations: 2 });
  });

  it('chooses the same frame whatever was edited by hand in the order list', () => {
    const p = shop();
    const plain = computeDesign(p).frame;
    const edited = computeDesign({ ...p, order: { lines: { 'tp-90x45': { qty: 3 } }, added: [] } }).frame;
    expect(edited.joistProductId).toBe(plain.joistProductId);
    expect(edited.saving).toBeCloseTo(plain.saving ?? 0, 6);
  });
});


describe('breakers for the least board waste', () => {
  const run = (len: number, rows: number, bandWidth: number, extraBreakerBoards = 2, joistSpacing?: number) =>
    bestBreakerSplit({ len, rows, bandWidth, strip: 150, stocks: [5400], allowance: 20, kerf: 5, minPiece: 600, count: 'auto', extraBreakerBoards, joistSpacing });
  it('knows the lengths that nest into a 5.4 m board: whole, halves, thirds, quarters, fifths', () => {
    expect(nestingLengths([5400], 5, 20, 600, 5380)).toEqual([5380, 2677, 1776, 1326, 1056]);
  });
  it('splits a run only symmetrically', () => {
    const nice = nestingLengths([5400], 5, 20, 600, 5380);
    for (const n of [1, 2, 3, 4]) {
      for (const s of symmetricSplits(11010, n, 150, nice, 600, 5380)) {
        expect(s.length).toBe(n + 1);
        expect(s.reduce((a, b) => a + b, 0) + n * 150).toBeCloseTo(11010, 6);
        for (let i = 0; i < s.length; i++) expect(s[i]).toBeCloseTo(s[s.length - 1 - i], 6);
      }
    }
  });
  it('lays the shop strip 2.7 | 5.4 | 2.7, not three 3.6 m pieces that each leave 1.8 m', () => {
    expect(run(11010, 15, 2205)).toEqual({ pieces: [2665, 5380, 2665], n: 2, bought: 167400, extra: false });
  });
  it('lays no breaker on a run that fits one board', () => {
    expect(run(5300, 15, 2205)).toBeNull();
  });
  it('adds a breaker beyond the fewest only when it saves the boards the owner asks for', () => {
    // a 5.71 m run: one breaker leaves 2.78 m pieces, a board each; three leave quarters, four to a board
    expect(run(5710, 24, 3455)!.pieces).toEqual([1315, 1315, 1315, 1315]);
    expect(run(5710, 24, 3455, 50)!.pieces).toEqual([2780, 2780]);
    const p = newProject('rect', true);
    p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3600 }, { x: 0, y: 3600 }];
    p.stairs = [];
    const xs = (q: Project) => computeDesign(q).layout!.breakers.map((b) => b.seg.a.x);
    expect(xs(p).length).toBe(3);
    // two breakers: thirds at the ends, 1.78 | 1.86 | 1.78
    p.rules.breakerMinSaving = 5;
    expect(xs(p)).toEqual([1996, 4004]);
    p.rules.breakerMinSaving = 50;
    expect(xs(p)).toEqual([3000]);
  });
  it('of the splits that buy the same boards, takes the one with fewer joists, then the one without short pieces', () => {
    // a 7.2 m deck (a 6.91 m run): 2.64 | 1.33 | 2.64 (halves and a quarter) buys what 0.62 | 5.38 | 0.62 does
    expect(run(6910, 28, 4055)!.pieces).toEqual([2642, 1326, 2642]);
    const p = newProject('r72', true);
    p.deck = [{ x: 0, y: 0 }, { x: 7200, y: 0 }, { x: 7200, y: 4200 }, { x: 0, y: 4200 }];
    p.stairs = [];
    const d = computeDesign(p);
    expect(d.layout!.breakers.map((b) => b.seg.a.x)).toEqual([2862, 4338]);
    const boards = (q: Project) => computeDesign(q).bom.lines.find((l) => l.productId === 'modelo-140x23')!.qty;
    const shortEnds: Project = { ...p, breakers: { axis: 'x', items: [{ id: 'B1', pos: 835, from: null, to: null }, { id: 'B2', pos: 6365, from: null, to: null }] } };
    expect(computeDesign(shortEnds).layout!.boards[2].runs.map((r) => Math.round(r.length))).toEqual([615, 5380, 615]);
    expect(boards(p)).toBe(boards(shortEnds));
    // a 9 m deck: 1.52 | 5.38 | 1.52 and 1.78 | 4.86 | 1.78 buy the same boards, but the longer pieces need a joist more
    expect(run(8710, 20, 2855, 2, 400)!.pieces).toEqual([1515, 5380, 1515]);
    expect(run(8710, 20, 2855)!.pieces).toEqual([1776, 4858, 1776]);
  });
});

describe('joins as the crew makes them', () => {
  const rect = (w: number, h: number, decking = 'modelo-140x23') => {
    const p = newProject('r', true);
    p.deck = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    p.houseEdges = [0];
    p.house = [[{ x: -500, y: 0 }, { x: w + 500, y: 0 }]];
    p.stairs = [];
    p.params.deckingProductId = decking;
    return p;
  };
  it('scarfs a bearer join over a stump: each piece runs on half the bearer depth past the stump centre', () => {
    const lay = computeDesign(rect(9000, 7000)).layout!;
    const b = lay.bearers.find((x) => !x.onWall && x.splices[0].length)!;
    expect(b.splices).toEqual([[4500]]);
    // 4500 to the stump's centre, 70 on (half the 140 depth), 20 end allowance
    expect(b.pieces).toEqual([[4590, 4590]]);
    expect(b.posts.some((pt) => Math.abs(pt.x - 4500) < 1)).toBe(true);
    // the wall bearer is bolted along the wall: butted
    const wall = lay.bearers.find((x) => x.onWall)!;
    expect(wall.splices).toEqual([[3020]]);
    expect(wall.pieces).toEqual([[3040, 6000]]);
    expect(lay.totals.bearerScarfs).toBe(5);
  });
  it('laps field joists side by side over a bearer, each end on to its far face; joists under the board joints stay in line', () => {
    const p = rect(5500, 7000);
    const d = computeDesign(p);
    const lay = d.layout!;
    const field = lay.joists.find((j) => j.kind === 'field')!;
    expect(field.splices).toEqual([1413]);
    // on to the far face of the 45 bearer (22.5 past its centre), and the end allowance
    expect(field.pieces).toEqual([1413 + 22.5 + 20, 7000 - 1413 + 22.5 + 20]);
    expect(field.lap).toBe(-45);
    // both pieces sit on the bearer
    expect(field.bearerCrossings).toBe(7);
    const edge = lay.joists.find((j) => j.kind === 'edge' && j.splices.length)!;
    expect(edge.lap).toBeUndefined();
    expect(edge.pieces.reduce((a, b) => a + b, 0)).toBeCloseTo(7000 + 2 * 20, 6);
    const laps = lay.joists.filter((j) => j.lap).reduce((n, j) => n + j.splices.length, 0);
    expect(lay.totals.joistLaps).toBe(laps);
    // three nails through each lap, on top of the skew nails at every crossing
    const nails = d.bom.lines.find((l) => l.productId === 'nail-75x3.05')!;
    expect(nails.qty).toBe(lay.totals.joistBearerCrossings * p.rules.skewNailsPerCrossing + laps * 3);
  });
  it('keeps the space a lap opens within the decking limit: a joist more where it would pass 400', () => {
    // a 5.5 m deck is 12 x 400 and a 365 space; a lap opens the last space by 45, so a lapped deck splits it
    expect(computeDesign(rect(5500, 5000)).layout!.joistBays.map((b) => bayLabel(b))).toEqual(['12 x @400 + 365']);
    const lapped = computeDesign(rect(5500, 7000)).layout!;
    expect(lapped.joistBays.map((b) => bayLabel(b))).toEqual(['12 x @400 + 2 x @183']);
    expect(lapped.joistSpacingUsed).toBeLessThanOrEqual(400);
    // timber decking evened out: spaced for the 45 so the opened space stays within its 450
    const hw = computeDesign(rect(9000, 7000, 'hw-86x19')).layout!;
    expect(hw.joistSpacingUsed).toBeGreaterThan(400);
    expect(hw.joistSpacingUsed).toBeLessThanOrEqual(450);
  });
});
