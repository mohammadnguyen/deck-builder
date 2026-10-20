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
    notes: [{ key: 'm.setout.n1' }, { key: 'm.setout.n2' }],
  });
  if (p.footingType === 'stump') {
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
    notes: [{ key: p.bearerToPost === 'onTop' ? 'm.posts.onTop' : p.bearerToPost === 'screwed' ? 'm.posts.screwed' : 'm.posts.bolted', params: { n: m.rules.battenScrewsPerPost } }],
  });
  steps.push({
    key: p.bearerToPost === 'screwed' ? 'm.bearers.screwed' : 'm.bearers',
    params: { bearer: m.bearerName, lam: p.bearerLaminations, count: m.layout.bearers.length, maxSpan: Math.round(m.layout.maxBearerSpanUsed), bolts: m.rules.boltsPerPost, screws: m.rules.battenScrewsPerPost },
    notes: [{ key: 'm.bearers.n1' }, { key: 'm.bearers.n2' }, ...(flush ? [{ key: 'm.bearers.flush' }] : [])],
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
      joist: m.joistName, spacing: p.joistSpacing, count: m.layout.joists.length, span: Math.round(m.layout.joistSpanUsed),
      crossings: m.layout.totals.joistBearerCrossings, hangers: m.layout.totals.hangers,
      nails: m.layout.totals.joistBearerCrossings * m.rules.skewNailsPerCrossing, perCrossing: m.rules.skewNailsPerCrossing,
    },
    notes: [
      { key: flush ? 'm.joists.flush.n1' : nails ? 'm.joists.n1.nails' : 'm.joists.n1', params: { n: m.rules.skewNailsPerCrossing } },
      ...(m.composite ? [] : [{ key: 'm.joists.n2' }]),
      { key: 'm.joists.n3', params: { joins: m.layout.totals.boardJoins } },
    ],
  });
  if (m.braceCount > 0) {
    steps.push({ key: 'm.bracing', params: { count: m.braceCount }, notes: [{ key: 'm.bracing.n1' }] });
  }
  steps.push({
    key: m.clips ? 'm.decking.clips' : 'm.decking',
    params: { decking: m.deckingName, gap: p.boardGap, rows: m.layout.totals.boardRows, screws: m.layout.totals.screws, perCrossing: m.rules.screwsPerCrossing, clips: m.clips ?? 0 },
    notes: [
      { key: m.clips ? 'm.decking.clips.n1' : 'm.decking.n1' },
      { key: 'm.decking.n2' },
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
      notes: [{ key: 'm.stairs.n1' }, { key: 'm.stairs.n2' }, ...(s.handrail ? [{ key: 'm.stairs.handrail' }] : [])],
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
