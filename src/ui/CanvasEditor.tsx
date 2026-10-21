import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeDesign } from '../engine';
import { detectHouseEdges, dist, edges as polyEdges, normalizePolygon, pointInPolygon, projectOnEdge, validatePolygon } from '../engine/geometry';
import type { LayoutResult } from '../engine/layout';
import { useT } from '../i18n';
import type { BreakerLayout, Pt } from '../model/types';
import { useApp, type Selection as UISelection, type Tool } from '../state';
import { acrossOf, alongOf, breakerBays, breakerRoom, breakerSpans, currentBreakers, mainBay, movedBreaker, removeBreaker, snapBreakerEnd, stripWidth, updateBreaker, type BreakerSpan } from '../utils/breakers';
import type { ManualBreaker } from '../model/types';
import { applyDeckMove, carryEdgeData, housePolylineFor, insertNotch, isJogEdge, mirrorProject, moveEdgeTo, moveVertexTo, nextStairId, removeJog, samePoly, setEdgeLengthAnchored } from '../utils/shapes';
import { NumInline } from './fields';
import { COLORS, DesignLayers } from './PlanLayers';

interface View {
  ox: number;
  oy: number;
  scale: number; // px per mm
}

type Drag =
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean; tap: boolean }
  | { type: 'edge'; index: number; grab: number; orig: Pt[]; last: Pt[]; sx: number; sy: number; moved: boolean }
  | { type: 'vertex'; index: number; orig: Pt[]; last: Pt[]; sx: number; sy: number; moved: boolean }
  | { type: 'stair'; id: string; grab: number; offset: number; orig: number }
  | { type: 'breaker'; id: string; grab: number; base: BreakerLayout; item: ManualBreaker; span: BreakerSpan; room: [number, number]; centre: number | null; orig: number; last: number; sx: number; sy: number; moved: boolean }
  | { type: 'breakerEnd'; id: string; end: 'from' | 'to'; base: BreakerLayout; pos: number; other: number; orig: number | null; last: number | null; sx: number; sy: number; moved: boolean }
  | { type: 'pinch'; d0: number; scale0: number; mid0: { x: number; y: number }; ox0: number; oy0: number };

type Hover = { type: 'edge'; index: number } | { type: 'vertex'; index: number } | { type: 'stair'; id: string } | { type: 'breaker'; id: string; end?: 'from' | 'to' } | null;
type Dir = 'auto' | 'E' | 'W' | 'N' | 'S';

const MIN_SCALE = 0.004;
const MAX_SCALE = 2.5;
const MemoLayers = memo(DesignLayers);

/** A box the user types into (its blur commits a value). */
function isTextInput(el: Element | null): boolean {
  return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes((el as HTMLInputElement).type)));
}

function snapTo(v: number, s: number): number {
  return Math.round(v / s) * s;
}

function ortho(prev: Pt, p: Pt): Pt {
  return Math.abs(p.x - prev.x) >= Math.abs(p.y - prev.y) ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y };
}

function fmtTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Editable edge length sitting just outside the edge on the plan. */
function DimChip({ x, y, value, house, selected, onChange }: { x: number; y: number; value: number; house: boolean; selected: boolean; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const cancel = useRef(false);
  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      setText(null);
      return;
    }
    if (text === null) return;
    const v = Math.round(parseFloat(text));
    if (Number.isFinite(v) && v !== value) onChange(v);
    setText(null);
  };
  return (
    <input
      className={`dimchip ${house ? 'house' : ''} ${selected ? 'sel' : ''}`}
      style={{ left: x, top: y }}
      value={text ?? String(value)}
      inputMode="numeric"
      aria-label={`${value} mm`}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          cancel.current = true;
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

export function CanvasEditor() {
  const { project, design, ui, setUi, updateProject, undo, redo, canUndo, canRedo, history, historyIndex, jumpTo } = useApp();
  const { t } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lenRef = useRef<HTMLInputElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ ox: -1500, oy: -2500, scale: 0.09 });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [lenText, setLenText] = useState('');
  const [dir, setDir] = useState<Dir>('auto');
  const [toast, setToast] = useState<string | null>(null);
  const [livePoly, setLivePoly] = useState<Pt[] | null>(null);
  const [liveStair, setLiveStair] = useState<{ id: string; offset: number } | null>(null);
  // breakers being dragged: the whole layout is recomputed live (a design takes a few ms)
  const [liveBreakers, setLiveBreakers] = useState<BreakerLayout | null>(null);
  const preview = useMemo(() => (liveBreakers ? computeDesign({ ...project, breakers: liveBreakers }) : null), [liveBreakers, project]);
  const shownDesign = preview && preview.ok ? preview : design;
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [hover, setHover] = useState<Hover>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const shiftRef = useRef(false);
  const touchRef = useRef(false);
  const pinchedRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const toastTimer = useRef<number | null>(null);
  const prevCount = useRef(project.deck.length);
  const viewRef = useRef(view);
  viewRef.current = view;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // drawing surface size (the svg itself, so screen <-> world mapping is exact)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    // frame the deck and its stairs; the house line only when there is no deck yet
    const pts: Pt[] = project.deck.length ? [...project.deck, ...design.stairs.flatMap((s) => s.outline)] : project.house.flat();
    const el = svgRef.current;
    const w = el?.clientWidth || 800;
    const h = el?.clientHeight || 600;
    let minX = 0, minY = 0, maxX = 6000, maxY = 4000;
    if (pts.length) {
      minX = Math.min(...pts.map((p) => p.x));
      maxX = Math.max(...pts.map((p) => p.x));
      minY = Math.min(...pts.map((p) => p.y));
      maxY = Math.max(...pts.map((p) => p.y));
    }
    const margin = Math.max(900, 0.12 * Math.max(maxX - minX, maxY - minY));
    const scale = Math.min(w / (maxX - minX + 2 * margin), h / (maxY - minY + 2 * margin));
    setView({ scale, ox: (minX + maxX) / 2 - w / 2 / scale, oy: (minY + maxY) / 2 - h / 2 / scale });
  }, [project.deck, project.house, design.stairs]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // frame the drawing when a project opens and when an outline first appears, not on every edit
  const projectId = project.id;
  const vertexCount = project.deck.length;
  useEffect(() => {
    fitRef.current();
  }, [projectId]);
  useEffect(() => {
    if (prevCount.current < 4 && vertexCount >= 4) fitRef.current();
    prevCount.current = vertexCount;
  }, [vertexCount]);

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const v = viewRef.current;
    const el = svgRef.current;
    const cx = px ?? (el?.clientWidth ?? 800) / 2;
    const cy = py ?? (el?.clientHeight ?? 600) / 2;
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    const wx = v.ox + cx / v.scale;
    const wy = v.oy + cy / v.scale;
    setView({ scale: ns, ox: wx - cx / ns, oy: wy - cy / ns });
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: v.ox + (clientX - rect.left) / v.scale, y: v.oy + (clientY - rect.top) / v.scale };
  }, []);
  const toScreen = useCallback((p: Pt): { x: number; y: number } => ({ x: (p.x - view.ox) * view.scale, y: (p.y - view.oy) * view.scale }), [view]);

  const snapPt = useCallback(
    (p: Pt): Pt => (shiftRef.current ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: snapTo(p.x, ui.snap), y: snapTo(p.y, ui.snap) }),
    [ui.snap],
  );

  // wheel: trackpad scroll pans, pinch (ctrl) and mouse wheels zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const mouseWheel = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 60 && e.deltaX === 0);
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const factor = Math.exp(-(e.deltaMode === 0 ? e.deltaY : e.deltaY * 30) * (e.ctrlKey || e.metaKey ? 0.01 : 0.0025));
        zoomAt(factor, px, py);
      } else {
        const v = viewRef.current;
        setView({ ...v, ox: v.ox + e.deltaX / v.scale, oy: v.oy + e.deltaY / v.scale });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- outline editing helpers ----
  const applyPolygon = useCallback(
    (poly: Pt[], label: string, resetDependents: boolean) => {
      const norm = normalizePolygon(poly);
      const v = validatePolygon(norm);
      if (!v.ok) return false;
      updateProject((p) => {
        if (resetDependents) {
          return { ...p, deck: norm, houseEdges: detectHouseEdges(norm, p.house), stairs: [], breakers: null, params: { ...p.params, balustrade: { ...p.params.balustrade, edgeOverride: {} } } };
        }
        // with the same corners the edge indices are stable (a length change only translates edges); when
        // corners were inserted or removed, house flags, stairs and balustrade overrides follow their edges by geometry
        return { ...p, deck: norm, ...carryEdgeData(p, norm) };
      }, label);
      return true;
    },
    [updateProject],
  );

  const finishDeck = useCallback(
    (pts: Pt[]) => {
      if (pts.length < 3) {
        showToast(t('polygon.tooFew'));
        return;
      }
      let poly = [...pts];
      const first = poly[0];
      const last = poly[poly.length - 1];
      if (Math.abs(last.x - first.x) > 0.5 && Math.abs(last.y - first.y) > 0.5) {
        const prev = poly[poly.length - 2];
        const lastHorizontal = Math.abs(prev.y - last.y) < 0.5;
        poly.push(lastHorizontal ? { x: last.x, y: first.y } : { x: first.x, y: last.y });
      }
      poly = normalizePolygon(poly);
      const v = validatePolygon(poly);
      if (!v.ok) {
        showToast(t(`polygon.${v.problem}`));
        return;
      }
      applyPolygon(poly, 'h.draw', true);
      setDraft([]);
      setLenText('');
      setDir('auto');
      setUi({ tool: 'select', selection: null });
    },
    [applyPolygon, setUi, showToast, t],
  );

  const finishHouse = useCallback(
    (pts: Pt[]) => {
      if (pts.length >= 2) {
        updateProject((p) => {
          const house = [...p.house, pts];
          const detected = detectHouseEdges(p.deck, house);
          return { ...p, house, houseEdges: [...new Set([...p.houseEdges, ...detected])] };
        }, 'h.house');
      }
      setDraft([]);
      setLenText('');
      setUi({ tool: 'select' });
    },
    [setUi, updateProject],
  );

  const addDraftPoint = useCallback(
    (w: Pt) => {
      const p0 = snapPt(w);
      const p = draft.length ? ortho(draft[draft.length - 1], p0) : p0;
      const tol = (touchRef.current ? 18 : 10) / view.scale;
      if (ui.tool === 'deck' && draft.length >= 3 && dist(p0, draft[0]) < tol) {
        finishDeck(draft);
        return;
      }
      if (draft.length && dist(p, draft[draft.length - 1]) < 1) return;
      setDraft([...draft, p]);
    },
    [draft, finishDeck, snapPt, ui.tool, view.scale],
  );

  const placeByLength = useCallback(() => {
    const L = parseFloat(lenText);
    if (!Number.isFinite(L) || L <= 0) return;
    let base = draft;
    if (!base.length) base = [cursor ? snapPt(cursor) : { x: 0, y: 0 }];
    const last = base[base.length - 1];
    let d: Pt = { x: 1, y: 0 };
    if (dir !== 'auto') d = dir === 'E' ? { x: 1, y: 0 } : dir === 'W' ? { x: -1, y: 0 } : dir === 'N' ? { x: 0, y: -1 } : { x: 0, y: 1 };
    else if (cursor) {
      const dx = cursor.x - last.x;
      const dy = cursor.y - last.y;
      if (Math.abs(dx) >= Math.abs(dy)) d = { x: Math.sign(dx) || 1, y: 0 };
      else d = { x: 0, y: Math.sign(dy) || 1 };
    } else if (base.length >= 2) {
      // no pointer (touch): turn right from the last leg so a rectangle closes clockwise
      const p = base[base.length - 2];
      const lx = Math.sign(last.x - p.x);
      const ly = Math.sign(last.y - p.y);
      d = lx !== 0 ? { x: 0, y: lx } : { x: -ly, y: 0 };
    }
    const next = { x: last.x + d.x * L, y: last.y + d.y * L };
    setDraft([...base, next]);
    setLenText('');
  }, [cursor, dir, draft, lenText, snapPt]);

  // ---- hit testing ----
  const deckEdges = project.deck.length >= 4 ? polyEdges(project.deck) : [];
  const hitTest = useCallback(
    (w: Pt): Hover => {
      const tol = (touchRef.current ? 20 : 9) / viewRef.current.scale;
      const poly = project.deck;
      for (let i = 0; i < poly.length; i++) if (dist(poly[i], w) < tol * 1.3) return { type: 'vertex', index: i };
      for (const s of design.stairs) if (pointInPolygon(w, s.outline)) return { type: 'stair', id: s.id };
      // breakers lie inside the deck: one under the pointer wins over a nearby edge
      const lay = design.ok && ui.layers.boards ? design.layout : undefined;
      if (lay) {
        const ax = lay.boardAxis;
        const wa = alongOf(ax, w);
        const wc = acrossOf(ax, w);
        const half = stripWidth(lay) / 2;
        const selId = ui.selection?.type === 'breaker' ? ui.selection.id : null;
        for (const b of breakerSpans(lay)) {
          if (Math.abs(wa - b.pos) > half + tol * 0.4 || wc < b.c0 - tol * 0.4 || wc > b.c1 + tol * 0.4) continue;
          // the ends of the selected breaker are its length handles
          const endTol = Math.min(tol * 1.6, (b.c1 - b.c0) / 3);
          if (b.id === selId && Math.abs(wc - b.c0) <= endTol) return { type: 'breaker', id: b.id, end: 'from' };
          if (b.id === selId && Math.abs(wc - b.c1) <= endTol) return { type: 'breaker', id: b.id, end: 'to' };
          return { type: 'breaker', id: b.id };
        }
      }
      if (poly.length >= 4) {
        const E = polyEdges(poly);
        let best: { index: number; d: number } | null = null;
        for (const ed of E) {
          const pr = projectOnEdge(ed, w);
          if (!best || pr.d < best.d) best = { index: ed.index, d: pr.d };
        }
        if (best && best.d < tol) return { type: 'edge', index: best.index };
      }
      return null;
    },
    [design.ok, design.layout, design.stairs, project.deck, ui.layers.boards, ui.selection],
  );

  const select = useCallback(
    (selection: NonNullable<UISelection>) => setUi(ui.advanced ? { selection, panelTab: 'selection' } : { selection }),
    [setUi, ui.advanced],
  );

  const addStairOnEdge = useCallback(
    (index: number) => {
      const e = deckEdges[index];
      if (!e) return;
      const width = Math.min(project.params.stairWidth, e.length);
      const id = nextStairId(project.stairs);
      const offset = Math.max(0, Math.round((e.length - width) / 2 / 10) * 10);
      updateProject((p) => ({ ...p, stairs: [...p.stairs, { id, edgeIndex: index, offset, width, groundOffset: 0 }] }), 'h.addStair');
      setUi({ selection: { type: 'stair', id } });
    },
    [deckEdges, project.params.stairWidth, project.stairs, setUi, updateProject],
  );

  // ---- pointer handling ----
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    touchRef.current = e.pointerType === 'touch';
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== lenRef.current && typeof active.blur === 'function') {
      active.blur();
      // a text box commits on blur: let that land before anything else starts
      if (isTextInput(active)) return;
    }
    setHistOpen(false);
    setHelpOpen(false);
    svgRef.current?.setPointerCapture(e.pointerId);
    if (!dragRef.current) pointersRef.current.clear(); // nothing in progress: any remembered pointer is stale
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size > 2) return; // a third finger changes nothing
    if (pointersRef.current.size === 2) {
      // second finger: pinch to zoom, two fingers to pan; whatever the first finger started is dropped
      pinchedRef.current = true;
      const [a, b] = [...pointersRef.current.values()];
      const rect = svgRef.current!.getBoundingClientRect();
      dragRef.current = {
        type: 'pinch',
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale0: viewRef.current.scale,
        mid0: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
        ox0: viewRef.current.ox,
        oy0: viewRef.current.oy,
      };
      setLivePoly(null);
      setLiveStair(null);
      setLiveBreakers(null);
      setGuides({});
      return;
    }
    pinchedRef.current = false;
    const drawing = ui.tool === 'deck' || ui.tool === 'house';
    if (e.button === 1 || ui.tool === 'pan' || spaceRef.current || drawing) {
      // drawing tools place a corner on a tap (pointer up without movement); a drag pans
      dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false, tap: drawing && e.button === 0 };
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
    const hit = hitTest(w);
    if (!hit) {
      setUi({ selection: null });
      // empty space drags the view, like a map
      dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false, tap: false };
      return;
    }
    if (hit.type === 'vertex') {
      select({ type: 'vertex', index: hit.index });
      dragRef.current = { type: 'vertex', index: hit.index, orig: project.deck, last: project.deck, sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }
    if (hit.type === 'stair') {
      const s = design.stairs.find((x) => x.id === hit.id)!;
      const ed = design.edges[s.edgeIndex];
      const pr = projectOnEdge(ed, w);
      select({ type: 'stair', id: s.id });
      dragRef.current = { type: 'stair', id: s.id, grab: pr.t - s.offset, offset: s.offset, orig: s.offset };
      return;
    }
    if (hit.type === 'breaker' && design.layout) {
      const lay = design.layout;
      const span = breakerSpans(lay).find((b) => b.id === hit.id);
      // the automatic layout is frozen into hand-placed breakers once something actually moves
      const base = currentBreakers(project, lay);
      const item = base.items.find((it) => it.id === hit.id);
      select({ type: 'breaker', id: hit.id });
      if (!span || !item) return;
      if (hit.end) {
        const other = hit.end === 'from' ? span.c1 : span.c0;
        const orig = hit.end === 'from' ? item.from : item.to;
        dragRef.current = { type: 'breakerEnd', id: hit.id, end: hit.end, base, pos: item.pos, other, orig, last: orig, sx: e.clientX, sy: e.clientY, moved: false };
        return;
      }
      const band = mainBay(breakerBays(lay, hit.id, span.pos, span.c0, span.c1));
      dragRef.current = {
        type: 'breaker',
        id: hit.id,
        grab: item.pos - alongOf(lay.boardAxis, w),
        base,
        item,
        span,
        room: breakerRoom(lay, hit.id, span.pos, span.c0, span.c1),
        centre: band ? (band.before[0] + band.after[1]) / 2 : null,
        orig: item.pos,
        last: item.pos,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
      };
      return;
    }
    if (hit.type !== 'edge') return;
    const ed = deckEdges[hit.index];
    const grab = ed.axis === 'x' ? ed.a.y - w.y : ed.a.x - w.x;
    select({ type: 'edge', index: hit.index });
    dragRef.current = { type: 'edge', index: hit.index, grab, orig: project.deck, last: project.deck, sx: e.clientX, sy: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    const drawing = ui.tool === 'deck' || ui.tool === 'house';
    if (drawing) setCursor(snapPt(w));
    else if (coordRef.current) coordRef.current.textContent = `${Math.round(w.x)}, ${Math.round(w.y)}`;
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dragRef.current;
    if (!d) {
      if (ui.tool === 'select' && !touchRef.current) {
        const h = hitTest(w);
        const same = h?.type === hover?.type && (h as { index?: number } | null)?.index === (hover as { index?: number } | null)?.index && (h as { id?: string } | null)?.id === (hover as { id?: string } | null)?.id;
        if (!same) setHover(h);
      }
      return;
    }
    if (d.type === 'pinch') {
      if (pointersRef.current.size < 2) return;
      const [a, b] = [...pointersRef.current.values()];
      const rect = svgRef.current!.getBoundingClientRect();
      const dd = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (d.scale0 * dd) / d.d0));
      const wx = d.ox0 + d.mid0.x / d.scale0;
      const wy = d.oy0 + d.mid0.y / d.scale0;
      setView({ scale: ns, ox: wx - mid.x / ns, oy: wy - mid.y / ns });
      return;
    }
    const slop = touchRef.current ? 8 : 4;
    if (d.type === 'pan') {
      if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) <= slop) return;
      d.moved = true;
      setView({ ...viewRef.current, ox: d.ox - (e.clientX - d.sx) / viewRef.current.scale, oy: d.oy - (e.clientY - d.sy) / viewRef.current.scale });
      return;
    }
    if (d.type === 'edge' || d.type === 'vertex' || d.type === 'breaker' || d.type === 'breakerEnd') {
      // a tap must not move anything: wait for real movement before the live preview starts
      if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) <= slop) return;
      d.moved = true;
    }
    if (d.type === 'breaker' && design.layout) {
      const raw = alongOf(design.layout.boardAxis, w) + d.grab;
      let pos = shiftRef.current ? Math.round(raw) : snapTo(raw, 10);
      // the middle of the run is magnetic, so the two board lengths come out equal; so are the ends of the
      // room (hard against the next breaker or the edge), so no sliver of board is left between
      const pull = 12 / viewRef.current.scale;
      if (!shiftRef.current && d.centre !== null && Math.abs(raw - d.centre) < pull) pos = Math.round(d.centre);
      if (!shiftRef.current && Math.abs(raw - d.room[0]) < Math.max(pull, 60)) pos = d.room[0];
      if (!shiftRef.current && Math.abs(raw - d.room[1]) < Math.max(pull, 60)) pos = d.room[1];
      pos = Math.max(d.room[0], Math.min(d.room[1], pos));
      if (pos !== d.last) {
        d.last = pos;
        setLiveBreakers(updateBreaker(d.base, d.id, movedBreaker(design.layout, d.item, d.span, pos)));
      }
      return;
    }
    if (d.type === 'breakerEnd' && design.layout) {
      const v = snapBreakerEnd(design.layout, d.pos, acrossOf(design.layout.boardAxis, w), d.end, d.other);
      if (v !== d.last) {
        d.last = v;
        setLiveBreakers(updateBreaker(d.base, d.id, d.end === 'from' ? { from: v } : { to: v }));
      }
      return;
    }
    if (d.type === 'edge') {
      const ed = polyEdges(d.orig)[d.index];
      const raw = ed.axis === 'x' ? w.y + d.grab : w.x + d.grab;
      const value = shiftRef.current ? Math.round(raw) : snapTo(raw, ui.snap);
      const next = moveEdgeTo(d.orig, d.index, value);
      if (next && !samePoly(next, d.last)) {
        d.last = next;
        setLivePoly(next);
      }
      return;
    }
    if (d.type === 'vertex') {
      let target = snapPt(w);
      // alignment guides: snap to the x / y of other corners
      const tol = 10 / viewRef.current.scale;
      const n = d.orig.length;
      const g: { x?: number; y?: number } = {};
      if (!shiftRef.current) {
        for (let k = 0; k < n; k++) {
          if (k === d.index || k === (d.index + 1) % n || k === (d.index - 1 + n) % n) continue;
          if (g.x === undefined && Math.abs(d.orig[k].x - target.x) < tol) g.x = d.orig[k].x;
          if (g.y === undefined && Math.abs(d.orig[k].y - target.y) < tol) g.y = d.orig[k].y;
        }
        target = { x: g.x ?? target.x, y: g.y ?? target.y };
      }
      setGuides(g);
      const next = moveVertexTo(d.orig, d.index, target);
      if (next && !samePoly(next, d.last)) {
        d.last = next;
        setLivePoly(next);
      }
      return;
    }
    if (d.type === 'stair') {
      const s = project.stairs.find((x) => x.id === d.id);
      if (!s || !design.ok) return;
      const ed = design.edges[s.edgeIndex];
      if (!ed) return;
      const pr = projectOnEdge(ed, w);
      const raw = pr.t - d.grab;
      const offset = Math.max(0, Math.min(ed.length - s.width, shiftRef.current ? Math.round(raw) : snapTo(raw, ui.snap)));
      if (offset !== d.offset) {
        d.offset = offset;
        setLiveStair({ id: d.id, offset });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(e.pointerId);
    const d = dragRef.current;
    if (d?.type === 'pinch') {
      if (pointersRef.current.size < 2) {
        // the pinch is over as soon as one finger lifts; forget the other so a missed
        // pointerup can never turn the next tap into a phantom pinch
        pointersRef.current.clear();
        dragRef.current = null;
      }
      return;
    }
    dragRef.current = null;
    setGuides({});
    if (d?.type === 'pan' && d.tap && !d.moved && !pinchedRef.current) {
      addDraftPoint(toWorld(e.clientX, e.clientY));
    }
    if (d?.type === 'edge' || d?.type === 'vertex') {
      if (d.moved && !samePoly(d.last, d.orig)) {
        const last = d.last;
        const n = d.orig.length;
        // the drawn wall follows a house edge that is moved (a corner moves its two edges)
        const touched = d.type === 'edge' ? [d.index] : [(d.index - 1 + n) % n, d.index];
        updateProject((p) => applyDeckMove(p, last, touched), d.type === 'edge' ? 'h.moveEdge' : 'h.moveVertex');
      }
      setLivePoly(null);
    }
    if (d?.type === 'stair') {
      if (d.offset !== d.orig) {
        const { id, offset } = d;
        updateProject((p) => ({ ...p, stairs: p.stairs.map((x) => (x.id === id ? { ...x, offset } : x)) }), 'h.moveStair');
      }
      setLiveStair(null);
    }
    if (d?.type === 'breaker' || d?.type === 'breakerEnd') {
      if (d.moved && d.last !== d.orig) {
        const next =
          d.type === 'breaker'
            ? design.layout
              ? updateBreaker(d.base, d.id, movedBreaker(design.layout, d.item, d.span, d.last))
              : d.base
            : updateBreaker(d.base, d.id, d.end === 'from' ? { from: d.last } : { to: d.last });
        updateProject((p) => ({ ...p, breakers: next }), d.type === 'breaker' ? 'h.moveBreaker' : 'h.breakerLength');
      }
      setLiveBreakers(null);
    }
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // ---- keyboard (undo / redo live in App so they work on every tab) ----
  useEffect(() => {
    const isEditable = (el: Element | null) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((el as HTMLInputElement).type)) || el.tagName === 'SELECT');
    const nudge = (dx: number, dy: number) => {
      const sel = ui.selection;
      if (!sel || project.deck.length < 4) return false;
      if (sel.type === 'edge') {
        const ed = polyEdges(project.deck)[sel.index];
        if (!ed) return false;
        const cur = ed.axis === 'x' ? ed.a.y : ed.a.x;
        const next = moveEdgeTo(project.deck, sel.index, cur + (ed.axis === 'x' ? dy : dx));
        const index = sel.index;
        if (next) updateProject((p) => applyDeckMove(p, next, [index]), 'h.nudge');
        return true;
      }
      if (sel.type === 'vertex') {
        const v = project.deck[sel.index];
        const next = moveVertexTo(project.deck, sel.index, { x: v.x + dx, y: v.y + dy });
        const n = project.deck.length;
        const touched = [(sel.index - 1 + n) % n, sel.index];
        if (next) updateProject((p) => applyDeckMove(p, next, touched), 'h.nudge');
        return true;
      }
      if (sel.type === 'breaker' && design.layout) {
        const lay = design.layout;
        const step = lay.boardAxis === 'x' ? dx : dy;
        const span = breakerSpans(lay).find((b) => b.id === sel.id);
        if (!step || !span) return false;
        const room = breakerRoom(lay, sel.id, span.pos, span.c0, span.c1);
        const pos = Math.max(room[0], Math.min(room[1], span.pos + step / 5));
        if (pos !== span.pos)
          updateProject((p) => {
            const base = currentBreakers(p, lay);
            const item = base.items.find((it) => it.id === sel.id);
            return item ? { ...p, breakers: updateBreaker(base, sel.id, movedBreaker(lay, item, span, pos)) } : p;
          }, 'h.moveBreaker');
        return true;
      }
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftRef.current = true;
      const editable = isEditable(document.activeElement);
      const inLen = document.activeElement === lenRef.current;
      const meta = e.ctrlKey || e.metaKey;
      if (meta) return;
      if (e.key === ' ' && !editable) {
        spaceRef.current = true;
        e.preventDefault();
        return;
      }
      if (inLen || editable) return; // the length box handles its own keys
      if (e.key === 'Escape') {
        if (draft.length) {
          setDraft([]);
          setLenText('');
        } else setUi({ selection: null, tool: ui.drawMode ? ui.tool : 'select' });
        setHistOpen(false);
        setHelpOpen(false);
        return;
      }
      if (e.key === 'Enter') {
        if (ui.tool === 'deck' && draft.length) finishDeck(draft);
        else if (ui.tool === 'house' && draft.length) finishHouse(draft);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (draft.length) {
          e.preventDefault();
          setDraft(draft.slice(0, -1));
        } else if (ui.selection?.type === 'stair') {
          const id = ui.selection.id;
          updateProject((p) => ({ ...p, stairs: p.stairs.filter((s) => s.id !== id) }), 'h.deleteStair');
          setUi({ selection: null });
        } else if (ui.selection?.type === 'breaker' && design.layout) {
          const id = ui.selection.id;
          const lay = design.layout;
          updateProject((p) => ({ ...p, breakers: removeBreaker(currentBreakers(p, lay), id) }), 'h.deleteBreaker');
          setUi({ selection: null });
        }
        return;
      }
      if (e.key.startsWith('Arrow')) {
        const step = (e.shiftKey ? 5 : 1) * ui.snap;
        const moved = nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
        if (moved) e.preventDefault();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        fit();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        zoomAt(1.25);
        return;
      }
      if (e.key === '-') {
        zoomAt(0.8);
        return;
      }
      if ((ui.tool === 'deck' || ui.tool === 'house') && /^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        setLenText((s) => s + e.key);
        lenRef.current?.focus();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceRef.current = false;
      if (e.key === 'Shift') shiftRef.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [design.layout, draft, finishDeck, finishHouse, fit, project.deck, setUi, ui.drawMode, ui.selection, ui.snap, ui.tool, updateProject, zoomAt]);

  // reset the draft when leaving the drawing tools
  useEffect(() => {
    if (ui.tool !== 'deck' && ui.tool !== 'house') {
      setDraft([]);
      setLenText('');
      setDir('auto');
    }
  }, [ui.tool]);

  // ---- derived for rendering ----
  const vb = `${view.ox} ${view.oy} ${size.w / view.scale} ${size.h / view.scale}`;
  const fs = 12 / view.scale;
  const sw = 1 / view.scale;
  const x0 = view.ox;
  const y0 = view.oy;
  const x1 = view.ox + size.w / view.scale;
  const y1 = view.oy + size.h / view.scale;
  const gridLines: JSX.Element[] = [];
  const minorStep = view.scale > 0.045 ? 100 : view.scale > 0.012 ? 500 : 1000;
  const majorStep = minorStep * (minorStep === 100 ? 10 : minorStep === 500 ? 2 : 5);
  for (let gx = Math.floor(x0 / minorStep) * minorStep; gx <= x1; gx += minorStep) {
    const major = Math.abs(gx % majorStep) < 0.5;
    gridLines.push(<line key={`gx${gx}`} x1={gx} y1={y0} x2={gx} y2={y1} stroke={major ? COLORS.gridMajor : COLORS.grid} strokeWidth={sw * (major ? 1 : 0.5)} />);
  }
  for (let gy = Math.floor(y0 / minorStep) * minorStep; gy <= y1; gy += minorStep) {
    const major = Math.abs(gy % majorStep) < 0.5;
    gridLines.push(<line key={`gy${gy}`} x1={x0} y1={gy} x2={x1} y2={gy} stroke={major ? COLORS.gridMajor : COLORS.grid} strokeWidth={sw * (major ? 1 : 0.5)} />);
  }

  const sel = ui.selection;
  const svgTop = svgRef.current && wrapRef.current ? svgRef.current.getBoundingClientRect().top - wrapRef.current.getBoundingClientRect().top : 0;
  const previewPt = cursor && draft.length ? ortho(draft[draft.length - 1], cursor) : cursor;
  const previewLen = previewPt && draft.length ? dist(draft[draft.length - 1], previewPt) : 0;
  const dragging = !!livePoly;
  const shownPoly = livePoly ?? project.deck;
  const liveEdges = livePoly ? polyEdges(livePoly) : [];
  const selectedStair = sel?.type === 'stair' ? project.stairs.find((st) => st.id === sel.id) : undefined;
  // the selected breaker, as shown (the live preview while it is dragged)
  const shownLay: LayoutResult | undefined = shownDesign.ok && shownDesign.layout ? shownDesign.layout : undefined;
  const brkSpans: BreakerSpan[] = shownLay ? breakerSpans(shownLay) : [];
  const selBrk = sel?.type === 'breaker' ? brkSpans.find((b) => b.id === sel.id) : undefined;
  const selBands = shownLay && selBrk ? breakerBays(shownLay, selBrk.id, selBrk.pos, selBrk.c0, selBrk.c1) : [];
  const selMain = mainBay(selBands);
  const hoverBrk = hover?.type === 'breaker' ? brkSpans.find((b) => b.id === hover.id) : undefined;
  const brkRect = (lay: LayoutResult, b: BreakerSpan) => {
    const half = lay.boardWidth / 2;
    return lay.boardAxis === 'x' ? { x: b.pos - half, y: b.c0, w: 2 * half, h: b.c1 - b.c0 } : { x: b.c0, y: b.pos - half, w: b.c1 - b.c0, h: 2 * half };
  };
  const brkPt = (lay: LayoutResult, a: number, c: number): Pt => (lay.boardAxis === 'x' ? { x: a, y: c } : { x: c, y: a });
  const selectedEdge = sel?.type === 'edge' ? deckEdges[sel.index] : undefined;
  const selectedIsHouse = sel?.type === 'edge' ? project.houseEdges.includes(sel.index) : false;
  const layerFlags = useMemo(
    () => ({
      house: ui.layers.house,
      frame: ui.layers.frame && design.ok,
      boards: ui.layers.boards && design.ok,
      posts: ui.layers.posts && design.ok,
      balustrade: ui.layers.balustrade && design.ok,
      dims: ui.layers.dims && design.ok,
      postLabels: view.scale > 0.05,
      bearerLabels: view.scale > 0.04,
      joins: view.scale > 0.05,
      labels: ui.drawMode || !design.ok,
    }),
    [ui.layers, design.ok, view.scale, ui.drawMode],
  );

  const tools: { id: Tool; label: string; icon: string }[] = [
    { id: 'select', label: t('tool.select'), icon: '⬚' },
    { id: 'deck', label: t('tool.deck'), icon: '✎' },
    { id: 'house', label: t('tool.house'), icon: '⌂' },
    { id: 'pan', label: t('tool.pan'), icon: '✋' },
  ];

  const hint =
    ui.tool === 'deck' ? (draft.length ? t('status.hintDeck') : t('canvas.firstPoint'))
    : ui.tool === 'house' ? t('status.hintHouse')
    : ui.tool === 'pan' ? t('tool.pan')
    : ui.drawMode && project.deck.length >= 4 ? t('canvas.editExisting')
    : sel?.type === 'breaker' ? t('status.hintBreaker')
    : t('status.hintSelect');
  const brkAxis = design.layout?.boardAxis ?? 'x';
  const cursorStyle =
    ui.tool === 'pan' || spaceRef.current ? 'grab'
    : ui.tool !== 'select' ? 'crosshair'
    : hover?.type === 'edge' ? (deckEdges[hover.index]?.axis === 'x' ? 'ns-resize' : 'ew-resize')
    : hover?.type === 'vertex' ? 'move'
    : hover?.type === 'stair' ? 'grab'
    : hover?.type === 'breaker' ? (hover.end ? (brkAxis === 'x' ? 'ns-resize' : 'ew-resize') : brkAxis === 'x' ? 'ew-resize' : 'ns-resize')
    : 'default';
  const lenAnchor = draft.length ? toScreen(draft[draft.length - 1]) : null;
  const zoomPct = Math.round(view.scale * 1000) / 10;

  const enterDraw = () => setUi({ drawMode: true, tool: project.deck.length >= 4 ? 'select' : 'deck', selection: null });
  const redraw = () => {
    if (project.deck.length && !window.confirm(t('tool.clearDeck') + '?')) return;
    updateProject((p) => ({ ...p, deck: [], houseEdges: [], stairs: [], breakers: null }), 'h.clear');
    setUi({ tool: 'deck', selection: null, drawMode: true });
  };
  const finishDrawing = () => {
    if (draft.length >= 3 && ui.tool === 'deck') {
      finishDeck(draft);
      setUi({ drawMode: false, tool: 'select' });
      return;
    }
    if (draft.length >= 2 && ui.tool === 'house') finishHouse(draft);
    setDraft([]);
    setLenText('');
    setUi({ drawMode: false, tool: 'select' });
  };
  const notchWidth = selectedEdge ? Math.max(600, Math.min(1200, Math.round(selectedEdge.length / 3 / 100) * 100)) : 0;
  const addNotch = (outward: boolean) => {
    if (!selectedEdge || sel?.type !== 'edge') return;
    const next = insertNotch(project.deck, sel.index, notchWidth, 600, outward);
    if (next) applyPolygon(next, 'h.notch', false);
    else showToast(t('polygon.selfIntersect'));
  };
  const historyMenu = (
    <div className="dd hist">
      <button className={`tool ${histOpen ? 'active' : ''}`} onClick={() => setHistOpen((o) => !o)} aria-expanded={histOpen}>
        {t('hist.title')} ▾
      </button>
      {histOpen && (
        <div className="dd-menu hist-menu" role="listbox">
          {history.length <= 1 && <div className="muted small">{t('hist.empty')}</div>}
          {history
            .map((h, i) => ({ ...h, i }))
            .reverse()
            .map((h) => (
              <button key={h.i} className={`hist-item ${h.i === historyIndex ? 'current' : ''} ${h.i > historyIndex ? 'future' : ''}`} onClick={() => { jumpTo(h.i); setHistOpen(false); }} role="option" aria-selected={h.i === historyIndex}>
                <span className="hist-label">{t(h.label)}</span>
                <span className="hist-time">{h.i === historyIndex ? t('hist.current') : fmtTime(h.at)}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div className="toolbar">
        {ui.drawMode ? (
          <>
            {tools.map((tl) => (
              <button key={tl.id} className={`tool ${ui.tool === tl.id ? 'active' : ''} ${tl.id === 'pan' ? 'phone-hide' : ''}`} title={tl.label} onClick={() => setUi({ tool: tl.id, selection: null })}>
                <span className="icon">{tl.icon}</span>
                <span>{tl.label}</span>
              </button>
            ))}
            <span className="sep" />
            <button className="tool" onClick={() => setDraft(draft.slice(0, -1))} disabled={!draft.length} title="Backspace">
              ⌫ {t('canvas.backPoint')}
            </button>
            <button className="tool" onClick={undo} disabled={!canUndo} title={`${t('hist.undo')} (Ctrl+Z)`}>
              ↶
            </button>
            <button className="tool" onClick={redo} disabled={!canRedo} title={`${t('hist.redo')} (Ctrl+Shift+Z)`}>
              ↷
            </button>
            <label className="inline phone-hide">
              {t('tool.snap')}
              <select value={ui.snap} onChange={(e) => setUi({ snap: Number(e.target.value) })}>
                {[10, 25, 50, 100].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button className="tool danger" onClick={redraw}>
              {t('canvas.redraw')}
            </button>
            <button className="tool phone-hide" onClick={() => updateProject((p) => ({ ...p, house: [] }), 'h.house')} disabled={!project.house.length}>
              {t('tool.clearHouse')}
            </button>
            <span className="grow" />
            <button className="tool primary" onClick={finishDrawing}>
              ✓ {t('canvas.finish')}
            </button>
          </>
        ) : (
          <>
            <span className="layers">
              {(['frame', 'boards', 'posts', 'balustrade', 'dims', 'house'] as const).map((k) => (
                <button key={k} type="button" className={`pill ${ui.layers[k] ? 'on' : ''}`} onClick={() => setUi({ layers: { ...ui.layers, [k]: !ui.layers[k] } })} aria-pressed={ui.layers[k]}>
                  {t(`layer.${k}`)}
                </button>
              ))}
            </span>
            <span className="sep" />
            <button className="tool" onClick={undo} disabled={!canUndo} title={`${t('hist.undo')} (Ctrl+Z)`}>
              ↶ {t('hist.undo')}
            </button>
            <button className="tool" onClick={redo} disabled={!canRedo} title={`${t('hist.redo')} (Ctrl+Shift+Z)`}>
              ↷ {t('hist.redo')}
            </button>
            {historyMenu}
            <span className="grow" />
            <button className="tool" onClick={enterDraw}>
              ✎ {t('g.shape.custom')}
            </button>
          </>
        )}
      </div>

      <svg
        ref={svgRef}
        className={`canvas tool-${ui.tool}`}
        style={{ cursor: cursorStyle }}
        viewBox={vb}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          setCursor(null);
          setHover(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g>{gridLines}</g>
        <line x1={x0} y1={0} x2={x1} y2={0} stroke="#94a3b8" strokeWidth={sw * 1.5} />
        <line x1={0} y1={y0} x2={0} y2={y1} stroke="#94a3b8" strokeWidth={sw * 1.5} />

        {project.deck.length >= 4 && !dragging && <MemoLayers project={project} design={shownDesign} layers={layerFlags} fs={fs} sw={sw} />}
        {dragging && (
          <g>
            {ui.layers.house &&
              project.house.map((pl, i) => <polyline key={i} points={pl.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={COLORS.house} strokeWidth={sw * 6} strokeDasharray={`${sw * 24} ${sw * 10}`} opacity={0.6} />)}
            <path d={`M${shownPoly.map((p) => `${p.x},${p.y}`).join('L')}Z`} fill={COLORS.deckFill} stroke={COLORS.deckStroke} strokeWidth={sw * 2} />
            {liveEdges.map((e) => {
              const off = fs * 1.3;
              const mx = (e.a.x + e.b.x) / 2 + e.outward.x * off;
              const my = (e.a.y + e.b.y) / 2 + e.outward.y * off;
              return (
                <text key={e.index} x={mx} y={my + fs * 0.35} fontSize={fs} fill={COLORS.dim} fontWeight={700} textAnchor="middle" style={{ paintOrder: 'stroke' }} stroke="#fff" strokeWidth={sw * 3} transform={e.axis === 'y' ? `rotate(-90 ${mx} ${my})` : undefined}>
                  {Math.round(e.length)}
                </text>
              );
            })}
          </g>
        )}
        {project.deck.length < 4 && ui.layers.house &&
          project.house.map((pl, i) => <polyline key={i} points={pl.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={COLORS.house} strokeWidth={sw * 6} strokeDasharray={`${sw * 24} ${sw * 10}`} />)}

        {/* alignment guides while dragging a corner */}
        {guides.x !== undefined && <line x1={guides.x} y1={y0} x2={guides.x} y2={y1} stroke="#e11d48" strokeWidth={sw} strokeDasharray={`${sw * 6} ${sw * 4}`} />}
        {guides.y !== undefined && <line x1={x0} y1={guides.y} x2={x1} y2={guides.y} stroke="#e11d48" strokeWidth={sw} strokeDasharray={`${sw * 6} ${sw * 4}`} />}

        {/* stair ghost while dragging */}
        {liveStair && design.ok &&
          (() => {
            const s = design.stairs.find((x) => x.id === liveStair.id);
            if (!s) return null;
            const ed = design.edges[s.edgeIndex];
            const dx = ed.dir.x * (liveStair.offset - s.offset);
            const dy = ed.dir.y * (liveStair.offset - s.offset);
            return <polygon points={s.outline.map((p) => `${p.x + dx},${p.y + dy}`).join(' ')} fill="rgba(245,158,11,.25)" stroke={COLORS.select} strokeWidth={sw * 2} />;
          })()}

        {/* breakers: hover, selection, length handles and the board lengths either side */}
        {!dragging && shownLay && hoverBrk && hoverBrk.id !== selBrk?.id && (() => {
          const r = brkRect(shownLay, hoverBrk);
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(245,158,11,.18)" stroke={COLORS.select} strokeWidth={sw * 1.5} />;
        })()}
        {!dragging && shownLay && selBrk && (
          <g>
            {brkSpans
              .filter((b) => b.id === selBrk.id)
              .map((b, i) => {
                const r = brkRect(shownLay, b);
                return <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(245,158,11,.25)" stroke={COLORS.select} strokeWidth={sw * 2.5} />;
              })}
            {selBands.map((band, i) => {
              const tick = fs * 0.5;
              return (
                <g key={`bay${i}`}>
                  {([band.before, band.after] as [number, number][]).map(([a0, a1], k) => {
                    if (a1 - a0 < 1) return null;
                    const p0 = brkPt(shownLay, a0, band.c);
                    const p1 = brkPt(shownLay, a1, band.c);
                    const m = brkPt(shownLay, (a0 + a1) / 2, band.c);
                    const vertical = shownLay.boardAxis === 'y';
                    const t0 = vertical ? { x: tick, y: 0 } : { x: 0, y: tick };
                    return (
                      <g key={k}>
                        <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#1d4ed8" strokeWidth={sw * 1.5} />
                        <line x1={p0.x - t0.x} y1={p0.y - t0.y} x2={p0.x + t0.x} y2={p0.y + t0.y} stroke="#1d4ed8" strokeWidth={sw * 1.5} />
                        <line x1={p1.x - t0.x} y1={p1.y - t0.y} x2={p1.x + t0.x} y2={p1.y + t0.y} stroke="#1d4ed8" strokeWidth={sw * 1.5} />
                        <text x={m.x} y={m.y - fs * 0.45} fontSize={fs * 1.05} fontWeight={700} fill="#1d4ed8" textAnchor="middle" style={{ paintOrder: 'stroke' }} stroke="#fff" strokeWidth={sw * 3.5} transform={vertical ? `rotate(-90 ${m.x} ${m.y})` : undefined}>
                          {Math.round(a1 - a0)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {(['from', 'to'] as const).map((end) => {
              const p = brkPt(shownLay, selBrk.pos, end === 'from' ? selBrk.c0 : selBrk.c1);
              const hot = hover?.type === 'breaker' && hover.id === selBrk.id && hover.end === end;
              return <circle key={end} cx={p.x} cy={p.y} r={(hot ? 8 : 6) / view.scale} fill={hot ? COLORS.select : '#fff'} stroke={COLORS.select} strokeWidth={sw * 2} />;
            })}
          </g>
        )}

        {/* hover + selection overlays */}
        {!dragging && hover?.type === 'edge' && deckEdges[hover.index] && !(sel?.type === 'edge' && sel.index === hover.index) && (
          <line x1={deckEdges[hover.index].a.x} y1={deckEdges[hover.index].a.y} x2={deckEdges[hover.index].b.x} y2={deckEdges[hover.index].b.y} stroke={COLORS.select} strokeWidth={sw * 6} opacity={0.35} />
        )}
        {!dragging && sel?.type === 'edge' && deckEdges[sel.index] && (
          <line x1={deckEdges[sel.index].a.x} y1={deckEdges[sel.index].a.y} x2={deckEdges[sel.index].b.x} y2={deckEdges[sel.index].b.y} stroke={COLORS.select} strokeWidth={sw * 6} opacity={0.8} />
        )}
        {!dragging && sel?.type === 'stair' && design.stairs.find((s) => s.id === sel.id) && !liveStair && (
          <polygon points={design.stairs.find((s) => s.id === sel.id)!.outline.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={COLORS.select} strokeWidth={sw * 4} />
        )}
        {ui.tool === 'select' &&
          shownPoly.map((p, i) => {
            const isSel = sel?.type === 'vertex' && sel.index === i;
            const isHover = hover?.type === 'vertex' && hover.index === i;
            const r = (isSel || isHover ? 7 : 5) / view.scale;
            return <circle key={`v${i}`} cx={p.x} cy={p.y} r={r} fill={isSel ? COLORS.select : '#fff'} stroke={isHover || isSel ? COLORS.select : '#111'} strokeWidth={sw * (isHover ? 2 : 1.2)} />;
          })}

        {/* draft */}
        {draft.length > 0 && (
          <g>
            <polyline points={draft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#111" strokeWidth={sw * 2} />
            {previewPt && (
              <>
                <line x1={draft[draft.length - 1].x} y1={draft[draft.length - 1].y} x2={previewPt.x} y2={previewPt.y} stroke="#111" strokeWidth={sw * 1.5} strokeDasharray={`${sw * 8} ${sw * 6}`} />
                <text x={(draft[draft.length - 1].x + previewPt.x) / 2} y={(draft[draft.length - 1].y + previewPt.y) / 2 - fs * 0.5} fontSize={fs} fill="#111" textAnchor="middle" fontWeight={600} style={{ paintOrder: 'stroke' }} stroke="#fff" strokeWidth={sw * 3}>
                  {Math.round(previewLen)}
                </text>
              </>
            )}
            {draft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 7 : 4) / view.scale} fill={i === 0 ? COLORS.select : '#111'} />
            ))}
            {draft.map((p, i) =>
              i > 0 ? (
                <text key={`dl${i}`} x={(p.x + draft[i - 1].x) / 2} y={(p.y + draft[i - 1].y) / 2 - fs * 0.5} fontSize={fs * 0.9} fill={COLORS.dim} textAnchor="middle" fontWeight={600} style={{ paintOrder: 'stroke' }} stroke="#fff" strokeWidth={sw * 3}>
                  {Math.round(dist(p, draft[i - 1]))}
                </text>
              ) : null,
            )}
          </g>
        )}
        {cursor && (ui.tool === 'deck' || ui.tool === 'house') && (
          <g>
            <line x1={(previewPt ?? cursor).x - fs} y1={(previewPt ?? cursor).y} x2={(previewPt ?? cursor).x + fs} y2={(previewPt ?? cursor).y} stroke="#111" strokeWidth={sw} />
            <line x1={(previewPt ?? cursor).x} y1={(previewPt ?? cursor).y - fs} x2={(previewPt ?? cursor).x} y2={(previewPt ?? cursor).y + fs} stroke="#111" strokeWidth={sw} />
          </g>
        )}
      </svg>

      {/* floating length entry while drawing */}
      {(ui.tool === 'deck' || ui.tool === 'house') && (
        <div className="len-float" style={lenAnchor ? { left: Math.min(size.w - 250, Math.max(8, lenAnchor.x + 16)), top: Math.min(size.h - 20, Math.max(8, lenAnchor.y - 46)) + svgTop } : { left: 12, top: svgTop + 12 }}>
          <input
            ref={lenRef}
            value={lenText}
            inputMode="numeric"
            onChange={(e) => setLenText(e.target.value.replace(/[^0-9.]/g, ''))}
            onKeyDown={(e) => {
              // the box owns its keys (the canvas never sees them): Enter places the leg, Escape clears
              // the number only, arrows pick the direction of the next leg
              e.stopPropagation();
              const dirs: Record<string, Dir> = { ArrowLeft: 'W', ArrowRight: 'E', ArrowUp: 'N', ArrowDown: 'S' };
              if (dirs[e.key]) {
                e.preventDefault();
                setDir(dirs[e.key]);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (lenText.trim()) placeByLength();
                else if (ui.tool === 'deck') finishDeck(draft);
                else finishHouse(draft);
              } else if (e.key === 'Escape') {
                setLenText('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={t('canvas.lengthNext')}
          />
          <span className="dirs" role="group" aria-label={t('canvas.direction')}>
            {([['W', '←'], ['N', '↑'], ['S', '↓'], ['E', '→']] as [Dir, string][]).map(([d, g]) => (
              <button key={d} type="button" className={dir === d ? 'on' : ''} onClick={() => { setDir(d); lenRef.current?.focus(); }} aria-label={d}>
                {g}
              </button>
            ))}
          </span>
          <span>↵</span>
        </div>
      )}

      {!ui.drawMode && !dragging && design.ok &&
        deckEdges.map((e) => {
          if (e.length < 250 || e.length * view.scale < 70) return null;
          const off = 42 / view.scale;
          const wx = (e.a.x + e.b.x) / 2 + e.outward.x * off;
          const wy = (e.a.y + e.b.y) / 2 + e.outward.y * off;
          const sx = (wx - view.ox) * view.scale;
          const sy = (wy - view.oy) * view.scale;
          if (sx < 24 || sy < 16 || sx > size.w - 24 || sy > size.h - 16) return null;
          return (
            <DimChip
              key={`dc${e.index}`}
              x={sx}
              y={sy + svgTop}
              value={Math.round(e.length)}
              house={project.houseEdges.includes(e.index)}
              selected={sel?.type === 'edge' && sel.index === e.index}
              onChange={(L) => {
                const next = setEdgeLengthAnchored(project.deck, e.index, L, project.houseEdges);
                if (!next || !applyPolygon(next, 'h.edgeLength', false)) showToast(t('polygon.selfIntersect'));
              }}
            />
          );
        })}

      {!ui.drawMode && !dragging && selectedEdge && sel?.type === 'edge' && (
        <div className="edgebar">
          <span>{t('canvas.edge', { n: sel.index + 1, len: Math.round(selectedEdge.length) })}</span>
          <label className="chk">
            <input
              type="checkbox"
              checked={selectedIsHouse}
              onChange={(ev) => {
                const i = sel.index;
                const on = ev.target.checked;
                updateProject(
                  (p) => ({
                    ...p,
                    houseEdges: on ? [...new Set([...p.houseEdges, i])] : p.houseEdges.filter((x) => x !== i),
                    house: on && !p.house.length ? [housePolylineFor(p.deck, i)] : p.house,
                    stairs: on ? p.stairs.filter((st) => st.edgeIndex !== i) : p.stairs,
                  }),
                  'h.house',
                );
              }}
            />
            {t('canvas.house')}
          </label>
          {!selectedIsHouse && (
            <button className="tool" onClick={() => addStairOnEdge(sel.index)}>
              {t('canvas.addStair')}
            </button>
          )}
          {!selectedIsHouse && selectedEdge.length >= 1400 && (
            <>
              <button className="tool" onClick={() => addNotch(false)}>
                {t('canvas.notchIn')}
              </button>
              <button className="tool" onClick={() => addNotch(true)}>
                {t('canvas.notchOut')}
              </button>
            </>
          )}
          {isJogEdge(project.deck, sel.index) && (
            <button
              className="tool"
              onClick={() => {
                const next = removeJog(project.deck, sel.index);
                if (next) {
                  applyPolygon(next, 'h.removeNotch', false);
                  setUi({ selection: null });
                }
              }}
            >
              {t('canvas.removeNotch')}
            </button>
          )}
          <button className="tool" onClick={() => updateProject((p) => mirrorProject(p), 'h.mirror')}>
            {t('canvas.mirror')}
          </button>
        </div>
      )}
      {!ui.drawMode && !dragging && sel?.type === 'vertex' && project.deck[sel.index] && (
        <div className="edgebar">
          <span>{t('canvas.vertex', { n: sel.index + 1 })}</span>
          <span className="muted">
            {Math.round(project.deck[sel.index].x)}, {Math.round(project.deck[sel.index].y)}
          </span>
          <span className="muted small">{t('sc.nudge')}</span>
        </div>
      )}
      {!ui.drawMode && selectedStair && sel?.type === 'stair' && (
        <div className="edgebar">
          <span>{t('canvas.stair', { id: sel.id })}</span>
          <label className="inline">
            {t('canvas.width')}
            <NumInline value={selectedStair.width} step={50} min={300} onCommit={(w) => updateProject((p) => ({ ...p, stairs: p.stairs.map((st) => (st.id === sel.id ? { ...st, width: Math.max(300, w) } : st)) }), 'h.stairs')} />
          </label>
          <label className="inline">
            {t('canvas.rise')}
            <NumInline
              value={Math.round(selectedStair.rise ?? project.params.deckHeight - selectedStair.groundOffset)}
              step={10}
              min={100}
              onCommit={(rise) => updateProject((p) => ({ ...p, stairs: p.stairs.map((st) => (st.id === sel.id ? { ...st, rise: Math.max(100, rise), groundOffset: 0 } : st)) }), 'h.stairs')}
            />
          </label>
          <button
            className="tool danger"
            onClick={() => {
              updateProject((p) => ({ ...p, stairs: p.stairs.filter((st) => st.id !== sel.id) }), 'h.deleteStair');
              setUi({ selection: null });
            }}
          >
            {t('canvas.delete')}
          </button>
        </div>
      )}
      {!ui.drawMode && !dragging && !liveBreakers && selBrk && design.layout && (() => {
        const lay = design.layout;
        const id = selBrk.id;
        const half = stripWidth(lay) / 2;
        const item = currentBreakers(project, lay).items.find((it) => it.id === id);
        const commitPos = (target: number) => {
          const room = breakerRoom(lay, id, selBrk.pos, selBrk.c0, selBrk.c1);
          const pos = Math.round(Math.max(room[0], Math.min(room[1], target)));
          if (pos !== Math.round(selBrk.pos))
            updateProject((p) => {
              const base = currentBreakers(p, lay);
              const it = base.items.find((x) => x.id === id);
              return it ? { ...p, breakers: updateBreaker(base, id, movedBreaker(lay, it, selBrk, pos)) } : p;
            }, 'h.moveBreaker');
          else if (Math.round(target) !== pos) showToast(t('canvas.breakerNoRoom'));
        };
        const vertical = lay.boardAxis === 'x';
        return (
          <div className="edgebar">
            <span>{t('canvas.breaker', { id, len: Math.round(selBrk.c1 - selBrk.c0) })}</span>
            {selMain && (
              <>
                <label className="inline">
                  {t(vertical ? 'canvas.bayLeft' : 'canvas.bayUp')}
                  <NumInline value={Math.max(0, Math.round(selMain.before[1] - selMain.before[0]))} step={10} min={0} onCommit={(v) => commitPos(selMain.before[0] + v + half)} />
                </label>
                <label className="inline">
                  {t(vertical ? 'canvas.bayRight' : 'canvas.bayDown')}
                  <NumInline value={Math.max(0, Math.round(selMain.after[1] - selMain.after[0]))} step={10} min={0} onCommit={(v) => commitPos(selMain.after[1] - v - half)} />
                </label>
                <button className="tool" onClick={() => commitPos((selMain.before[0] + selMain.after[1]) / 2)}>
                  {t('canvas.center')}
                </button>
              </>
            )}
            {item && (item.from !== null || item.to !== null) && (
              <button className="tool" onClick={() => updateProject((p) => ({ ...p, breakers: updateBreaker(currentBreakers(p, lay), id, { from: null, to: null }) }), 'h.breakerLength')}>
                {t('canvas.extend')}
              </button>
            )}
            <button
              className="tool danger"
              onClick={() => {
                updateProject((p) => ({ ...p, breakers: removeBreaker(currentBreakers(p, lay), id) }), 'h.deleteBreaker');
                setUi({ selection: null });
              }}
            >
              {t('canvas.delete')}
            </button>
            {lay.breakerMode === 'manual' && (
              <button
                className="tool"
                onClick={() => {
                  updateProject((p) => ({ ...p, breakers: null }), 'h.breakerAuto');
                  setUi({ selection: null });
                }}
              >
                {t('canvas.autoBreakers')}
              </button>
            )}
          </div>
        );
      })()}
      {project.deck.length < 4 && !ui.drawMode && !draft.length && <div className="canvas-empty">{t('canvas.empty')}</div>}

      <div className="zoomctl">
        <button onClick={() => zoomAt(0.8)} title={t('canvas.zoomOut')} aria-label={t('canvas.zoomOut')}>
          −
        </button>
        <button onClick={fit} title={t('tool.fit')} className="pct">
          {zoomPct}%
        </button>
        <button onClick={() => zoomAt(1.25)} title={t('canvas.zoomIn')} aria-label={t('canvas.zoomIn')}>
          +
        </button>
        <button onClick={fit} title={t('tool.fit')} aria-label={t('tool.fit')}>
          ⤢
        </button>
      </div>

      <div className="statusbar">
        <span ref={coordRef} className="coords">
          {cursor ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)}` : '-'}
        </span>
        <span className="area">
          {t('status.area')}: {design.ok ? `${design.areaM2.toFixed(2)} m²` : '-'}
        </span>
        <span className="hint" title={project.deck.length < 4 && !draft.length && !ui.drawMode ? t('canvas.empty') : hint}>
          {project.deck.length < 4 && !draft.length && !ui.drawMode ? t('canvas.empty') : hint}
        </span>
        <div className="dd help">
          <button className="linkish" onClick={() => setHelpOpen((o) => !o)} aria-expanded={helpOpen}>
            {t('canvas.shortcuts')}
          </button>
          {helpOpen && (
            <div className="dd-menu help-menu">
              {['sc.undo', 'sc.nudge', 'sc.breaker', 'sc.zoom', 'sc.snap', 'sc.delete', 'sc.draw'].map((k) => (
                <div key={k}>{t(k)}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
