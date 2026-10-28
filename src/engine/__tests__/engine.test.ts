import { describe, expect, it } from 'vitest';
import { defaultRules, newProject } from '../../model/defaults';
import { PRODUCT_MAP } from '../../model/catalog';
import type { Project } from '../../model/types';
import { bestBreakerSplit, nestingLengths, symmetricSplits } from '../breakerplan';
import { packPieces, packSimple, pieceWaste, splitRun, splitRunStocked } from '../cutlist';
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
    // 4055 of field is exactly 28 rows, laid from the far edge: row 13 (2175-2315) crosses the notch line at
    // 2255. Past the corner it is an 80 mm strip against the notch edge board: the strip next to the corner is
    // notched out of the board beside it (one 1.86 m board), the one past the breaker is ripped on its own
    expect(lay.rips).toEqual([{ row: 13, width: 80, boards: 1 }, { row: 13, width: 80, boards: 1, notched: true }]);
    const notchRow = lay.boards[12];
    expect(notchRow.runs.filter((r) => r.ripped).map((r) => [Math.round(r.seg.a.x), Math.round(r.seg.b.x), Math.round(r.width)])).toEqual([[3455, 3929, 80], [4079, 5855, 80]]);
    expect(notchRow.runs.filter((r) => !r.ripped).map((r) => [Math.round(r.seg.a.x), Math.round(r.seg.b.x), Math.round(r.width)])).toEqual([[145, 1921, 140], [2071, 3455, 140]]);
    expect(notchRow.runs.map((r) => [r.pieces.map(Math.round), !!r.notched])).toEqual([[[1796], false], [[1858 + 20], false], [[], true], [[1796], false]]);
    expect(d.footings.diameter).toBe(200);
    expect(d.footings.bags).toBeLessThan(30);
    expect(d.edgeBoardProductId).toBe('modelo-endboard-140x23');
    // composite: the 5710 run above the notch is split 1.78 | 1.86 | 1.78 by two symmetric breakers (thirds of a
    // 5.4 m board at the ends); the one over the leg carries on through the leg to the far edge board (its 1.78 and
    // 1.38 m pieces go three to a board, where a whole 3.31 m run takes a board of its own), the other stops at the
    // notch line
    expect(lay.breakers.map((b) => [b.seg.a.x, b.seg.a.y, b.seg.b.y, b.aligned])).toEqual([[1996, 0, 4055, false], [4004, 0, 2255, false]]);
    expect(lay.totals.boardJoins).toBe(0);
    for (const row of lay.boards) for (const run of row.runs) expect(run.pieces.length).toBe(run.notched ? 0 : 1);
    // laid from the far edge of the leg; the last row is against the house
    expect(lay.boards[0].runs.map((r) => Math.round(r.length))).toEqual([1776, 1384]);
    expect(lay.boards[lay.boards.length - 1].runs.map((r) => Math.round(r.length))).toEqual([1776, 1858, 1776]);
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
    // 3455 of field = 23 full rows + 120: the last row, against the house, is ripped and reported
    expect(lay.rips).toEqual([{ row: 24, width: 120, boards: 4, atHouse: true }]);
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
    expect(d.layout!.boards[d.layout!.boards.length - 1].runs.map((r) => Math.round(r.length))).toEqual([2665, 5380, 2665]);
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
    expect(lay.boards[lay.boards.length - 1].runs.map((r) => Math.round(r.length))).toEqual([1512, 2677, 1512]);
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
    // the wall bearer is bolted along the wall: butted, where its pieces cut simply: a whole 4.8 and one more from a
    // 4.8, so every bearer comes out of 4.8 m sticks
    const wall = lay.bearers.find((x) => x.onWall)!;
    expect(wall.splices).toEqual([[4780]]);
    expect(wall.pieces).toEqual([[4800, 4240]]);
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

describe('boards as the crew lays them', () => {
  const rect = (w: number, h: number) => {
    const p = newProject('r', true);
    p.deck = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    p.houseEdges = [0];
    p.house = [[{ x: -500, y: 0 }, { x: w + 500, y: 0 }]];
    p.stairs = [];
    return p;
  };
  it('lays the boards from the far edge so the ripped row goes against the house, or from the house by rule', () => {
    const p = rect(6000, 3600);
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.startsAtHouse).toBe(false);
    // 3455 of field: 23 full rows from the far edge board, the last one ripped to 120 against the wall at y 0
    const last = lay.boards[lay.boards.length - 1];
    expect(last.width).toBeCloseTo(120, 6);
    expect(last.pos).toBeCloseTo(60, 6);
    expect(lay.rips).toEqual([{ row: 24, width: 120, boards: 4, atHouse: true }]);
    expect(d.method.some((s) => s.notes.some((n) => n.key === 'm.decking.rip.house'))).toBe(true);
    // the owner's rule the other way: laid from the house, the rip at the far edge board
    p.rules.ripAtHouse = false;
    const edge = computeDesign(p).layout!;
    expect(edge.startsAtHouse).toBe(true);
    expect(edge.boards[0].pos).toBeCloseTo(70, 6);
    expect(edge.boards[edge.boards.length - 1].pos).toBeGreaterThan(3300);
    expect(edge.rips).toEqual([{ row: 24, width: 120, boards: 4 }]);
  });
  it('orders the spare boards the company adds: 3 decking, 1 of each edge board product', () => {
    const p = rect(6000, 3600);
    const line = (q: Project, id: string) => computeDesign(q).bom.lines.find((l) => l.productId === id)!;
    const deck = line(p, 'modelo-140x23');
    expect(deck.extraCount).toBe(3);
    expect(line(p, 'modelo-endboard-140x23').extraCount).toBe(1);
    // framing keeps its allowance in per cent
    const joists = line(p, 'tp-90x45');
    expect(joists.extraCount).toBe(Math.round(((joists.qty - joists.extraCount!) * p.params.wasteFramingPct) / 100));
    p.params.spareDeckingBoards = 0;
    p.params.spareEdgeBoards = 2;
    expect(line(p, 'modelo-140x23').qty).toBe(deck.qty - 3);
    expect(line(p, 'modelo-endboard-140x23').extraCount).toBe(2);
    // timber decking edged in its own boards: one product, both spares
    const hw = rect(6000, 3600);
    hw.params.deckingProductId = 'hw-86x19';
    expect(line(hw, 'hw-86x19').extraCount).toBe(4);
  });
});

describe('bracing on the plan, termites at the wall', () => {
  it('places every brace it orders: every other bay along each bearer, and one between bearer lines', () => {
    const p = newProject('high', true);
    p.params.deckHeight = 1500;
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(d.braces.count).toBeGreaterThan(0);
    expect(d.braces.lines.length).toBe(d.braces.count);
    // along a bearer: from one of its stumps to the next
    const on = (b: (typeof lay.bearers)[number], q: { x: number; y: number }) => b.posts.some((s) => Math.hypot(s.x - q.x, s.y - q.y) < 1);
    const along = d.braces.lines.filter((l) => lay.bearers.some((b) => on(b, l.a) && on(b, l.b)));
    expect(along.length).toBe(lay.bearers.reduce((n, b) => n + Math.ceil(Math.max(0, b.posts.length - 1) / 2), 0));
    // across: one between each pair of bearer lines
    const lines = new Set(lay.bearers.map((b) => b.lineIndex)).size;
    expect(d.braces.count).toBe(along.length + lines - 1);
    expect(d.bom.lines.find((l) => l.tags.includes('brace'))).toBeDefined();
    // a low deck needs none
    expect(computeDesign(newProject('low', true)).braces).toEqual({ count: 0, length: 0, lines: [] });
  });
  it('reminds of the termite management at the house wall (AS 3660.1)', () => {
    const p = newProject('t', true);
    const d = computeDesign(p);
    expect(d.warnings.some((w) => w.key === 'compliance.termite')).toBe(true);
    expect(d.method.some((s) => s.notes.some((n) => n.key === 'm.setout.termite'))).toBe(true);
    const free = { ...p, houseEdges: [], params: { ...p.params, attachment: 'freestanding' as const } };
    expect(computeDesign(free).warnings.some((w) => w.key === 'compliance.termite')).toBe(false);
  });
});

describe('simple cutting, for a crew without a cut list', () => {
  // a dollar or two of 90x45 a metre: a length more has to save about 7 m of it
  const extra = 7000;
  const lengthsOf = (r: ReturnType<typeof packSimple>) => r.stockCount.map((s) => `${s.count}x${s.length}`);
  const oneLengthPerStick = (r: ReturnType<typeof packSimple>) => r.bins.every((b) => Math.max(...b.cuts) - Math.min(...b.cuts) <= 5);
  it('cuts 1.8 m pieces as thirds of a 5.4, not one each from a 2.4', () => {
    const r = packSimple(new Array(6).fill(1790), [2400, 5400], 5, extra);
    expect(lengthsOf(r)).toEqual(['2x5400']);
    expect(r.groups).toEqual([{ stock: 5400, cuts: [1790, 1790, 1790], count: 2, offcut: 20 }]);
  });
  it('cuts 2.2 m pieces two to a 4.8, or one from a 2.4 when that is all it needs', () => {
    expect(lengthsOf(packSimple(new Array(4).fill(2200), [2400, 4800], 5, extra))).toEqual(['2x4800']);
    // three of them: one length either way, the least timber is three 2.4s
    expect(lengthsOf(packSimple(new Array(3).fill(2200), [2400, 4800], 5, extra))).toEqual(['3x2400']);
  });
  it('keeps the order to a length or two where a mixed cut list would scatter them', () => {
    const pieces = [...new Array(3).fill(5300), ...new Array(5).fill(4200), ...new Array(4).fill(2300), ...new Array(3).fill(1700)];
    const yard = [3600, 4800, 5400, 6000];
    const mixed = packPieces(pieces, yard, 5);
    const simple = packSimple(pieces, yard, 5, extra);
    expect(mixed.stockCount.length).toBeGreaterThan(2);
    expect(simple.stockCount.length).toBeLessThanOrEqual(2);
    expect(oneLengthPerStick(simple)).toBe(true);
    // every piece is on a stick
    expect(simple.bins.flatMap((b) => b.cuts).sort((a, b) => a - b)).toEqual([...pieces].sort((a, b) => a - b));
    // simple costs a little more timber, never less than the cheapest mix
    expect(simple.totalStockLength).toBeGreaterThanOrEqual(mixed.totalStockLength);
  });
  it('is the company default for framing; the cheapest mixed cut list is a rule away', () => {
    const p = newProject('s', true);
    const frame = (q: Project) => computeDesign(q).bom.cutlists.filter((c) => PRODUCT_MAP[c.productId]?.category === 'framing');
    expect(p.rules.cutting).toBe('simple');
    for (const c of frame(p)) for (const g of c.groups) expect(Math.max(...g.cuts) - Math.min(...g.cuts)).toBeLessThanOrEqual(5);
    const bearerLengths = (q: Project) => new Set(frame(q).find((c) => c.productId === 'tp-140x45')!.groups.map((g) => g.stock)).size;
    expect(bearerLengths(p)).toBe(1);
    p.rules.cutting = 'cheapest';
    expect(frame(p).some((c) => c.groups.some((g) => Math.max(...g.cuts) - Math.min(...g.cuts) > 5))).toBe(true);
    expect(bearerLengths(p)).toBeGreaterThan(1);
  });
});

describe('existing concrete under part of the deck', () => {
  /** the stepped job from the sketch: the 2900 and 11150 sides on brick walls, a slab in the corner (2.9 x 5.6 m)
   *  170 below the deck, the ground off it about 300 below, joists hung flush there */
  function sketch(): Project {
    const across = 8610;
    const p = newProject('sketch', false);
    p.deck = normalizePolygon([
      { x: 5710, y: 0 }, { x: across, y: 0 }, { x: across, y: 11150 }, { x: 0, y: 11150 },
      { x: 0, y: 7620 }, { x: 2980, y: 7620 }, { x: 2980, y: 6940 }, { x: 5710, y: 6940 },
    ]);
    p.house = [[{ x: 5210, y: 0 }, { x: across, y: 0 }, { x: across, y: 11650 }]];
    p.houseEdges = detectHouseEdges(p.deck, p.house);
    p.slabs = [{ id: 'S1', height: 170, poly: [{ x: 5710, y: 0 }, { x: across, y: 0 }, { x: across, y: 5600 }, { x: 5710, y: 5600 }] }];
    p.params.deckHeight = 300;
    p.params.joistConnection = 'flush';
    return p;
  }
  const inSlab = (q: { x: number; y: number }) => q.x > 5710 - 1 && q.x < 8610 + 1 && q.y > -1 && q.y < 5600 + 1;

  it('puts no stump or bearer on the slab: the joists there stand on pedestals', () => {
    const d = computeDesign(sketch());
    const lay = d.layout!;
    expect(d.ok).toBe(true);
    expect(lay.posts.length).toBeGreaterThan(0);
    expect(lay.posts.some((q) => inSlab(q.pt))).toBe(false);
    for (const b of lay.bearers.filter((x) => !x.onWall)) expect(inSlab(b.seg.a) && inSlab(b.seg.b)).toBe(false);
    // the deck stays bolted to the 2900 wall over the slab too: its wall bearer runs the whole wall
    expect(lay.ledgers.map((l) => Math.round(l.length))).toEqual([2900]);
    // a pedestal under every joist over the slab at every row, all of them on it
    expect(lay.pedestals.length).toBeGreaterThan(0);
    expect(lay.pedestals.every((q) => inSlab(q.pt))).toBe(true);
    const rows = new Set(lay.pedestals.map((q) => Math.round(q.pt.y))).size;
    const overSlab = lay.joists.filter((j) => j.seg.a.x > 5710 && j.seg.a.x < 8610);
    expect(lay.pedestals.length).toBeGreaterThanOrEqual(overSlab.length * rows);
    // the rows no further apart than a joist spans, the last one on the slab by its edge
    const ys = [...new Set(lay.pedestals.map((q) => Math.round(q.pt.y)))].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeLessThanOrEqual(lay.maxJoistSpan);
    expect(ys[ys.length - 1]).toBe(5600 - 75);
  });

  it('runs the joists on over the pedestals, hung only where they meet a bearer', () => {
    const d = computeDesign(sketch());
    const lay = d.layout!;
    const j = lay.joists.find((x) => x.seg.a.x > 6000 && x.seg.a.x < 8000)!;
    // from the wall bearer to the first bearer past the slab in pieces up to a stick, joined over a pedestal row
    const firstBearer = Math.min(...lay.bearers.filter((b) => !b.onWall && Math.abs(b.seg.a.x - b.seg.b.x) > 1).map((b) => b.seg.a.y));
    expect(firstBearer).toBeGreaterThan(5600);
    let run = j.seg.a.y + 45 / 2;
    let k = 0;
    while (run < firstBearer - 45 / 2 - 1) run += j.pieces[k++];
    expect(run).toBeCloseTo(firstBearer - 45 / 2, 0);
    // its joins there are over pedestal rows, on the slab
    expect(j.splices.slice(0, k - 1).every((y) => y < 5600)).toBe(true);
    expect(j.pieces.every((x) => x <= 6000)).toBe(true);
    // a hanger each side of every bearer it meets (one at the wall bearer and at the last), none on the slab
    const hung = lay.bearers.filter((b) => b.seg.a.x <= j.seg.a.x + 1 && b.seg.b.x >= j.seg.a.x - 1).length;
    expect(j.hangers).toBe(2 * hung - 2);
  });

  it('orders the pedestals that set to the slab, no stumps or concrete for it, weed mat off it only', () => {
    const p = sketch();
    const d = computeDesign(p);
    expect(d.slabs).toEqual([{ id: 'S1', height: 170, pedestalHeight: 170 - 23 - 90, productId: 'pedestal-45-75', count: d.layout!.pedestals.length, pads: 0 }]);
    const line = (id: string) => d.bom.lines.find((l) => l.productId === id);
    expect(line('pedestal-45-75')!.qty).toBe(d.layout!.pedestals.length);
    expect(line('screw-deck-10gx50')!.qty).toBe(d.layout!.pedestals.length * 2);
    const without = computeDesign({ ...p, slabs: [] });
    expect(d.layout!.posts.length).toBeLessThan(without.layout!.posts.length);
    expect(d.footings.bags).toBeLessThan(without.footings.bags);
    expect(line('weed-mat')!.qty).toBe(Math.ceil((d.areaM2 - 2.9 * 5.6) * 1.1));
    expect(d.method.some((m) => m.key === 'm.pedestals')).toBe(true);
    expect(d.warnings.some((w) => w.key === 'compliance.pedestals')).toBe(true);
  });

  it('stands the joists on pedestals over a slab when they sit on the bearers too', () => {
    const p = sketch();
    p.params.joistConnection = 'onTop';
    p.params.deckHeight = 450;
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.posts.some((q) => inSlab(q.pt))).toBe(false);
    expect(lay.pedestals.length).toBeGreaterThan(0);
    // the crossings nailed are the bearers' only
    const overSlab = lay.joists.filter((j) => j.seg.a.x > 5710 && j.seg.a.x < 8610);
    const bearerLines = (x: number) => lay.bearers.filter((b) => b.seg.a.x <= x + 1 && b.seg.b.x >= x - 1).length;
    for (const j of overSlab) expect(j.bearerCrossings).toBeLessThanOrEqual(bearerLines(j.seg.a.x) + j.splices.length);
  });

  it('a deck all on a slab: pedestals only, no stumps, bearers or concrete', () => {
    const p = newProject('patio', false);
    p.deck = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    p.houseEdges = [];
    p.house = [];
    p.slabs = [{ id: 'S1', height: 160, poly: [{ x: -100, y: -100 }, { x: 4100, y: -100 }, { x: 4100, y: 3100 }, { x: -100, y: 3100 }] }];
    const d = computeDesign(p);
    expect(d.layout!.bearers).toEqual([]);
    expect(d.layout!.posts).toEqual([]);
    expect(d.footings.bags).toBe(0);
    expect(d.layout!.pedestals.length).toBeGreaterThan(0);
    expect(d.method.some((m) => m.key.startsWith('m.footings') || m.key.startsWith('m.posts') || m.key.startsWith('m.bearers'))).toBe(false);
  });

  /** a free-standing 4 x 3 m deck, joists along y, over a slab (x0..x1 by y0..y1) */
  function patio(slabs: [number, number, number, number][]): Project {
    const p = newProject('patio', false);
    p.deck = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    p.houseEdges = [];
    p.house = [];
    p.params.boardAxis = 'x';
    p.params.deckHeight = 300;
    p.slabs = slabs.map(([x0, y0, x1, y1], k) => ({ id: `S${k + 1}`, height: 170, poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] }));
    return p;
  }
  /** how far a point is from a slab rectangle (0 on it) */
  const away = (q: { x: number; y: number }, [x0, y0, x1, y1]: [number, number, number, number]) => Math.hypot(Math.max(x0 - q.x, 0, q.x - x1), Math.max(y0 - q.y, 0, q.y - y1));
  /** every joist held at each support line it crosses: by a bearer, or a pedestal under it there */
  function heldAtEveryLine(d: ReturnType<typeof computeDesign>) {
    const lay = d.layout!;
    for (const j of lay.joists) {
      const x = j.seg.a.x;
      for (const s of lay.supports) {
        if (s.pos < Math.min(j.seg.a.y, j.seg.b.y) - 1 || s.pos > Math.max(j.seg.a.y, j.seg.b.y) + 1) continue;
        const bearer = lay.bearers.some((b) => Math.abs(b.seg.a.y - s.pos) < 1 && x >= Math.min(b.seg.a.x, b.seg.b.x) - 1 && x <= Math.max(b.seg.a.x, b.seg.b.x) + 1);
        const pedestal = lay.pedestals.some((q) => Math.abs(q.pt.y - s.pos) < 1 && Math.abs(q.pt.x - x) <= 45);
        expect(bearer || pedestal).toBe(true);
      }
    }
  }

  it('the deck a little past a slab: the joists there stand on pedestals on pads beside it, no stump', () => {
    // the slab stops 100 short of the deck's right edge: too little ground there for a stump clear of it
    const p = patio([[-100, -100, 3900, 3100]]);
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.posts).toEqual([]);
    const pads = lay.pedestals.filter((q) => q.pad);
    expect(pads.length).toBeGreaterThan(0);
    for (const q of pads) expect(q.pt.x).toBeGreaterThan(3900);
    expect(lay.pedestals.filter((q) => !q.pad).every((q) => q.pt.x <= 3900)).toBe(true);
    heldAtEveryLine(d);
    expect(d.slabs[0].pads).toBe(pads.length);
    expect(d.warnings.some((w) => w.key === 'layout.slabPads')).toBe(true);
    // the pads' concrete ordered: 300 square and 200 deep each
    expect(d.footings.bags).toBe(Math.ceil((pads.length * 0.3 * 0.3 * 0.2) / p.rules.concreteBagYield));
    expect(d.method.find((m) => m.key === 'm.pedestals')!.notes.some((n) => n.key === 'm.pedestals.n3')).toBe(true);
  });

  it('ground beside a slab wide enough for a stump: the stump keeps clear of the slab, the bearer on to its edge', () => {
    const slab: [number, number, number, number] = [-100, -100, 3700, 3100];
    const d = computeDesign(patio([slab]));
    const lay = d.layout!;
    expect(lay.pedestals.some((q) => q.pad)).toBe(false);
    expect(lay.posts.length).toBeGreaterThan(0);
    for (const q of lay.posts) expect(away(q.pt, slab)).toBeGreaterThanOrEqual(149);
    for (const b of lay.bearers) expect(Math.min(b.seg.a.x, b.seg.b.x)).toBeCloseTo(3700, 0);
    heldAtEveryLine(d);
  });

  it('two slabs close together: no stump comes near either, the joists between them held', () => {
    // the row on the second slab runs on past it, 125 beside the first: no stump there, pads beside the first slab
    const slabs: [number, number, number, number][] = [[-100, -100, 2600, 1400], [1500, 1450, 4100, 3100]];
    const p = patio(slabs);
    for (const axis of ['x', 'y'] as const) {
      p.params.boardAxis = axis;
      const d = computeDesign(p);
      for (const q of d.layout!.posts) for (const s of slabs) expect(away(q.pt, s)).toBeGreaterThanOrEqual(149);
      expect(d.warnings.some((w) => w.key === 'layout.stumpAtSlab')).toBe(false);
      for (const q of d.layout!.pedestals.filter((x) => x.pad)) expect(Math.min(...slabs.map((s) => away(q.pt, s)))).toBeLessThan(150);
      if (axis === 'x') {
        expect(d.layout!.pedestals.some((q) => q.pad)).toBe(true);
        heldAtEveryLine(d);
      }
    }
  });

  it('a slab edge just past a step in the deck: the row there stays under the joists that end at the step', () => {
    // an L, the boards along y: the step's joists end at x 3600; the slab runs on to 3709, its edge row would be at 3634
    const p = newProject('step', false);
    p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 2400 }, { x: 3600, y: 2400 }, { x: 3600, y: 4200 }, { x: 0, y: 4200 }];
    p.params.deckHeight = 450;
    p.params.boardAxis = 'y';
    p.slabs = [{ id: 'S1', height: 300, poly: [{ x: -77, y: 365 }, { x: 3709, y: 365 }, { x: 3709, y: 4018 }, { x: -77, y: 4018 }] }];
    const lay = computeDesign(p).layout!;
    const lastRow = Math.max(...lay.supports.map((s) => s.pos).filter((x) => x < 3600));
    expect(3600 - lastRow).toBeLessThanOrEqual(100);
    expect(lay.supports.some((s) => s.pos > 3600 && s.pos < 3600 + 300)).toBe(false);
  });

  it('says so when the slab is too close below the deck for a pedestal', () => {
    const p = sketch();
    p.slabs![0].height = 120;
    const d = computeDesign(p);
    expect(d.slabs[0].productId).toBeNull();
    expect(d.warnings[0]).toMatchObject({ severity: 'error', key: 'compliance.slabTooLow' });
  });
});


describe('detail mode: parts changed by hand, the rest laid out round them', () => {
  /** a 6 x 4 m deck against the house along the top, 600 high */
  function deck(): Project {
    const p = newProject('detail', false);
    p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }];
    p.house = [[{ x: -500, y: 0 }, { x: 6500, y: 0 }]];
    p.houseEdges = detectHouseEdges(p.deck, p.house);
    p.params.deckHeight = 600;
    return p;
  }
  const bearerOf = (d: ReturnType<typeof computeDesign>, y: number) => d.layout!.bearers.find((b) => !b.onWall && Math.abs(b.seg.a.y - y) < 1)!;

  it('an edge board taken off one side: the boards run out to that edge, the corners there butt', () => {
    const base = computeDesign(deck());
    const p = deck();
    p.details = { noEdgeBoard: [1] };
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.edgeBoards.map((e) => e.edgeIndex)).toEqual([2, 3]);
    expect(lay.edgeBoards.find((e) => e.edgeIndex === 2)!.startCorner).toBe('butt');
    // the boards reach the right edge now (the edge board's width further than before)
    const reach = (x: ReturnType<typeof computeDesign>) => Math.max(...x.layout!.boards.flatMap((r) => r.runs.flatMap((run) => [run.seg.a.x, run.seg.b.x])));
    expect(reach(d)).toBeGreaterThan(reach(base) + 100);
    expect(reach(d)).toBeLessThanOrEqual(6000 + 1);
    // no double joist under an edge board that is not there, one edge board less on the order
    expect(lay.totals.frameJoists).toBeLessThan(base.layout!.totals.frameJoists);
    const pieces = (x: ReturnType<typeof computeDesign>) => x.layout!.edgeBoards.reduce((n, e) => n + e.pieces.length, 0);
    expect(pieces(d)).toBeLessThan(pieces(base));
    expect(d.bom.total).toBeLessThan(base.bom.total);
  });

  it('a stump taken out: none near its spot, the others on that bearer evened out, within their span', () => {
    const base = computeDesign(deck());
    const b0 = bearerOf(base, base.layout!.bearers.find((b) => !b.onWall)!.seg.a.y);
    const spot = b0.posts[1];
    const p = deck();
    p.details = { stumpsOff: [spot] };
    const d = computeDesign(p);
    const b = bearerOf(d, spot.y);
    expect(b.seg.a.x).toBe(b0.seg.a.x);
    expect(b.seg.b.x).toBe(b0.seg.b.x);
    for (const q of b.posts) expect(Math.abs(q.x - spot.x)).toBeGreaterThanOrEqual(300 - 1);
    const xs = b.posts.map((q) => q.x).sort((u, v) => u - v);
    const spans = xs.slice(1).map((x, k) => x - xs[k]);
    for (const s of spans) {
      expect(s).toBeLessThanOrEqual(b.maxSpan + 0.5);
      expect(s).toBeGreaterThan(b.maxSpan / 2);
    }
    // the other bearers keep theirs
    const other = base.layout!.bearers.filter((x) => !x.onWall && Math.abs(x.seg.a.y - spot.y) > 1);
    for (const o of other) expect(bearerOf(d, o.seg.a.y).posts).toEqual(o.posts);
    expect(d.warnings.some((w) => w.key.startsWith('layout.hand'))).toBe(false);
  });

  it('a stump put in by hand stands where it was put, the others set out round it', () => {
    const base = computeDesign(deck());
    const y = base.layout!.bearers.find((b) => !b.onWall)!.seg.a.y;
    const p = deck();
    p.details = { stumpsAdded: [{ x: 2500, y: y + 40 }] };
    const d = computeDesign(p);
    const b = bearerOf(d, y);
    expect(b.posts.some((q) => q.x === 2500 && q.y === y)).toBe(true);
    const xs = b.posts.map((q) => q.x).sort((u, v) => u - v);
    for (let k = 1; k < xs.length; k++) {
      expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(250);
      expect(xs[k] - xs[k - 1]).toBeLessThanOrEqual(b.maxSpan + 0.5);
    }
  });

  it('says so when a stump changed by hand leaves a bearer end hanging, or a stump put in is off every bearer', () => {
    const base = computeDesign(deck());
    const b0 = base.layout!.bearers.find((b) => !b.onWall)!;
    const p = deck();
    p.details = { stumpsOff: [b0.posts[b0.posts.length - 1]], stumpsAdded: [{ x: 3000, y: (b0.seg.a.y + base.layout!.bearers.filter((b) => !b.onWall)[1].seg.a.y) / 2 }] };
    const d = computeDesign(p);
    expect(d.warnings.find((w) => w.key === 'layout.handOverhang')).toMatchObject({ params: { id: bearerOf(d, b0.seg.a.y).id } });
    expect(d.warnings.find((w) => w.key === 'layout.pinOffBearer')).toMatchObject({ params: { n: 1 } });
  });

  const gaps = (d: ReturnType<typeof computeDesign>) => {
    const ys = d.layout!.supports.map((s) => s.pos);
    return ys.slice(1).map((y, k) => y - ys[k]);
  };

  it('a bearer line taken out: none near its spot, the lines between set out again within the joist span', () => {
    const base = computeDesign(deck());
    const inter = base.layout!.supports.find((s) => s.kind === 'inter')!;
    const p = deck();
    p.details = { bearersOff: [{ x: 3000, y: Math.round(inter.pos) }] };
    const d = computeDesign(p);
    const lay = d.layout!;
    for (const s of lay.supports) expect(Math.abs(s.pos - Math.round(inter.pos))).toBeGreaterThanOrEqual(300 - 0.5);
    for (const g of gaps(d)) expect(g).toBeLessThanOrEqual(lay.maxJoistSpan + 0.5);
    expect(lay.supports.length).toBe(base.layout!.supports.length);
    expect(d.frame).toEqual(base.frame);
    for (const b of lay.bearers.filter((x) => !x.onWall)) expect(b.posts.length).toBeGreaterThanOrEqual(2);
    expect(d.warnings.some((w) => w.key.startsWith('layout.hand') || w.key === 'layout.lineLost')).toBe(false);
  });

  it('a bearer line put in by hand runs where it was put, on its stumps; one moved leaves its spot clear', () => {
    const p = deck();
    p.details = { bearersAdded: [{ x: 3000, y: 1000 }] };
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.supports.find((s) => s.pos === 1000)?.hand).toBe(true);
    expect(bearerOf(d, 1000).posts.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps(d)) expect(g).toBeLessThanOrEqual(lay.maxJoistSpan + 0.5);
    const inter = Math.round(computeDesign(deck()).layout!.supports.find((s) => s.kind === 'inter')!.pos);
    const q = deck();
    q.details = { bearersMoved: [{ from: { x: 3000, y: inter }, to: { x: 3000, y: inter - 200 } }] };
    const m = computeDesign(q).layout!;
    expect(m.supports.some((s) => s.pos === inter - 200)).toBe(true);
    expect(m.supports.filter((s) => Math.abs(s.pos - inter) < 300 && s.pos !== inter - 200)).toEqual([]);
  });

  it('the edge bearer taken out moves in to clear ground; moved in further, the joists run past it, said so', () => {
    const edge = Math.round(computeDesign(deck()).layout!.supports.find((s) => s.kind === 'edge')!.pos);
    const p = deck();
    p.details = { bearersOff: [{ x: 3000, y: edge }] };
    const d = computeDesign(p);
    expect(Math.max(...d.layout!.supports.map((s) => s.pos))).toBe(edge - 300);
    // 325 mm past it, within a quarter of the joists' 1500 span
    expect(d.warnings.some((w) => w.key === 'layout.handCantilever')).toBe(false);
    const q = deck();
    q.details = { bearersMoved: [{ from: { x: 3000, y: edge }, to: { x: 3000, y: 3400 } }] };
    expect(computeDesign(q).warnings.find((w) => w.key === 'layout.handCantilever')).toMatchObject({ params: { mm: 600, max: 375 } });
  });

  it('a joist taken out: the field joists keep clear of its spot, the bay set out again within the spacing', () => {
    const base = computeDesign(deck());
    const field = base.layout!.joists.find((j) => j.kind === 'field')!;
    const p = deck();
    p.details = { joistsOff: [{ x: field.pos, y: 2000 }] };
    const d = computeDesign(p);
    const lay = d.layout!;
    for (const j of lay.joists) expect(Math.abs(j.pos - field.pos)).toBeGreaterThanOrEqual(100 - 0.5);
    for (const b of lay.joistBays) for (const s of b.spaces) expect(s).toBeLessThanOrEqual(d.joistSetoutSpacing + 0.5);
    // the bays it is not in keep their set-out
    const bay = base.layout!.joistBays.find((b) => field.pos > b.from && field.pos < b.to)!;
    const others = (x: ReturnType<typeof computeDesign>) => x.layout!.joistBays.filter((b) => b.from !== bay.from).map((b) => b.spaces);
    expect(others(d)).toEqual(others(base));
    expect(d.warnings.some((w) => w.key.startsWith('layout.hand') || w.key.startsWith('compliance.joistSpacing'))).toBe(false);
  });

  it('a joist under the edge board joint taken out goes, said so; a joist put in stands where it was put', () => {
    const base = computeDesign(deck());
    const frame = base.layout!.joists.find((j) => j.kind === 'frame' && j.pos > 5000)!;
    const p = deck();
    p.details = { joistsOff: [{ x: frame.pos, y: 2000 }], joistsAdded: [{ x: 2000, y: 1200 }] };
    const d = computeDesign(p);
    expect(d.layout!.joists.some((j) => Math.abs(j.pos - frame.pos) < 1)).toBe(false);
    expect(d.warnings.find((w) => w.key === 'layout.handFixedJoist')).toMatchObject({ params: { n: 1 } });
    expect(d.layout!.joists.some((j) => j.pos === 2000)).toBe(true);
    // put in on top of another joist: hard beside it instead
    const q = deck();
    q.details = { joistsAdded: [{ x: Math.round(frame.pos) + 10, y: 2000 }] };
    const xs = computeDesign(q).layout!.joists.map((j) => j.pos).sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(45 - 0.5);
  });

  it('a joist doubled gets a second one hard beside it, the pair butted at its joins and nailed; the method says so', () => {
    const long = (): Project => {
      const p = deck();
      p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 7500 }, { x: 0, y: 7500 }];
      return p;
    };
    const base = computeDesign(long());
    const field = base.layout!.joists.filter((j) => j.kind === 'field')[2];
    expect(field.lap).toBe(-45);
    const p = long();
    p.details = { joistsDoubled: [{ x: field.pos, y: 2000 }] };
    const d = computeDesign(p);
    const pair = d.layout!.joists.filter((j) => Math.abs(j.pos - field.pos) < 46);
    expect(pair.length).toBe(2);
    expect(pair.every((j) => j.kind === 'double' && !j.lap)).toBe(true);
    expect(pair.filter((j) => j.twin).length).toBe(1);
    expect(Math.abs(pair[0].pos - pair[1].pos)).toBeCloseTo(45, 5);
    expect(d.method.some((s) => s.notes?.some((n) => n.key === 'm.joists.double' && n.params?.n === 1))).toBe(true);
    const nails = (x: ReturnType<typeof computeDesign>) => x.bom.lines.find((l) => l.productId === 'nail-75x3.05')?.qty ?? 0;
    expect(nails(d)).toBeGreaterThanOrEqual(nails(base));
    expect(d.bom.total).toBeGreaterThan(base.bom.total);
  });

  it('bearer lines and joists changed by hand where the boards run the other way', () => {
    const p = deck();
    p.params.boardAxis = 'y';
    p.details = { joistsAdded: [{ x: 1500, y: 2000 }], bearersAdded: [{ x: 2200, y: 1500 }] };
    const lay = computeDesign(p).layout!;
    expect(lay.joists.some((j) => j.seg.a.y === 2000 && j.seg.b.y === 2000)).toBe(true);
    expect(lay.bearers.some((b) => b.seg.a.x === 2200 && b.seg.b.x === 2200)).toBe(true);
  });

  it('keeps the hand changes through outline edits and mirroring, and drops what cannot be read', async () => {
    const { remapEdgeData, mirrorProject } = await import('../../utils/shapes');
    const { migrateProject } = await import('../../state');
    const p = deck();
    p.details = { noEdgeBoard: [2], stumpsOff: [{ x: 1525, y: 1340 }], stumpsAdded: [{ x: 4000, y: 1340 }] };
    // a notch in the bottom edge splits it: both parts stay without an edge board
    const notched = normalizePolygon([{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 3500, y: 4000 }, { x: 3500, y: 3500 }, { x: 2500, y: 3500 }, { x: 2500, y: 4000 }, { x: 0, y: 4000 }]);
    const carried = remapEdgeData(p, notched).details!;
    const bottom = edges(notched).filter((e) => e.axis === 'x' && Math.abs(e.a.y - 4000) < 1).map((e) => e.index);
    expect(carried.noEdgeBoard).toEqual(bottom.sort((a, b) => a - b));
    const m = mirrorProject(p);
    expect(m.details!.stumpsAdded).toEqual([{ x: 2000, y: 1340 }]);
    const bad = migrateProject({ ...p, details: { noEdgeBoard: [1, -1, 1.5, 1] as number[], stumpsOff: [{ x: 1, y: NaN }] as never, stumpsAdded: 'x' as never } });
    expect(bad.details).toEqual({ noEdgeBoard: [1] });
    const kept = migrateProject({ ...p, details: { bearersMoved: [{ from: { x: 1, y: 2 }, to: { x: 1, y: 3 } }, { from: null }] as never, joistsDoubled: [{ x: 5, y: 6 }, 7] as never } });
    expect(kept.details).toEqual({ bearersMoved: [{ from: { x: 1, y: 2 }, to: { x: 1, y: 3 } }], joistsDoubled: [{ x: 5, y: 6 }] });
    expect(mirrorProject({ ...p, details: { joistsAdded: [{ x: 1000, y: 50 }], bearersOff: [{ x: 500, y: 2000 }] } }).details).toMatchObject({ joistsAdded: [{ x: 5000, y: 50 }], bearersOff: [{ x: 5500, y: 2000 }] });
    expect(migrateProject({ ...p, details: { stumpsOff: [] } }).details).toBeNull();
  });
});
