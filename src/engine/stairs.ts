import type { DeckParams, Pt, RuleSet, Seg, Stair } from '../model/types';
import type { Edge } from './geometry';
import { edgePoint } from './geometry';
import type { WarningItem } from './warnings';

export interface StairDesign {
  id: string;
  edgeIndex: number;
  offset: number;
  width: number;
  rise: number;
  risers: number;
  riser: number;
  going: number;
  treads: number;
  totalRun: number;
  twoRG: number;
  stringerCount: number;
  stringerLength: number;
  stringerProductId: string;
  boardsPerTread: number;
  treadBoardLength: number;
  handrail: boolean;
  handrailPosts: number;
  handrailLength: number;
  outline: Pt[];
  treadLines: Seg[];
  padVolumeM3: number;
  warnings: WarningItem[];
}

export function designStair(
  stair: Stair,
  edge: Edge,
  params: DeckParams,
  rules: RuleSet,
  boardWidth: number,
  boardGap: number,
  maxTreadSpan: number,
): StairDesign {
  const r = rules.stair;
  const warnings: WarningItem[] = [];
  // the builder gives the height; everything else follows the NCC housing stair limits
  const rise = Math.max(0, stair.rise ?? params.deckHeight - stair.groundOffset);
  const minRisers = Math.max(1, Math.ceil(rise / r.maxRiser - 1e-9));
  const maxRisersFit = Math.max(minRisers, Math.floor(rise / r.minRiser + 1e-9));
  let risers = Math.max(1, Math.round(rise / r.targetRiser));
  risers = Math.min(Math.max(risers, minRisers), maxRisersFit);
  const riser = rise / risers;
  const pitch = boardWidth + boardGap;
  // going from a whole number of deck boards per tread (tread depth less the nosing overhang),
  // choosing the count that keeps 2R+G closest to the comfortable middle of the allowed band
  const comfort = (r.min2RG + r.max2RG) / 2 - 5;
  let going = 0;
  let boardsPerTread = 0;
  let best = Infinity;
  for (let k = 1; k <= 6; k++) {
    const depth = k * boardWidth + (k - 1) * boardGap;
    const g = depth - r.nosing;
    const sum = 2 * riser + g;
    if (g < r.minGoing || g > r.maxGoing || sum < r.min2RG || sum > r.max2RG) continue;
    const score = Math.abs(sum - comfort);
    if (score < best) {
      best = score;
      going = g;
      boardsPerTread = k;
    }
  }
  if (!boardsPerTread) {
    // no whole-board tread satisfies the band: fall back to the formula and rip the last board
    going = Math.max(r.minGoing, Math.min(r.maxGoing, Math.round((comfort - 2 * riser) / 5) * 5));
    boardsPerTread = Math.max(1, Math.ceil((going + r.nosing) / pitch));
  }
  const twoRG = 2 * riser + going;
  if (twoRG < r.min2RG || twoRG > r.max2RG) warnings.push({ severity: 'warn', key: 'stair.twoRG', params: { id: stair.id, value: Math.round(twoRG) } });
  if (riser < r.minRiser || riser > r.maxRiser) warnings.push({ severity: 'warn', key: 'stair.riserRange', params: { id: stair.id, value: Math.round(riser) } });
  if (risers > r.maxRisers) warnings.push({ severity: 'error', key: 'stair.tooManyRisers', params: { id: stair.id, value: risers } });
  if (stair.width < 600) warnings.push({ severity: 'warn', key: 'stair.narrow', params: { id: stair.id, value: stair.width } });

  const treads = Math.max(0, risers - 1);
  const totalRun = treads * going;
  const stringerLength = Math.ceil((Math.hypot(rise, risers * going) + 300) / 10) * 10;
  // treads are short boards spanning stringer to stringer; the stringer spacing rule
  // governs (default 500), capped by the decking's own joist spacing plus 50 mm tolerance
  const spacing = Math.min(r.stringerSpacing, maxTreadSpan + 50);
  const stringerCount = Math.max(2, Math.ceil(stair.width / spacing) + 1);
  const treadBoardLength = stair.width + 20;
  const handrail = rise > rules.handrailTriggerRise;
  const handrailPosts = handrail ? 4 : 0;
  const handrailLength = handrail ? 2 * stringerLength : 0;

  const drawRun = Math.max(totalRun, 300);
  const s = edgePoint(edge, stair.offset);
  const u = edge.dir;
  const n = edge.outward;
  const outline: Pt[] = [
    s,
    { x: s.x + u.x * stair.width, y: s.y + u.y * stair.width },
    { x: s.x + u.x * stair.width + n.x * drawRun, y: s.y + u.y * stair.width + n.y * drawRun },
    { x: s.x + n.x * drawRun, y: s.y + n.y * drawRun },
  ];
  const treadLines: Seg[] = [];
  for (let k = 1; k <= treads; k++) {
    const d = k * going;
    treadLines.push({
      a: { x: s.x + n.x * d, y: s.y + n.y * d },
      b: { x: s.x + u.x * stair.width + n.x * d, y: s.y + u.y * stair.width + n.y * d },
    });
  }
  const padVolumeM3 = (stair.width / 1000) * 0.5 * 0.1;
  return {
    id: stair.id,
    edgeIndex: stair.edgeIndex,
    offset: stair.offset,
    width: stair.width,
    rise,
    risers,
    riser,
    going,
    treads,
    totalRun,
    twoRG,
    stringerCount,
    stringerLength,
    stringerProductId: 'tp-290x45',
    boardsPerTread,
    treadBoardLength,
    handrail,
    handrailPosts,
    handrailLength,
    outline,
    treadLines,
    padVolumeM3,
    warnings,
  };
}
