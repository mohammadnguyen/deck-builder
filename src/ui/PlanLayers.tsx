import { useId } from 'react';
import type { DesignResult } from '../engine';
import { edges as polyEdges, type Edge } from '../engine/geometry';
import type { CornerKind, EdgeBoardRun } from '../engine/layout';
import { bayLabel } from '../engine/layout';
import { useT } from '../i18n';
import type { Project, Pt, Seg } from '../model/types';
import { PRODUCT_MAP, sizeLabel } from '../model/catalog';

export interface LayerFlags {
  house: boolean;
  outline: boolean;
  frame: boolean;
  boards: boolean;
  posts: boolean;
  balustrade: boolean;
  stairs: boolean;
  dims: boolean;
  labels: boolean;
  postLabels: boolean;
  bearerLabels: boolean;
  joins: boolean;
  fascia: boolean;
  /** picture-frame edge boards (drawn with the boards layer) */
  edgeBoards: boolean;
  /** joist centre dimension chain and spacing per bay */
  frameDims: boolean;
  joistLabels: boolean;
  /** board row numbers along the first run of every fifth row */
  rowNumbers: boolean;
}

export const ALL_LAYERS: LayerFlags = {
  house: true, outline: true, frame: true, boards: true, posts: true, balustrade: true, stairs: true,
  dims: true, labels: true, postLabels: true, bearerLabels: true, joins: true, fascia: true,
  edgeBoards: true, frameDims: false, joistLabels: false, rowNumbers: false,
};

export const COLORS = {
  deckFill: '#f6ecd9',
  deckStroke: '#4a3b2a',
  house: '#5b6770',
  bearer: '#8a5a2b',
  joist: '#c89b63',
  ledger: '#c0392b',
  post: '#1f2937',
  board: '#e9d2a8',
  boardStroke: '#c9a874',
  edgeBoard: '#c98f4f',
  edgeBoardStroke: '#7c4a1d',
  breaker: '#d8b07a',
  frameJoist: '#7c4a1d',
  join: '#7c2d12',
  balPost: '#0f766e',
  stair: '#9ca3af',
  dim: '#2563eb',
  grid: '#e5e7eb',
  gridMajor: '#cbd5e1',
  select: '#f59e0b',
};

function segRect(seg: Seg, thickness: number): { x: number; y: number; w: number; h: number } {
  const horizontal = Math.abs(seg.a.y - seg.b.y) < 0.5;
  if (horizontal) {
    const x0 = Math.min(seg.a.x, seg.b.x);
    return { x: x0, y: seg.a.y - thickness / 2, w: Math.abs(seg.b.x - seg.a.x), h: thickness };
  }
  const y0 = Math.min(seg.a.y, seg.b.y);
  return { x: seg.a.x - thickness / 2, y: y0, w: thickness, h: Math.abs(seg.b.y - seg.a.y) };
}

function mid(seg: Seg): Pt {
  return { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
}

const cornerShift = (c: CornerKind): number => (c === 'convex' ? 1 : c === 'concave' ? -1 : 0);

/** Plan outline of a mitred edge board: outer line on the deck edge, inner line one board in. */
export function edgeBoardPolygon(e: Edge, eb: EdgeBoardRun): { pts: Pt[]; mitres: Seg[] } {
  const n = { x: -e.outward.x, y: -e.outward.y };
  const d = e.dir;
  const w = eb.width;
  const s0 = cornerShift(eb.startCorner);
  const s1 = cornerShift(eb.endCorner);
  const innerStart = { x: e.a.x + n.x * w + d.x * w * s0, y: e.a.y + n.y * w + d.y * w * s0 };
  const innerEnd = { x: e.b.x + n.x * w - d.x * w * s1, y: e.b.y + n.y * w - d.y * w * s1 };
  const mitres: Seg[] = [];
  if (eb.startCorner !== 'butt') mitres.push({ a: e.a, b: innerStart });
  if (eb.endCorner !== 'butt') mitres.push({ a: e.b, b: innerEnd });
  return { pts: [e.a, e.b, innerEnd, innerStart], mitres };
}

export function DimChain({ positions, fixed, axis, fs, color = COLORS.dim, sw }: {
  positions: number[];
  fixed: number;
  axis: 'x' | 'y';
  fs: number;
  color?: string;
  sw: number;
}) {
  const pos = [...new Set(positions.map((p) => Math.round(p)))].sort((p, q) => p - q);
  if (pos.length < 2) return null;
  const tick = fs * 0.5;
  const els = [];
  if (axis === 'x') {
    els.push(<line key="l" x1={pos[0]} y1={fixed} x2={pos[pos.length - 1]} y2={fixed} stroke={color} strokeWidth={sw} />);
    pos.forEach((p, i) => {
      els.push(<line key={`t${i}`} x1={p} y1={fixed - tick} x2={p} y2={fixed + tick} stroke={color} strokeWidth={sw} />);
      if (i > 0 && p - pos[i - 1] >= fs * 2.4) {
        els.push(
          <text key={`x${i}`} x={(p + pos[i - 1]) / 2} y={fixed - tick * 0.8} fontSize={fs} fill={color} textAnchor="middle">
            {p - pos[i - 1]}
          </text>,
        );
      }
    });
  } else {
    els.push(<line key="l" x1={fixed} y1={pos[0]} x2={fixed} y2={pos[pos.length - 1]} stroke={color} strokeWidth={sw} />);
    pos.forEach((p, i) => {
      els.push(<line key={`t${i}`} x1={fixed - tick} y1={p} x2={fixed + tick} y2={p} stroke={color} strokeWidth={sw} />);
      if (i > 0 && p - pos[i - 1] >= fs * 2.4) {
        const cy = (p + pos[i - 1]) / 2;
        els.push(
          <text key={`y${i}`} x={fixed - tick * 0.8} y={cy} fontSize={fs} fill={color} textAnchor="middle" transform={`rotate(-90 ${fixed - tick * 0.8} ${cy})`}>
            {p - pos[i - 1]}
          </text>,
        );
      }
    });
  }
  return <g>{els}</g>;
}

export function DesignLayers({ project, design, layers, fs, sw }: {
  project: Project;
  design: DesignResult;
  layers: Partial<LayerFlags>;
  /** font size in world mm */
  fs: number;
  /** base stroke width in world mm */
  sw: number;
}) {
  const { t } = useT();
  const hatchId = useId().replace(/:/g, '');
  const L: LayerFlags = { ...ALL_LAYERS, ...layers };
  const poly = design.poly;
  const lay = design.layout;
  const E = design.ok ? design.edges : poly.length >= 3 ? polyEdges(poly) : [];
  const bw = project.params.bearerLaminations * (PRODUCT_MAP[project.params.bearerProductId]?.width ?? 45);
  const jw = PRODUCT_MAP[project.params.joistProductId]?.width ?? 45;
  const postW = PRODUCT_MAP[design.postProductId]?.width ?? 90;
  const path = poly.length ? `M${poly.map((p) => `${p.x},${p.y}`).join('L')}Z` : '';

  return (
    <g>
      {L.house &&
        project.house.map((pl, i) => (
          <g key={`h${i}`}>
            <polyline points={pl.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={COLORS.house} strokeWidth={sw * 6} strokeLinejoin="miter" strokeDasharray={`${sw * 24} ${sw * 10}`} opacity={0.85} />
            {pl.length >= 2 && (
              <text x={pl[0].x + fs * 0.5} y={pl[0].y - fs * 2.6} fontSize={fs * 0.9} fill={COLORS.house} opacity={0.9}>
                {t('legend.house')}
              </text>
            )}
          </g>
        ))}

      {L.outline && path && <path d={path} fill={COLORS.deckFill} stroke={COLORS.deckStroke} strokeWidth={sw * 2} />}

      {L.boards && lay &&
        lay.boards.map((row) =>
          row.runs.map((run, ri) => {
            const r = segRect(run.seg, run.width);
            return <rect key={`b${row.index}-${ri}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={COLORS.board} stroke={COLORS.boardStroke} strokeWidth={sw * 0.6} />;
          }),
        )}
      {L.boards && L.joins && lay &&
        lay.boards.map((row) =>
          row.runs.map((run, ri) =>
            run.joins.map((j, ji) => {
              const horizontal = Math.abs(run.seg.a.y - run.seg.b.y) < 0.5;
              const half = run.width / 2;
              return horizontal ? (
                <line key={`j${row.index}-${ri}-${ji}`} x1={j} y1={run.seg.a.y - half} x2={j} y2={run.seg.a.y + half} stroke={COLORS.join} strokeWidth={sw * 2} />
              ) : (
                <line key={`j${row.index}-${ri}-${ji}`} x1={run.seg.a.x - half} y1={j} x2={run.seg.a.x + half} y2={j} stroke={COLORS.join} strokeWidth={sw * 2} />
              );
            }),
          ),
        )}

      {L.boards && L.edgeBoards && lay &&
        lay.edgeBoards.map((eb) => {
          const e = E[eb.edgeIndex];
          if (!e) return null;
          const { pts, mitres } = edgeBoardPolygon(e, eb);
          const n = { x: -e.outward.x, y: -e.outward.y };
          return (
            <g key={`eb${eb.edgeIndex}`}>
              <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={COLORS.edgeBoard} stroke={COLORS.edgeBoardStroke} strokeWidth={sw * 0.8} />
              {mitres.map((m, i) => (
                <line key={`m${i}`} x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={COLORS.edgeBoardStroke} strokeWidth={sw * 1.2} />
              ))}
              {eb.joinPts.map((jp, i) => (
                <line key={`ej${i}`} x1={jp.x} y1={jp.y} x2={jp.x + n.x * eb.width} y2={jp.y + n.y * eb.width} stroke={COLORS.join} strokeWidth={sw * 2} />
              ))}
            </g>
          );
        })}
      {L.boards && lay && lay.rips.length > 0 && (
        <g>
          <defs>
            <pattern id={`rip-${hatchId}`} patternUnits="userSpaceOnUse" width={fs * 0.8} height={fs * 0.8} patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={fs * 0.8} stroke={COLORS.join} strokeWidth={sw * 1.2} />
            </pattern>
          </defs>
          {lay.boards.flatMap((row) =>
            row.runs.map((run, ri) => {
              if (!run.ripped) return null;
              const r = segRect(run.seg, run.width);
              const horizontal = Math.abs(run.seg.a.y - run.seg.b.y) < 0.5;
              const lx = horizontal ? Math.max(run.seg.a.x, run.seg.b.x) - fs * 0.4 : run.seg.a.x;
              const ly = horizontal ? run.seg.a.y : Math.max(run.seg.a.y, run.seg.b.y) - fs * 0.4;
              return (
                <g key={`rip${row.index}-${ri}`}>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#rip-${hatchId})`} stroke={COLORS.join} strokeWidth={sw * 0.8} />
                  {L.rowNumbers && run.length > fs * 6 && (
                    <text
                      x={lx}
                      y={ly + (horizontal ? fs * 0.3 : 0)}
                      fontSize={fs * 0.8}
                      fill={COLORS.join}
                      fontWeight={700}
                      textAnchor="end"
                      transform={horizontal ? undefined : `rotate(-90 ${lx} ${ly})`}
                    >
                      {t('plan.rip', { width: Math.round(run.width) })}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </g>
      )}
      {L.boards && lay &&
        lay.breakers.map((br, i) => {
          const r = segRect(br.seg, br.width);
          return <rect key={`br${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={COLORS.breaker} stroke={COLORS.edgeBoardStroke} strokeWidth={sw * 1.2} />;
        })}
      {L.boards && L.rowNumbers && lay &&
        lay.boards.map((row, i, rows) => {
          if (!row.runs.length || !(i === 0 || (i + 1) % 5 === 0 || i === rows.length - 1)) return null;
          const run = row.runs[0];
          const horizontal = Math.abs(run.seg.a.y - run.seg.b.y) < 0.5;
          const x = horizontal ? Math.min(run.seg.a.x, run.seg.b.x) + fs * 0.3 : run.seg.a.x;
          const y = horizontal ? run.seg.a.y : Math.min(run.seg.a.y, run.seg.b.y) + fs * 0.3;
          return (
            <text key={`rn${i}`} x={x} y={y + fs * 0.3} fontSize={fs * 0.8} fill={COLORS.join} fontWeight={600} textAnchor={horizontal ? 'start' : 'middle'}>
              {i + 1}
            </text>
          );
        })}

      {L.frame && lay && (
        <g>
          {lay.joists.map((j) => {
            const r = segRect(j.seg, jw);
            return (
              <rect
                key={j.id}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill={COLORS.joist}
                opacity={j.kind === 'frame' ? 0.95 : 0.75}
                stroke={j.kind === 'frame' ? COLORS.frameJoist : undefined}
                strokeWidth={j.kind === 'frame' ? sw * 1.2 : undefined}
                strokeDasharray={j.kind === 'frame' ? `${sw * 6} ${sw * 4}` : undefined}
              />
            );
          })}
          {L.joistLabels &&
            lay.joists.map((j) => {
              const horizontal = Math.abs(j.seg.a.y - j.seg.b.y) < 0.5;
              const x = horizontal ? Math.min(j.seg.a.x, j.seg.b.x) + fs * 0.4 : j.seg.a.x;
              const y = horizontal ? j.seg.a.y : Math.min(j.seg.a.y, j.seg.b.y) + fs * 0.4;
              return (
                <text
                  key={`jl${j.id}`}
                  x={x}
                  y={y}
                  fontSize={fs * 0.7}
                  fill={COLORS.frameJoist}
                  textAnchor="start"
                  transform={horizontal ? `translate(0 ${-jw / 2 - fs * 0.2})` : `rotate(90 ${x} ${y}) translate(0 ${-jw / 2 - fs * 0.2})`}
                >
                  {j.id}
                </text>
              );
            })}
          {lay.bearers.map((b) => {
            const r = segRect(b.seg, bw);
            const horizontal = Math.abs(b.seg.a.y - b.seg.b.y) < 0.5;
            const m = { x: b.seg.a.x + (b.seg.b.x - b.seg.a.x) * 0.3, y: b.seg.a.y + (b.seg.b.y - b.seg.a.y) * 0.3 };
            return (
              <g key={b.id}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={COLORS.bearer} />
                {b.splices.flat().map((s, si) =>
                  horizontal ? (
                    <line key={si} x1={s} y1={r.y - sw * 2} x2={s} y2={r.y + r.h + sw * 2} stroke="#fff" strokeWidth={sw * 1.5} />
                  ) : (
                    <line key={si} x1={r.x - sw * 2} y1={s} x2={r.x + r.w + sw * 2} y2={s} stroke="#fff" strokeWidth={sw * 1.5} />
                  ),
                )}
                {L.bearerLabels && (
                  <text
                    x={horizontal ? m.x : m.x + fs * 0.9}
                    y={horizontal ? m.y - bw / 2 - fs * 0.4 : m.y}
                    fontSize={fs}
                    fill={COLORS.bearer}
                    textAnchor="middle"
                    fontWeight={600}
                    transform={horizontal ? undefined : `rotate(-90 ${m.x + fs * 0.9} ${m.y})`}
                  >
                    {b.id} {project.params.bearerLaminations}/{sizeLabel(project.params.bearerProductId)}
                  </text>
                )}
              </g>
            );
          })}
          {lay.ledgers.map((l, i) => {
            const r = segRect(l.seg, jw);
            return <rect key={`ledger${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={COLORS.ledger} />;
          })}
        </g>
      )}

      {L.posts && lay &&
        lay.posts.map((p) => (
          <g key={p.id}>
            <rect x={p.pt.x - postW / 2} y={p.pt.y - postW / 2} width={postW} height={postW} fill="#fff" stroke={COLORS.post} strokeWidth={sw * 1.5} />
            <line x1={p.pt.x - postW / 2} y1={p.pt.y - postW / 2} x2={p.pt.x + postW / 2} y2={p.pt.y + postW / 2} stroke={COLORS.post} strokeWidth={sw} />
            <line x1={p.pt.x + postW / 2} y1={p.pt.y - postW / 2} x2={p.pt.x - postW / 2} y2={p.pt.y + postW / 2} stroke={COLORS.post} strokeWidth={sw} />
            {L.postLabels && (
              <text x={p.pt.x + postW / 2 + fs * 0.2} y={p.pt.y - postW / 2 - fs * 0.1} fontSize={fs * 0.9} fill={COLORS.post} fontWeight={600}>
                {p.id}
              </text>
            )}
          </g>
        ))}

      {L.frameDims && lay && design.ok && lay.joistPositions.length > 1 && (() => {
        // keep the joist chain clear of stairs hanging off the bottom / right edge
        let maxY = design.bb.maxY;
        let maxX = design.bb.maxX;
        for (const st of design.stairs) for (const pt of st.outline) {
          maxY = Math.max(maxY, pt.y);
          maxX = Math.max(maxX, pt.x);
        }
        const lineY = maxY + fs * 2.2;
        const lineX = maxX + fs * 3.2;
        return (
          <g>
            {lay.boardAxis === 'x' ? (
              <DimChain axis="x" fixed={lineY} positions={lay.joistPositions} fs={fs * 0.8} sw={sw} color={COLORS.frameJoist} />
            ) : (
              <DimChain axis="y" fixed={lineX} positions={lay.joistPositions} fs={fs * 0.8} sw={sw} color={COLORS.frameJoist} />
            )}
            {lay.joistBays.map((b, i) => {
              const c = (b.from + b.to) / 2;
              const label = bayLabel(b);
              return lay.boardAxis === 'x' ? (
                <text key={`bay${i}`} x={c} y={lineY + fs * 2} fontSize={fs * 0.85} fill={COLORS.frameJoist} textAnchor="middle" fontWeight={600}>
                  {label}
                </text>
              ) : (
                <text key={`bay${i}`} x={lineX + fs * 1.6} y={c} fontSize={fs * 0.85} fill={COLORS.frameJoist} textAnchor="middle" fontWeight={600} transform={`rotate(-90 ${lineX + fs * 1.6} ${c})`}>
                  {label}
                </text>
              );
            })}
          </g>
        );
      })()}

      {L.fascia && design.ok && design.fascia.length > 0 &&
        design.fascia.map((f) => {
          const e = E[f.edgeIndex];
          if (!e) return null;
          return <line key={`f${f.edgeIndex}`} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={COLORS.deckStroke} strokeWidth={sw * 4} />;
        })}

      {L.stairs &&
        design.stairs.map((s, i) => (
          <g key={s.id}>
            <polygon points={s.outline.map((p) => `${p.x},${p.y}`).join(' ')} fill="#f3f4f6" stroke={COLORS.stair} strokeWidth={sw * 1.5} />
            {s.treadLines.map((tl, k) => (
              <line key={k} x1={tl.a.x} y1={tl.a.y} x2={tl.b.x} y2={tl.b.y} stroke={COLORS.stair} strokeWidth={sw} />
            ))}
            <text x={(s.outline[0].x + s.outline[2].x) / 2} y={(s.outline[0].y + s.outline[2].y) / 2} fontSize={fs} fill="#374151" textAnchor="middle" fontWeight={600}>
              {s.id || `S${i + 1}`}
            </text>
          </g>
        ))}

      {L.balustrade && design.balustrade.enabled && (
        <g>
          {design.balustrade.segments.map((seg, i) => {
            const e = E[seg.edgeIndex];
            if (!e) return null;
            const a = { x: e.a.x + e.dir.x * seg.t0, y: e.a.y + e.dir.y * seg.t0 };
            const b = { x: e.a.x + e.dir.x * seg.t1, y: e.a.y + e.dir.y * seg.t1 };
            return <line key={`bs${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS.balPost} strokeWidth={sw * 3} />;
          })}
          {design.balustrade.posts.map((p, i) => (
            <rect key={`bp${i}`} x={p.x - 45} y={p.y - 45} width={90} height={90} fill={COLORS.balPost} />
          ))}
        </g>
      )}

      {L.labels &&
        E.map((e) => {
          const m = mid({ a: e.a, b: e.b });
          const off = fs * 1.1;
          const isHouse = project.houseEdges.includes(e.index);
          const x = m.x - e.outward.x * off;
          const y = m.y - e.outward.y * off;
          const vertical = e.axis === 'y';
          return (
            <g key={`el${e.index}`}>
              {isHouse && <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={COLORS.house} strokeWidth={sw * 5} />}
              <text
                x={x}
                y={y + (vertical ? 0 : fs * 0.35)}
                fontSize={fs}
                fill={isHouse ? COLORS.house : '#374151'}
                textAnchor="middle"
                transform={vertical ? `rotate(-90 ${x} ${y})` : undefined}
              >
                {Math.round(e.length)}
              </text>
            </g>
          );
        })}

      {L.dims && lay && design.ok && (
        <g>
          {lay.supportAxis === 'y' ? (
            <DimChain axis="y" fixed={design.bb.minX - fs * 2.2} positions={[design.bb.minY, ...lay.supports.map((s) => s.pos), design.bb.maxY]} fs={fs * 0.85} sw={sw} />
          ) : (
            <DimChain axis="x" fixed={design.bb.minY - fs * 2.2} positions={[design.bb.minX, ...lay.supports.map((s) => s.pos), design.bb.maxX]} fs={fs * 0.85} sw={sw} />
          )}
          {lay.bearers.map((b) => {
            const horizontal = Math.abs(b.seg.a.y - b.seg.b.y) < 0.5;
            const inset = project.rules.bearerEndInset;
            return horizontal ? (
              <DimChain key={`dc${b.id}`} axis="x" fixed={b.seg.a.y - fs * 1.4} positions={[b.seg.a.x - inset, ...b.posts.map((p) => p.x), b.seg.b.x + inset]} fs={fs * 0.8} sw={sw} />
            ) : (
              <DimChain key={`dc${b.id}`} axis="y" fixed={b.seg.a.x - fs * 1.4} positions={[b.seg.a.y - inset, ...b.posts.map((p) => p.y), b.seg.b.y + inset]} fs={fs * 0.8} sw={sw} />
            );
          })}
          <DimChain axis="x" fixed={design.bb.minY - fs * 4.4} positions={[design.bb.minX, design.bb.maxX]} fs={fs * 0.85} sw={sw} />
          <DimChain axis="y" fixed={design.bb.minX - fs * 4.4} positions={[design.bb.minY, design.bb.maxY]} fs={fs * 0.85} sw={sw} />
          <g>
            <circle cx={design.datum.x} cy={design.datum.y} r={fs * 0.45} fill="none" stroke={COLORS.dim} strokeWidth={sw * 1.5} />
            <line x1={design.datum.x - fs * 0.7} y1={design.datum.y} x2={design.datum.x + fs * 0.7} y2={design.datum.y} stroke={COLORS.dim} strokeWidth={sw} />
            <line x1={design.datum.x} y1={design.datum.y - fs * 0.7} x2={design.datum.x} y2={design.datum.y + fs * 0.7} stroke={COLORS.dim} strokeWidth={sw} />
          </g>
        </g>
      )}
    </g>
  );
}
