import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DesignResult } from '../engine';
import { productName, useT } from '../i18n';
import { PRODUCT_MAP, sizeLabel } from '../model/catalog';
import type { Project } from '../model/types';
import { useApp } from '../state';
import { exportCsv, exportProjectJson, exportXlsx } from '../utils/export';
import { stockLabel, today } from '../utils/format';
import { BomTable } from './BomTable';
import { DetailsGrid } from './Details';
import { COLORS, DesignLayers, type LayerFlags } from './PlanLayers';
import { WarningList } from './SidePanel';

const SCALES = [10, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300];
const PLAN_W = 268; // mm of paper available for the plan
const PLAN_H = 236;

function fitScale(design: DesignResult): { S: number; vb: string } {
  let minX = design.bb.minX;
  let minY = design.bb.minY;
  let maxX = design.bb.maxX;
  let maxY = design.bb.maxY;
  for (const s of design.stairs) for (const p of s.outline) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  // dimension chains and labels need roughly 18 mm of paper on each side
  const need = Math.max(w / (PLAN_W - 40), h / (PLAN_H - 40));
  const S = SCALES.find((s) => s >= need) ?? SCALES[SCALES.length - 1];
  const vw = PLAN_W * S;
  const vh = PLAN_H * S;
  const cx = (minX + maxX) / 2 + 4 * S;
  const cy = (minY + maxY) / 2 + 4 * S;
  return { S, vb: `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}` };
}

function Sheet({ n, total, title, project, children, scale }: { n: number; total: number; title: string; project: Project; children: ReactNode; scale?: string }) {
  const { t } = useT();
  return (
    <section className="sheet">
      <div className="sheet-body">{children}</div>
      <div className="title-block">
        <div className="tb-cell grow">
          <small>{t('app.projectName')}</small>
          <b>{project.name}</b>
          <span>{[project.client, project.address].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="tb-cell grow">
          <small>{t('sheet.sheet')}</small>
          <b>{title}</b>
        </div>
        <div className="tb-cell">
          <small>{t('sheet.scale')}</small>
          <b>{scale ?? '-'}</b>
        </div>
        <div className="tb-cell">
          <small>{t('sheet.date')}</small>
          <b>{today()}</b>
        </div>
        <div className="tb-cell">
          <small>{t('sheet.sheet')}</small>
          <b>
            {n} / {total}
          </b>
        </div>
        <div className="tb-cell disclaimer">{t('sheet.disclaimer')}</div>
      </div>
    </section>
  );
}

function PlanSvg({ project, design, layers, S, vb }: { project: Project; design: DesignResult; layers: Partial<LayerFlags>; S: number; vb: string }) {
  return (
    <svg className="plan-svg" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      <DesignLayers project={project} design={design} layers={layers} fs={2.6 * S} sw={0.18 * S} />
    </svg>
  );
}

function Legend({ items }: { items: { color: string; label: string; shape?: 'line' | 'box' }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <div key={it.label}>
          <span className="swatch" style={{ background: it.color, height: it.shape === 'line' ? 3 : 10 }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}

export function SheetsView() {
  const { project, design, lang, setUi } = useApp();
  const { t } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.6);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const upd = () => setZoom(Math.min(1, (el.clientWidth - 40) / 1600));
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    upd();
    return () => ro.disconnect();
  }, []);

  if (!design.ok || !design.layout) {
    return (
      <div className="sheets-wrap" ref={wrapRef}>
        <p className="muted" style={{ padding: 24 }}>
          {t('res.invalid')}
        </p>
        <button className="btn" onClick={() => setUi({ mode: 'design' })}>
          {t('app.design')}
        </button>
      </div>
    );
  }
  const lay = design.layout;
  const p = project.params;
  const { S, vb } = fitScale(design);
  const scaleLabel = `1:${S} @ A3`;
  const total = 7;
  const footingText =
    p.footingType === 'stump' ? t('footing.stump', { dia: p.footingDiameter, depth: p.footingDepth })
    : p.footingType === 'stirrup' ? t('footing.stirrup', { pad: p.padSize, depth: p.padDepth })
    : t('footing.slab');

  const joistGroups = new Map<number, number>();
  for (const j of lay.joists) joistGroups.set(Math.round(j.length), (joistGroups.get(Math.round(j.length)) ?? 0) + 1);
  const joistSummary = [...joistGroups.entries()].sort((a, b) => b[0] - a[0]).map(([len, n]) => `${n} x ${len}`).join(', ');
  const spacingMode = p.joistSpacingMode === 'auto' ? t('sheet.spacingAuto', { max: p.joistSpacingMax }) : t('sheet.spacingFixed');
  const baySummary = lay.joistBays.map((b) => `${b.count} x @${Math.round(b.spacing)}`).join(', ');
  const edgeBoardLine = design.bom.lines.find((l) => l.tags.includes('edgeBoard'));
  const lastRow = lay.boards[lay.boards.length - 1];
  const houseSide = lay.startsAtHouse;
  // joists run across the boards: perpendicular to a house wall that the boards run along
  const joistsToWall = project.houseEdges.some((i) => design.edges[i]?.axis === lay.boardAxis);
  const bw = PRODUCT_MAP[p.deckingProductId]?.width ?? 0;

  const clipLine = design.bom.lines.find((l) => l.tags.includes('clip'));
  const edgeScrewLine = design.bom.lines.find((l) => l.tags.includes('edgeScrew'));

  return (
    <div className="sheets-wrap" ref={wrapRef}>
      <div className="sheets-toolbar no-print">
        <button className="btn primary" onClick={() => window.print()}>
          {t('app.print')}
        </button>
        <button className="btn" onClick={() => void exportXlsx(project, design, lang)}>
          {t('app.exportXlsx')}
        </button>
        <button className="btn" onClick={() => exportCsv(project, design, lang)}>
          {t('app.exportCsv')}
        </button>
        <button className="btn" onClick={() => exportProjectJson(project)}>
          {t('app.exportJson')}
        </button>
        <span className="muted">{scaleLabel}</span>
      </div>
      <div className="sheets" style={{ zoom }}>
        <Sheet n={1} total={total} title={t('sheet.setout')} project={project} scale={scaleLabel}>
          <div className="plan-area">
            <PlanSvg project={project} design={design} S={S} vb={vb} layers={{ frame: false, boards: false, balustrade: false, fascia: false, stairs: true, posts: true, dims: true, labels: true }} />
          </div>
          <div className="side-col">
            <h3>{t('sheet.footingSchedule')}</h3>
            <table className="sch">
              <thead>
                <tr>
                  <th>{t('col.id')}</th>
                  <th>{t('col.x')}</th>
                  <th>{t('col.y')}</th>
                  <th>{t('col.bearer')}</th>
                </tr>
              </thead>
              <tbody>
                {lay.posts.map((po) => (
                  <tr key={po.id}>
                    <td>{po.id}</td>
                    <td>{Math.round(po.pt.x - design.datum.x)}</td>
                    <td>{Math.round(po.pt.y - design.datum.y)}</td>
                    <td>{po.bearerId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>{t('sheet.notes')}</h3>
            <p>{t('sheet.footingNote', { footing: footingText, depth: p.footingType === 'stump' ? p.footingDepth : p.padDepth })}</p>
            <p>
              {t('sheet.datum')}: {t('sheet.north')}.
            </p>
            <Legend items={[{ color: COLORS.post, label: t('legend.post') }, { color: COLORS.house, label: t('legend.house'), shape: 'line' }, { color: COLORS.stair, label: t('legend.stair') }]} />
          </div>
        </Sheet>

        <Sheet n={2} total={total} title={t('sheet.framing')} project={project} scale={scaleLabel}>
          <div className="plan-area">
            <PlanSvg project={project} design={design} S={S} vb={vb} layers={{ frame: true, boards: false, balustrade: false, fascia: false, stairs: true, posts: true, dims: false, labels: true, postLabels: false, frameDims: true, joistLabels: true }} />
          </div>
          <div className="side-col">
            <h3>{t('sheet.memberSchedule')}</h3>
            <table className="sch">
              <thead>
                <tr>
                  <th>{t('col.member')}</th>
                  <th>{t('col.size')}</th>
                  <th>{t('col.length')}</th>
                  <th>{t('col.posts')}</th>
                  <th>{t('col.span')}</th>
                </tr>
              </thead>
              <tbody>
                {lay.bearers.map((b) => (
                  <tr key={b.id}>
                    <td>{b.id}</td>
                    <td>
                      {p.bearerLaminations}/{sizeLabel(p.bearerProductId)}
                    </td>
                    <td>{Math.round(b.length)}</td>
                    <td>{b.onWall ? t('legend.wall') : b.posts.length}</td>
                    <td>{b.onWall ? (p.wallFixing === 'dynabolt' ? 'Dynabolt' : 'M12') + ` @ ${project.rules.ledgerBoltSpacing}` : Math.round(b.postSpacing)}</td>
                  </tr>
                ))}
                <tr>
                  <td>J1-J{lay.joists.length}</td>
                  <td>{sizeLabel(p.joistProductId)}</td>
                  <td colSpan={3}>{joistSummary}</td>
                </tr>
                <tr>
                  <td>{t('col.spacing')}</td>
                  <td>@{design.joistSpacingText}</td>
                  <td colSpan={3}>
                    {baySummary} ({spacingMode})
                  </td>
                </tr>
                {lay.totals.frameJoists > 0 && (
                  <tr>
                    <td>{t('legend.frameJoist')}</td>
                    <td>{sizeLabel(p.joistProductId)}</td>
                    <td colSpan={3}>{lay.totals.frameJoists}</td>
                  </tr>
                )}
                {lay.ledgers.map((l, i) => (
                  <tr key={`L${i}`}>
                    <td>{t('legend.wall')}</td>
                    <td>{sizeLabel(p.bearerProductId)}</td>
                    <td>{Math.round(l.length)}</td>
                    <td colSpan={2}>
                      {p.wallFixing === 'dynabolt' ? 'Dynabolt M12x100' : 'M12'} x {l.bolts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>{t('sheet.levels')}</h3>
            <table className="sch">
              <tbody>
                <tr>
                  <td>{t('lvl.deck')}</td>
                  <td>+{p.deckHeight}</td>
                </tr>
                <tr>
                  <td>{t('lvl.joistTop')}</td>
                  <td>+{Math.round(design.levels.joistTop)}</td>
                </tr>
                <tr>
                  <td>{t('lvl.bearerTop')}</td>
                  <td>+{Math.round(design.levels.bearerTop)}</td>
                </tr>
                <tr>
                  <td>{t('lvl.postTop')}</td>
                  <td>+{Math.round(design.levels.postTop)}</td>
                </tr>
                <tr>
                  <td>{t('lvl.clearance')}</td>
                  <td>{Math.round(design.levels.groundClearance)}</td>
                </tr>
              </tbody>
            </table>
            <h3>{t('sheet.notes')}</h3>
            <p>{t('sheet.framingNote1', { lam: p.bearerLaminations, bearer: sizeLabel(p.bearerProductId), joist: sizeLabel(p.joistProductId), spacing: design.joistSpacingText, mode: spacingMode })}</p>
            <p>{t('sheet.framingNote2', { post: sizeLabel(design.postProductId), footing: footingText })}</p>
            <p>{t(joistsToWall ? 'sheet.framingNote3' : 'sheet.framingNote3.free')}</p>
            {lay.totals.frameJoists > 0 && <p>{t('sheet.framingNote4')}</p>}
            {design.braces.count > 0 && <p>{t('m.bracing', { count: design.braces.count })}</p>}
            <Legend items={[{ color: COLORS.bearer, label: t('legend.bearer') }, { color: COLORS.joist, label: t('legend.joist') }, { color: COLORS.frameJoist, label: t('legend.frameJoist') }, { color: COLORS.post, label: t('legend.post') }, { color: COLORS.ledger, label: t('legend.wall') }]} />
          </div>
        </Sheet>

        <Sheet n={3} total={total} title={t('sheet.decking')} project={project} scale={scaleLabel}>
          <div className="plan-area">
            <PlanSvg project={project} design={design} S={S} vb={vb} layers={{ frame: false, boards: true, joins: true, edgeBoards: true, rowNumbers: true, balustrade: true, fascia: true, stairs: true, posts: false, dims: false, labels: true, frameDims: true }} />
          </div>
          <div className="side-col">
            <h3>{t('sheet.notes')}</h3>
            <p>{t(clipLine ? 'sheet.deckingNote1.clips' : 'sheet.deckingNote1', { decking: productName(p.deckingProductId, lang), gap: p.boardGap, pitch: bw + p.boardGap })}</p>
            {lay.edgeBoards.length > 0 && (
              <p>{t('sheet.deckingNote4', { product: productName(design.edgeBoardProductId, lang), n: lay.edgeBoards.length, lm: (lay.totals.edgeBoardLm / 1000).toFixed(1), mitres: lay.totals.mitres, gap: p.boardGap })}</p>
            )}
            {lay.breakers.length > 0 && <p>{t('sheet.deckingNote6', { n: lay.breakers.length, lm: (lay.totals.breakerLm / 1000).toFixed(1) })}</p>}
            <p>{t(lay.breakers.length ? 'sheet.deckingNote2.breaker' : 'sheet.deckingNote2')}</p>
            {lay.rips.length ? (
              <p>
                <b>{t(houseSide ? 'sheet.rows.house' : 'sheet.rows.edge')} {lay.rips.map((r) => t('sheet.ripRow', { row: r.row, width: r.width, n: r.boards })).join(t('list.sep'))}</b>
              </p>
            ) : (
              lastRow && <p>{t(houseSide ? 'sheet.rows.house' : 'sheet.rows.edge')} {t('sheet.deckingNote5', { last: Math.round(lastRow.width) })}</p>
            )}
            {design.balustrade.enabled && <p>{t('sheet.deckingNote3')}</p>}
            <table className="sch">
              <tbody>
                <tr>
                  <td>{t('res.rows')}</td>
                  <td>{lay.totals.boardRows}</td>
                </tr>
                <tr>
                  <td>{t('res.boards')}</td>
                  <td>{(lay.totals.boardLm / 1000).toFixed(1)} m</td>
                </tr>
                <tr>
                  <td>{t('legend.join')}</td>
                  <td>{lay.totals.boardJoins}</td>
                </tr>
                {lay.edgeBoards.length > 0 && (
                  <>
                    <tr>
                      <td>{t('legend.edgeBoard')}</td>
                      <td>
                        {lay.edgeBoards.length} / {(lay.totals.edgeBoardLm / 1000).toFixed(1)} m{edgeBoardLine ? ` / ${edgeBoardLine.qty} x ${stockLabel(edgeBoardLine.stockBreakdown)}` : ''}
                      </td>
                    </tr>
                    <tr>
                      <td>{t('legend.mitre')}</td>
                      <td>{lay.totals.mitres}</td>
                    </tr>
                  </>
                )}
                {clipLine ? (
                  <>
                    <tr>
                      <td>{t('tag.clip')}</td>
                      <td>{clipLine.qty}</td>
                    </tr>
                    <tr>
                      <td>{t('tag.edgeScrew')}</td>
                      <td>{edgeScrewLine?.qty ?? 0}</td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td>{t('res.screws')}</td>
                    <td>{lay.totals.screws}</td>
                  </tr>
                )}
                {design.balustrade.enabled && (
                  <tr>
                    <td>{t('legend.balPost')}</td>
                    <td>{design.balustrade.posts.length}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {design.stairs.map((s) => (
              <p key={s.id}>{t('m.stairs', { id: s.id, width: s.width, risers: s.risers, riser: Math.round(s.riser), going: s.going, treads: s.treads, run: Math.round(s.totalRun), stringers: s.stringerCount, stringerLength: s.stringerLength, boards: s.boardsPerTread })}</p>
            ))}
            <Legend items={[{ color: COLORS.board, label: t('legend.board') }, { color: COLORS.edgeBoard, label: t('legend.edgeBoard') }, ...(lay.breakers.length ? [{ color: COLORS.breaker, label: t('legend.breaker') }] : []), ...(lay.rips.length ? [{ color: COLORS.join, label: t('legend.rip') }] : []), { color: COLORS.join, label: t('legend.join'), shape: 'line' }, { color: COLORS.balPost, label: t('legend.balPost') }, { color: COLORS.stair, label: t('legend.stair') }]} />
          </div>
        </Sheet>

        <Sheet n={4} total={total} title={t('sheet.details')} project={project} scale="NTS">
          <DetailsGrid project={project} design={design} />
        </Sheet>

        <Sheet n={5} total={total} title={t('sheet.bom')} project={project}>
          <BomTable design={design} params={p} />
          <p className="muted small">{t('pr.intro')}</p>
        </Sheet>

        <Sheet n={6} total={total} title={t('sheet.cutlist')} project={project}>
          <p className="small">{t('cut.intro')}</p>
          <div className="cut-grid">
            {design.bom.cutlists.map((c) => (
              <table key={c.productId} className="sch cut">
                <thead>
                  <tr>
                    <th colSpan={4}>
                      {productName(c.productId, lang)} · {t('cut.waste')} {c.wastePct.toFixed(0)}%
                      {lay.rips.length && c.productId === p.deckingProductId ? ` · ${lay.rips.map((r) => t('cut.rip', { n: r.boards, width: r.width })).join(t('list.sep'))}` : ''}
                    </th>
                  </tr>
                  <tr>
                    <th>{t('cut.stock')}</th>
                    <th>{t('cut.count')}</th>
                    <th>{t('cut.cuts')}</th>
                    <th>{t('cut.offcut')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.groups.map((g, i) => (
                    <tr key={i}>
                      <td>{g.stock}</td>
                      <td>{g.count}</td>
                      <td>{g.cuts.join(' + ')}</td>
                      <td>{Math.round(g.offcut)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </Sheet>

        <Sheet n={7} total={total} title={t('sheet.method')} project={project}>
          <div className="method-cols">
            <ol className="method">
              {design.method.map((s, i) => (
                <li key={i}>
                  <b>{t(s.key, s.params)}</b>
                  <ul>
                    {s.notes.map((n, k) => (
                      <li key={k}>{t(n.key, n.params)}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <div>
              <h3>{t('res.warnings')}</h3>
              <p className={design.pathway === 'exemptPossible' ? 'ok' : 'warn'}>
                {t('res.pathway')}: {t(`pathway.${design.pathway}`)}
              </p>
              <WarningList warnings={design.warnings} />
              {p.notes && (
                <>
                  <h3>{t('p.notes')}</h3>
                  <p>{p.notes}</p>
                </>
              )}
            </div>
          </div>
        </Sheet>
      </div>
    </div>
  );
}
