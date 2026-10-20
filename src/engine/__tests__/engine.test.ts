import { describe, expect, it } from 'vitest';
import { defaultRules, newProject } from '../../model/defaults';
import { packPieces, splitRun } from '../cutlist';
import { joistMaxSpan, joistSpaces } from '../layout';
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
    // auto joist spacing: even per bay, between 400 and the 500 cap
    expect(lay.joistSpacingUsed).toBeLessThanOrEqual(500);
    expect(lay.joistSpacingMin).toBeGreaterThanOrEqual(400);
    expect(d.joistSpacingText).toMatch(/^\d+(-\d+)?$/);
    // picture frame: one edge board per exposed edge, four mitred corners, field inset by board + gap
    expect(lay.edgeBoards.length).toBe(5);
    expect(lay.totals.mitres).toBe(4);
    expect(lay.edgeBoards.find((e) => e.edgeIndex === 1)!.startCorner).toBe('butt');
    expect(lay.edgeBoards.find((e) => e.edgeIndex === 2)!.endCorner).toBe('concave');
    expect(lay.edgeBoards.find((e) => e.edgeIndex === 2)!.length).toBeCloseTo(2400 + 140, 3);
    expect(lay.fieldPoly).toEqual([{ x: 145, y: 0 }, { x: 5855, y: 0 }, { x: 5855, y: 2255 }, { x: 3455, y: 2255 }, { x: 3455, y: 4055 }, { x: 145, y: 4055 }]);
    // a touching pair under each of the three exposed joist-parallel edges; the breaker's left joint is
    // already carried by the notch pair, its right joint gets one joist touching the notch edge joist
    expect(lay.totals.frameJoists).toBe(7);
    expect(lay.joists.filter((j) => j.kind === 'frame').map((j) => Math.round(j.pos * 10) / 10)).toEqual([122.5, 167.5, 3432.5, 3477.5, 3622.5, 5832.5, 5877.5]);
    // 4055 of field is exactly 28 rows, but row 16 (2175-2315) crosses the notch line at 2255:
    // right of the notch that row is an 80 mm strip against the notch edge board
    expect(lay.rips).toEqual([{ row: 16, width: 80, boards: 1 }]);
    const row16 = lay.boards[15];
    expect(row16.runs.filter((r) => r.ripped).map((r) => [Math.round(r.seg.a.x), Math.round(r.seg.b.x), Math.round(r.width)])).toEqual([[3605, 5855, 80]]);
    expect(row16.runs.filter((r) => !r.ripped).map((r) => Math.round(r.width))).toEqual([140]);
    expect(d.footings.diameter).toBe(200);
    expect(d.footings.bags).toBeLessThan(30);
    expect(d.edgeBoardProductId).toBe('modelo-endboard-140x23');
    // composite: the 5710 run above the notch is divided by one breaker continuing the notch edge board line
    expect(lay.breakers.length).toBe(1);
    expect(lay.breakers[0].aligned).toBe(true);
    expect(lay.breakers[0].seg.a.x).toBeCloseTo(3530, 3); // strip 3460..3600 beside the field edge at 3455
    expect(lay.breakers[0].seg.a.y).toBeCloseTo(0, 3);
    expect(lay.breakers[0].seg.b.y).toBeCloseTo(2255, 3);
    expect(lay.totals.boardJoins).toBe(0);
    for (const row of lay.boards) for (const run of row.runs) expect(run.pieces.length).toBe(1);
    expect(lay.boards[0].runs.map((r) => Math.round(r.length))).toEqual([3310, 2250]);
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
    const fixed = { ...auto, joistSpacingMode: 'fixed' as const, joistSpacing: 450 };
    expect(joistSpaces(3310, fixed, rules, 500)).toBe(8); // 413.75 <= 450
    expect(joistMaxSpan(rules, 'tp-90x45', 400).span).toBe(1500);
    expect(joistMaxSpan(rules, 'tp-90x45', 425).span).toBe(1450);
    expect(joistMaxSpan(rules, 'tp-90x45', 500).span).toBe(1330);
    expect(joistMaxSpan(rules, 'tp-90x45', 350).span).toBe(1500);
    expect(joistMaxSpan(rules, 'tp-90x45', 900).extrapolated).toBe(true);
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
  it('centres breaker boards on plain runs and skips them for timber', () => {
    const p = newProject('rect', true);
    p.deck = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3600 }, { x: 0, y: 3600 }];
    p.stairs = [];
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.breakers.length).toBe(1);
    expect(lay.breakers[0].aligned).toBe(false);
    expect(lay.breakers[0].seg.a.x).toBeCloseTo(3000, 3);
    expect(lay.breakers[0].length).toBeCloseTo(3455, 3); // wall to the inner side of the far edge board
    expect(lay.boards[0].runs.map((r) => Math.round(r.length))).toEqual([2780, 2780]);
    expect(lay.totals.boardJoins).toBe(0);
    // one joist under each breaker joint, centred on the gap so it carries both the breaker and the board ends
    const frames = lay.joists.filter((j) => j.kind === 'frame').map((j) => Math.round(j.pos * 10) / 10);
    expect(frames).toEqual([122.5, 167.5, 2927.5, 3072.5, 5832.5, 5877.5]);
    // 3455 of field = 23 full rows + 120: the last row is ripped and reported
    expect(lay.rips).toEqual([{ row: 24, width: 120, boards: 2 }]);
    expect(d.warnings.some((w) => w.key === 'layout.rip')).toBe(true);
    // 2780 bays cannot nest two to a 5.4 m board; the tool says that three breakers would
    const saving = d.warnings.find((w) => w.key === 'layout.breakerSaving');
    expect(saving && saving.params && saving.params.n).toBe(3);
    p.params.breakerCount = 3;
    const d3 = computeDesign(p);
    expect(d3.layout!.breakers.length).toBe(3);
    expect(d3.layout!.breakers.map((b) => Math.round(b.seg.a.x))).toEqual([1535, 3000, 4465]);
    const boards = (dd: typeof d) => dd.bom.lines.find((l) => l.productId === 'modelo-140x23')!.qty;
    expect(boards(d3)).toBeLessThan(boards(d) - 10);
    const hw = newProject('hw', true);
    hw.params.deckingProductId = 'hw-86x19';
    hw.params.boardGap = 4;
    const dh = computeDesign(hw);
    expect(dh.layout!.breakers.length).toBe(0);
    expect(dh.layout!.totals.boardJoins).toBeGreaterThan(0);
    hw.params.breakerBoards = 'on';
    expect(computeDesign(hw).layout!.breakers.length).toBeGreaterThan(0);
  });
  it('lays boards to the edge when the picture frame is off', () => {
    const p = newProject('plain', true);
    p.params.edgeBoard = false;
    const d = computeDesign(p);
    const lay = d.layout!;
    expect(lay.edgeBoards.length).toBe(0);
    expect(lay.fieldPoly).toEqual(d.poly);
    // composite still gets a breaker, here in line with the notch edge (3600 + gap + half a board)
    expect(lay.breakers.length).toBe(1);
    expect(lay.breakers[0].seg.a.x).toBeCloseTo(3675, 3);
    expect(lay.boards[0].runs.map((r) => Math.round(r.length))).toEqual([3600, 2250]);
    expect(lay.totals.frameJoists).toBe(2); // the breaker's own joists; its left one merges with the notch edge joist
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
    const wall = newProject('wall', true);
    wall.params.attachment = 'wall';
    const free = newProject('free', true);
    free.params.attachment = 'freestanding';
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
});
