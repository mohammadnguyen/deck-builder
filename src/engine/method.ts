import type { DeckParams, RuleSet } from '../model/types';
import type { BalustradeDesign } from './balustrade';
import type { LayoutResult } from './layout';
import type { StairDesign } from './stairs';

export interface MethodStep {
  key: string;
  params: Record<string, string | number>;
  notes: { key: string; params?: Record<string, string | number> }[];
}

export interface MethodInput {
  params: DeckParams;
  rules: RuleSet;
  layout: LayoutResult;
  /** the deck runs against the house (keep its termite management clear) */
  againstHouse?: boolean;
  areaM2: number;
  postCount: number;
  postTop: number;
  postLength: number;
  postName: string;
  concreteM3: number;
  bags: number;
  bearerName: string;
  joistName: string;
  deckingName: string;
  boardThickness: number;
  joistDepth: number;
  bearerDepth: number;
  balustrade: BalustradeDesign;
  stairs: StairDesign[];
  braceCount: number;
  pathway: string;
  /** hidden clip count when the decking uses clips */
  clips?: number;
  composite: boolean;
  /** joist spacing as laid out, e.g. "439" or "400-461" */
  joistSpacingText: string;
  edgeBoardName: string;
  /** true when the boards start from a house wall */
  houseSide: boolean;
  /** largest joist spacing allowed */
  joistSpacingCap: number;
  /** joists set out at exact centres, short space last */
  joistSetout: boolean;
  joistSetoutSpacing: number;
}

export function buildMethod(m: MethodInput): MethodStep[] {
  const p = m.params;
  const steps: MethodStep[] = [];
  const frameDrop = m.boardThickness + m.joistDepth;
  steps.push({
    key: 'm.approvals',
    params: { area: m.areaM2.toFixed(1), height: p.deckHeight, pathway: m.pathway },
    notes: [{ key: 'm.approvals.n1' }, { key: 'm.approvals.n2' }, { key: 'm.approvals.n3' }],
  });
  steps.push({
    key: 'm.setout',
    params: { posts: m.postCount },
    notes: [{ key: 'm.setout.n1' }, { key: 'm.setout.n2' }, ...(p.weedMat ? [{ key: 'm.setout.weedMat' }] : []), ...(m.againstHouse ? [{ key: 'm.setout.termite' }] : [])],
  });
  if (p.footingType === 'slab') {
    steps.push({
      key: 'm.footings.slab',
      params: { count: m.postCount, post: m.postName, postLength: m.postLength },
      notes: [{ key: 'm.footings.slab.n1' }, { key: 'm.footings.slab.n2' }],
    });
  } else if (p.footingType === 'stump') {
    steps.push({
      key: 'm.footings.stump',
      params: { count: m.postCount, dia: p.footingDiameter, depth: p.footingDepth, bags: m.bags, m3: m.concreteM3.toFixed(2), post: m.postName, postLength: m.postLength },
      notes: [{ key: 'm.footings.stump.n1' }, { key: 'm.footings.stump.n2' }, { key: 'm.footings.n3' }],
    });
  } else {
    steps.push({
      key: 'm.footings.stirrup',
      params: { count: m.postCount, pad: p.padSize, depth: p.padDepth, bags: m.bags, m3: m.concreteM3.toFixed(2), post: m.postName, postLength: m.postLength },
      notes: [{ key: 'm.footings.stirrup.n1' }, { key: 'm.footings.n3' }],
    });
  }
  const flush = p.joistConnection === 'flush';
  const dropToPostTop = flush
    ? m.boardThickness + (p.bearerToPost === 'onTop' ? m.bearerDepth : 0)
    : p.bearerToPost === 'onTop' ? frameDrop + m.bearerDepth : frameDrop;
  steps.push({
    key: 'm.posts',
    params: { postTop: Math.round(m.postTop), drop: dropToPostTop },
    notes: [{ key: p.bearerToPost === 'onTop' ? 'm.posts.onTop' : p.bearerToPost === 'screwed' ? 'm.posts.screwed' : p.bearerToPost === 'checked' ? 'm.posts.checked' : 'm.posts.bolted', params: { n: m.rules.battenScrewsPerPost, bearer: m.bearerName } }],
  });
  steps.push({
    key: p.bearerToPost === 'screwed' || p.bearerToPost === 'checked' ? 'm.bearers.screwed' : 'm.bearers',
    params: { bearer: m.bearerName, lam: p.bearerLaminations, count: m.layout.bearers.length, maxSpan: Math.round(m.layout.maxBearerSpanUsed), bolts: m.rules.boltsPerPost, screws: m.rules.battenScrewsPerPost },
    notes: [{ key: p.bearerLaminations === 2 ? 'm.bearers.n1' : 'm.bearers.n1.single' }, { key: 'm.bearers.n2' }, ...(flush ? [{ key: 'm.bearers.flush' }] : [])],
  });
  if (m.layout.ledgers.length) {
    const anchors = m.layout.ledgers.reduce((s, l) => s + l.bolts, 0);
    steps.push({
      key: p.wallFixing === 'dynabolt' ? 'm.wall.dynabolt' : 'm.wall.bolt',
      params: { count: m.layout.ledgers.length, spacing: m.rules.ledgerBoltSpacing, anchors, bearer: m.bearerName, lam: p.bearerLaminations },
      notes: [
        { key: p.wallFixing === 'dynabolt' ? 'm.wall.n1.masonry' : 'm.wall.n1.timber' },
        { key: 'm.wall.n2' },
        { key: flush ? 'm.wall.n3.flush' : 'm.wall.n3.onTop' },
      ],
    });
  }
  const nails = p.joistFixing === 'skewNails';
  steps.push({
    key: flush ? 'm.joists.flush' : nails ? 'm.joists.nails' : 'm.joists',
    params: {
      joist: m.joistName, spacing: m.joistSpacingText, count: m.layout.joists.length, span: Math.round(m.layout.joistSpanUsed),
      crossings: m.layout.totals.joistBearerCrossings, hangers: m.layout.totals.hangers,
      nails: m.layout.totals.joistBearerCrossings * m.rules.skewNailsPerCrossing, perCrossing: m.rules.skewNailsPerCrossing,
    },
    notes: [
      { key: flush ? 'm.joists.flush.n1' : nails ? 'm.joists.n1.nails' : 'm.joists.n1', params: { n: m.rules.skewNailsPerCrossing } },
      ...(flush ? [] : [{ key: 'm.joists.ends' }]),
      ...(m.joistSetout
        ? [{ key: 'm.joists.setout', params: { spacing: Math.round(m.joistSetoutSpacing) } }]
        : p.joistSpacingMode === 'auto'
          ? [{ key: 'm.joists.auto', params: { max: Math.round(m.joistSpacingCap), spacing: m.joistSpacingText } }]
          : []),
      ...(m.layout.totals.frameJoists > 0 ? [{ key: 'm.joists.frame', params: { n: m.layout.totals.frameJoists, pairs: Math.ceil(m.layout.totals.frameJoists / 2), inset: Math.round(m.layout.edgeBoards[0]?.width ?? 0) + p.boardGap } }] : []),
      ...(p.joistTape ? [{ key: 'm.joists.n2' }] : []),
      ...(m.layout.totals.boardJoins > 0 ? [{ key: 'm.joists.n3', params: { joins: m.layout.totals.boardJoins } }] : []),
    ],
  });
  if (m.braceCount > 0) {
    steps.push({ key: 'm.bracing', params: { count: m.braceCount }, notes: [{ key: 'm.bracing.n1' }] });
  }
  steps.push({
    key: m.clips ? 'm.decking.clips' : 'm.decking',
    params: { decking: m.deckingName, gap: p.boardGap, rows: m.layout.totals.boardRows, screws: m.layout.totals.screws, perCrossing: m.rules.screwsPerCrossing, clips: m.clips ?? 0 },
    notes: [
      ...(m.layout.edgeBoards.length
        ? [{ key: 'm.decking.edgeBoard', params: { n: m.layout.edgeBoards.length, mitres: m.layout.totals.mitres, product: m.edgeBoardName, lm: (m.layout.totals.edgeBoardLm / 1000).toFixed(1) } }]
        : []),
      ...(m.layout.breakers.length
        ? [{ key: m.layout.breakerMode === 'manual' ? 'm.decking.breaker.manual' : 'm.decking.breaker', params: { n: m.layout.breakers.length, lm: (m.layout.totals.breakerLm / 1000).toFixed(1) } }]
        : []),
      { key: m.layout.breakers.length && m.layout.totals.boardJoins === 0 ? (m.clips ? 'm.decking.clips.n1.nojoins' : 'm.decking.n1.nojoins') : m.clips ? 'm.decking.clips.n1' : 'm.decking.n1', params: { side: m.houseSide ? 'house' : 'edge' } },
      { key: m.layout.breakers.length ? 'm.decking.n2.breaker' : 'm.decking.n2' },
      ...m.layout.rips.map((r) => ({ key: r.notched ? 'm.decking.notch' : r.atHouse ? 'm.decking.rip.house' : 'm.decking.rip', params: { row: r.row, width: r.width, n: r.boards } })),
      { key: 'm.decking.n3' },
      ...(m.composite ? [{ key: 'm.decking.composite' }] : []),
      ...(p.fascia ? [{ key: 'm.decking.fascia' }] : []),
    ],
  });
  for (const s of m.stairs) {
    steps.push({
      key: 'm.stairs',
      params: {
        id: s.id, width: s.width, risers: s.risers, riser: Math.round(s.riser), going: s.going, treads: s.treads,
        stringers: s.stringerCount, stringerLength: s.stringerLength, boards: s.boardsPerTread, run: Math.round(s.totalRun),
      },
      notes: [{ key: 'm.stairs.n1' }, { key: 'm.stairs.n2' }, { key: 'm.stairs.n3', params: { rise: Math.round(s.rise) } }, ...(s.handrail ? [{ key: 'm.stairs.handrail' }] : [])],
    });
  }
  if (m.balustrade.enabled) {
    steps.push({
      key: 'm.balustrade',
      params: { posts: m.balustrade.posts.length, height: p.balustrade.height, spacing: p.balustrade.postSpacing, infill: p.balustrade.infill, length: (m.balustrade.totalLength / 1000).toFixed(1) },
      notes: [{ key: 'm.balustrade.n1' }, { key: 'm.balustrade.n2' }, { key: `m.balustrade.${p.balustrade.infill}` }],
    });
  }
  steps.push({
    key: 'm.finish',
    params: {},
    notes: [{ key: 'm.finish.n1' }, { key: 'm.finish.n2' }, { key: 'm.finish.n3' }],
  });
  return steps;
}
