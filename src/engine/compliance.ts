import type { DeckParams, RuleSet } from '../model/types';
import type { BalustradeDesign } from './balustrade';
import type { LayoutResult } from './layout';
import type { StairDesign } from './stairs';
import type { WarningItem } from './warnings';

export type Pathway = 'exemptPossible' | 'approvalRequired';

export interface ComplianceInput {
  params: DeckParams;
  rules: RuleSet;
  areaM2: number;
  postClear: number;
  groundClearance: number;
  layout: LayoutResult | null;
  balustrade: BalustradeDesign;
  stairs: StairDesign[];
  houseEdges: number[];
  edgeCount: number;
  deckingMaxJoistSpacing: number;
  deckingFamily: string;
  /** largest joist centre spacing actually laid out */
  joistSpacingUsed: number;
}

export function assessCompliance(inp: ComplianceInput): { warnings: WarningItem[]; pathway: Pathway } {
  const { params, rules } = inp;
  const w: WarningItem[] = [];
  const area = Math.round(inp.areaM2 * 100) / 100;
  let exempt = true;
  if (inp.areaM2 > rules.exemptMaxArea) {
    exempt = false;
    w.push({ severity: 'warn', key: 'compliance.areaExempt', params: { area, max: rules.exemptMaxArea } });
  }
  if (params.deckHeight > rules.exemptMaxHeight) {
    exempt = false;
    w.push({ severity: 'warn', key: 'compliance.heightExempt', params: { height: params.deckHeight, max: rules.exemptMaxHeight } });
  }
  if (params.deckHeight >= rules.balustradeTriggerHeight) {
    w.push({ severity: 'info', key: 'compliance.balustradeRequired', params: { height: params.deckHeight } });
    const openEdges: number[] = [];
    for (let i = 0; i < inp.edgeCount; i++) {
      if (inp.houseEdges.includes(i)) continue;
      if (!inp.balustrade.edges.includes(i)) openEdges.push(i + 1);
    }
    if (openEdges.length) w.push({ severity: 'error', key: 'compliance.balustradeMissing', params: { edges: openEdges.join(', ') } });
    w.push({ severity: 'info', key: 'compliance.elevatedLoads' });
  }
  if (inp.postClear > rules.engineerHeight) w.push({ severity: 'error', key: 'compliance.engineer', params: { height: Math.round(inp.postClear), max: rules.engineerHeight } });
  else if (inp.postClear > rules.braceHeight) w.push({ severity: 'info', key: 'compliance.bracingRequired', params: { height: Math.round(inp.postClear) } });
  if (inp.groundClearance < rules.minGroundClearance) {
    w.push({ severity: 'error', key: 'compliance.tooLow', params: { clearance: Math.round(inp.groundClearance), min: rules.minGroundClearance } });
  } else if (inp.groundClearance < rules.lowDeckClearance) {
    w.push({ severity: 'warn', key: 'compliance.lowDeck', params: { clearance: Math.round(inp.groundClearance), min: rules.lowDeckClearance } });
  }
  if (Math.round(inp.joistSpacingUsed) > inp.deckingMaxJoistSpacing + 0.5) {
    w.push({ severity: 'warn', key: 'compliance.joistSpacingTooWide', params: { spacing: Math.round(inp.joistSpacingUsed), max: inp.deckingMaxJoistSpacing } });
  }
  if (inp.deckingFamily === 'composite') w.push({ severity: 'info', key: 'compliance.compositeNotes' });
  if (inp.deckingFamily === 'hardwood') w.push({ severity: 'info', key: 'compliance.hardwoodNotes' });
  w.push({ severity: 'info', key: 'compliance.bushfire' });
  w.push({ severity: 'info', key: 'compliance.verifySpans' });
  if (inp.layout) w.push(...inp.layout.warnings);
  for (const s of inp.stairs) w.push(...s.warnings);
  return { warnings: w, pathway: exempt ? 'exemptPossible' : 'approvalRequired' };
}
