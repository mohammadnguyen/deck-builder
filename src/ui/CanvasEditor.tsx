import { useCallback, useEffect, useRef, useState } from 'react';
import { detectHouseEdges, dist, edges as polyEdges, normalizePolygon, pointInPolygon, projectOnEdge, validatePolygon } from '../engine/geometry';
import { useT } from '../i18n';
import type { Pt, Stair } from '../model/types';
import { useApp, type Tool } from '../state';
import { COLORS, DesignLayers } from './PlanLayers';

interface View {
  ox: number;
  oy: number;
  scale: number; // px per mm
}

type Drag =
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { type: 'edge'; index: number; grab: number; orig: Pt[] }
  | { type: 'vertex'; index: number; orig: Pt[] }
  | { type: 'stair'; id: string; grab: number };

function snapTo(v: number, s: number): number {
  return Math.round(v / s) * s;
}

function ortho(prev: Pt, p: Pt): Pt {
  return Math.abs(p.x - prev.x) >= Math.abs(p.y - prev.y) ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y };
}

function nextStairId(stairs: Stair[]): string {
  let n = 1;
  for (const s of stairs) {
    const m = /^S(\d+)$/.exec(s.id);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `S${n}`;
}

export function CanvasEditor() {
  const { project, design, ui, setUi, updateProject, undo } = useApp();
  const { t } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lenRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ ox: -1500, oy: -2500, scale: 0.09 });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [lenText, setLenText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // container size
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts: Pt[] = [...project.deck, ...project.house.flat()];
    const el = wrapRef.current;
    const w = el?.clientWidth || 800;
    const h = el?.clientHeight || 600;
    let minX = 0, minY = 0, maxX = 6000, maxY = 4000;
    if (pts.length) {
      minX = Math.min(...pts.map((p) => p.x));
      maxX = Math.max(...pts.map((p) => p.x));
      minY = Math.min(...pts.map((p) => p.y));
      maxY = Math.max(...pts.map((p) => p.y));
    }
    const margin = 1800;
    const scale = Math.min(w / (maxX - minX + 2 * margin), h / (maxY - minY + 2 * margin));
    setView({ scale, ox: (minX + maxX) / 2 - w / 2 / scale, oy: (minY + maxY) / 2 - h / 2 / scale });
  }, [project.deck, project.house]);

  const projectId = project.id;
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: v.ox + (clientX - rect.left) / v.scale, y: v.oy + (clientY - rect.top) / v.scale };
  }, []);

  const snap = useCallback((p: Pt): Pt => ({ x: snapTo(p.x, ui.snap), y: snapTo(p.y, ui.snap) }), [ui.snap]);

  // wheel zoom (non-passive listener so we can prevent page scroll)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(2, Math.max(0.005, v.scale * factor));
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const wx = v.ox + px / v.scale;
      const wy = v.oy + py / v.scale;
      setView({ scale: ns, ox: wx - px / ns, oy: wy - py / ns });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- outline editing helpers ----
  const applyPolygon = useCallback(
    (poly: Pt[], undoable: boolean, resetDependents: boolean) => {
      const norm = normalizePolygon(poly);
      const v = validatePolygon(norm);
      if (!v.ok) return false;
      updateProject((p) => {
        const houseEdges = resetDependents ? detectHouseEdges(norm, p.house) : p.houseEdges.filter((i) => i < norm.length);
        return {
          ...p,
          deck: norm,
          houseEdges,
          stairs: resetDependents ? [] : p.stairs.filter((s) => s.edgeIndex < norm.length),
          params: resetDependents ? { ...p.params, balustrade: { ...p.params.balustrade, edgeOverride: {} } } : p.params,
        };
      }, undoable);
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
      applyPolygon(poly, true, true);
      setDraft([]);
      setLenText('');
      setUi({ tool: 'select', selection: null });
      window.setTimeout(fit, 0);
    },
    [applyPolygon, fit, setUi, showToast, t],
  );

  const finishHouse = useCallback(
    (pts: Pt[]) => {
      if (pts.length >= 2) {
        updateProject((p) => {
          const house = [...p.house, pts];
          const detected = detectHouseEdges(p.deck, house);
          return { ...p, house, houseEdges: [...new Set([...p.houseEdges, ...detected])] };
        }, true);
      }
      setDraft([]);
      setLenText('');
      setUi({ tool: 'select' });
    },
    [setUi, updateProject],
  );

  const addDraftPoint = useCallback(
    (w: Pt) => {
      const p0 = snap(w);
      const p = draft.length ? ortho(draft[draft.length - 1], p0) : p0;
      const tol = 10 / view.scale;
      if (ui.tool === 'deck' && draft.length >= 3 && dist(p0, draft[0]) < tol) {
        finishDeck(draft);
        return;
      }
      if (draft.length && dist(p, draft[draft.length - 1]) < 1) return;
      setDraft([...draft, p]);
    },
    [draft, finishDeck, snap, ui.tool, view.scale],
  );

  const placeByLength = useCallback(() => {
    const L = parseFloat(lenText);
    if (!Number.isFinite(L) || L <= 0) return;
    let base = draft;
    if (!base.length) base = [cursor ? snap(cursor) : { x: 0, y: 0 }];
    const last = base[base.length - 1];
    let dir: Pt = { x: 1, y: 0 };
    if (cursor) {
      const dx = cursor.x - last.x;
      const dy = cursor.y - last.y;
      if (Math.abs(dx) >= Math.abs(dy)) dir = { x: Math.sign(dx) || 1, y: 0 };
      else dir = { x: 0, y: Math.sign(dy) || 1 };
    }
    const next = { x: last.x + dir.x * L, y: last.y + dir.y * L };
    setDraft([...base, next]);
    setLenText('');
  }, [cursor, draft, lenText, snap]);

  const placeStair = useCallback(
    (w: Pt) => {
      if (!design.ok) return;
      const E = design.edges;
      let best: { index: number; t: number; d: number } | null = null;
      for (const e of E) {
        if (project.houseEdges.includes(e.index)) continue;
        const pr = projectOnEdge(e, w);
        if (!best || pr.d < best.d) best = { index: e.index, t: pr.t, d: pr.d };
      }
      const tol = 25 / view.scale;
      if (!best || best.d > tol) return;
      const e = E[best.index];
      const width = Math.min(project.params.stairWidth, e.length);
      const offset = Math.max(0, Math.min(e.length - width, snapTo(best.t - width / 2, ui.snap)));
      const id = nextStairId(project.stairs);
      updateProject((p) => ({ ...p, stairs: [...p.stairs, { id, edgeIndex: best!.index, offset, width, groundOffset: 0 }] }), true);
      setUi({ tool: 'select', selection: { type: 'stair', id }, panelTab: 'selection' });
    },
    [design, project.houseEdges, project.params.stairWidth, project.stairs, setUi, ui.snap, updateProject, view.scale],
  );

  // ---- pointer handling ----
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== lenRef.current && typeof active.blur === 'function') active.blur();
    svgRef.current?.setPointerCapture(e.pointerId);
    if (e.button === 1 || ui.tool === 'pan' || spaceRef.current) {
      dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
    if (ui.tool === 'deck' || ui.tool === 'house') {
      addDraftPoint(w);
      return;
    }
    if (ui.tool === 'stair') {
      placeStair(w);
      return;
    }
    // select tool
    const tol = 8 / view.scale;
    const poly = project.deck;
    for (let i = 0; i < poly.length; i++) {
      if (dist(poly[i], w) < tol * 1.3) {
        setUi({ selection: { type: 'vertex', index: i }, panelTab: 'selection' });
        updateProject((p) => p, true);
        dragRef.current = { type: 'vertex', index: i, orig: poly.map((p) => ({ ...p })) };
        return;
      }
    }
    for (const s of design.stairs) {
      if (pointInPolygon(w, s.outline)) {
        const e = design.edges[s.edgeIndex];
        const pr = projectOnEdge(e, w);
        setUi({ selection: { type: 'stair', id: s.id }, panelTab: 'selection' });
        updateProject((p) => p, true);
        dragRef.current = { type: 'stair', id: s.id, grab: pr.t - s.offset };
        return;
      }
    }
    if (poly.length >= 4) {
      const E = polyEdges(poly);
      let best: { index: number; d: number } | null = null;
      for (const ed of E) {
        const pr = projectOnEdge(ed, w);
        if (!best || pr.d < best.d) best = { index: ed.index, d: pr.d };
      }
      if (best && best.d < tol) {
        const ed = E[best.index];
        const grab = ed.axis === 'x' ? ed.a.y - w.y : ed.a.x - w.x;
        setUi({ selection: { type: 'edge', index: best.index }, panelTab: 'selection' });
        updateProject((p) => p, true);
        dragRef.current = { type: 'edge', index: best.index, grab, orig: poly.map((p) => ({ ...p })) };
        return;
      }
    }
    setUi({ selection: null });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    setCursor(snap(w));
    const d = dragRef.current;
    if (!d) return;
    if (d.type === 'pan') {
      setView({ ...viewRef.current, ox: d.ox - (e.clientX - d.sx) / viewRef.current.scale, oy: d.oy - (e.clientY - d.sy) / viewRef.current.scale });
      return;
    }
    if (d.type === 'edge') {
      const poly = d.orig.map((p) => ({ ...p }));
      const i = d.index;
      const j = (i + 1) % poly.length;
      const horizontal = Math.abs(poly[i].y - poly[j].y) < 0.5;
      if (horizontal) {
        const ny = snapTo(w.y + d.grab, ui.snap);
        poly[i].y = ny;
        poly[j].y = ny;
      } else {
        const nx = snapTo(w.x + d.grab, ui.snap);
        poly[i].x = nx;
        poly[j].x = nx;
      }
      applyPolygon(poly, false, false);
      return;
    }
    if (d.type === 'vertex') {
      const poly = d.orig.map((p) => ({ ...p }));
      const i = d.index;
      const n = poly.length;
      const old = d.orig[i];
      const v = snap(w);
      const pi = (i - 1 + n) % n;
      const ni = (i + 1) % n;
      poly[i] = v;
      if (Math.abs(d.orig[pi].y - old.y) < 0.5) poly[pi] = { ...poly[pi], y: v.y };
      else poly[pi] = { ...poly[pi], x: v.x };
      if (Math.abs(d.orig[ni].y - old.y) < 0.5) poly[ni] = { ...poly[ni], y: v.y };
      else poly[ni] = { ...poly[ni], x: v.x };
      applyPolygon(poly, false, false);
      return;
    }
    if (d.type === 'stair') {
      const s = project.stairs.find((x) => x.id === d.id);
      if (!s || !design.ok) return;
      const e = design.edges[s.edgeIndex];
      if (!e) return;
      const pr = projectOnEdge(e, w);
      const offset = Math.max(0, Math.min(e.length - s.width, snapTo(pr.t - d.grab, ui.snap)));
      if (offset !== s.offset) updateProject((p) => ({ ...p, stairs: p.stairs.map((x) => (x.id === d.id ? { ...x, offset } : x)) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // ---- keyboard ----
  useEffect(() => {
    const isEditable = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isEditable(document.activeElement)) {
        spaceRef.current = true;
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isEditable(document.activeElement)) {
        e.preventDefault();
        undo();
        return;
      }
      const inLen = document.activeElement === lenRef.current;
      if (isEditable(document.activeElement) && !inLen) return;
      if (e.key === 'Escape') {
        if (draft.length) {
          setDraft([]);
          setLenText('');
        } else setUi({ selection: null, tool: 'select' });
        lenRef.current?.blur();
        return;
      }
      if (e.key === 'Enter') {
        if (inLen) return; // the length input handles its own Enter
        if (ui.tool === 'deck' && draft.length) finishDeck(draft);
        else if (ui.tool === 'house' && draft.length) finishHouse(draft);
        return;
      }
      if (e.key === 'Backspace' && !inLen) {
        if (draft.length) {
          e.preventDefault();
          setDraft(draft.slice(0, -1));
        } else if (ui.selection?.type === 'stair') {
          const id = ui.selection.id;
          updateProject((p) => ({ ...p, stairs: p.stairs.filter((s) => s.id !== id) }), true);
          setUi({ selection: null });
        }
        return;
      }
      if (e.key === 'Delete' && ui.selection?.type === 'stair') {
        const id = ui.selection.id;
        updateProject((p) => ({ ...p, stairs: p.stairs.filter((s) => s.id !== id) }), true);
        setUi({ selection: null });
        return;
      }
      if ((ui.tool === 'deck' || ui.tool === 'house') && !inLen && /^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        setLenText((s) => s + e.key);
        lenRef.current?.focus();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [draft, finishDeck, finishHouse, lenText, placeByLength, setUi, ui.selection, ui.tool, undo, updateProject]);

  // reset draft when tool changes away from drawing
  useEffect(() => {
    if (ui.tool !== 'deck' && ui.tool !== 'house') {
      setDraft([]);
      setLenText('');
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
  const deckEdges = project.deck.length >= 4 ? polyEdges(project.deck) : [];
  const previewPt = cursor && draft.length ? ortho(draft[draft.length - 1], cursor) : cursor;
  const previewLen = previewPt && draft.length ? dist(draft[draft.length - 1], previewPt) : 0;

  const tools: { id: Tool; label: string; icon: string }[] = [
    { id: 'select', label: t('tool.select'), icon: '⬚' },
    { id: 'deck', label: t('tool.deck'), icon: '✎' },
    { id: 'house', label: t('tool.house'), icon: '⌂' },
    { id: 'stair', label: t('tool.stair'), icon: '≡' },
    { id: 'pan', label: t('tool.pan'), icon: '✋' },
  ];

  const hint =
    ui.tool === 'deck' ? t('status.hintDeck') : ui.tool === 'house' ? t('status.hintHouse') : ui.tool === 'stair' ? t('status.hintStair') : t('status.hintSelect');

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div className="toolbar">
        {tools.map((tl) => (
          <button key={tl.id} className={`tool ${ui.tool === tl.id ? 'active' : ''}`} title={tl.label} onClick={() => setUi({ tool: tl.id, selection: null })}>
            <span className="icon">{tl.icon}</span>
            <span>{tl.label}</span>
          </button>
        ))}
        <span className="sep" />
        <label className="inline">
          {t('tool.snap')}
          <select value={ui.snap} onChange={(e) => setUi({ snap: Number(e.target.value) })}>
            {[10, 25, 50, 100].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button className="tool" onClick={fit} title={t('tool.fit')}>
          ⤢ {t('tool.fit')}
        </button>
        <button className="tool" onClick={undo} title={t('app.undo')}>
          ↶ {t('app.undo')}
        </button>
        <span className="sep" />
        <span className="layers">
          {(['frame', 'boards', 'posts', 'balustrade', 'dims', 'house'] as const).map((k) => (
            <label key={k} className="chk">
              <input type="checkbox" checked={ui.layers[k]} onChange={(e) => setUi({ layers: { ...ui.layers, [k]: e.target.checked } })} />
              {t(`layer.${k}`)}
            </label>
          ))}
        </span>
        <span className="sep" />
        <button className="tool danger" onClick={() => { if (project.deck.length && window.confirm(t('tool.clearDeck') + '?')) { updateProject((p) => ({ ...p, deck: [], houseEdges: [], stairs: [] }), true); setUi({ tool: 'deck', selection: null }); } }}>
          {t('tool.clearDeck')}
        </button>
        <button className="tool" onClick={() => updateProject((p) => ({ ...p, house: [] }), true)}>
          {t('tool.clearHouse')}
        </button>
      </div>

      {(ui.tool === 'deck' || ui.tool === 'house') && (
        <div className="length-box">
          <label>
            {t('tool.length')}
            <input ref={lenRef} value={lenText} onChange={(e) => setLenText(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (lenText.trim()) placeByLength(); else if (ui.tool === 'deck') finishDeck(draft); else finishHouse(draft); } }} placeholder="e.g. 3600" />
          </label>
          <div className="hint">{t('tool.lengthHint')}</div>
          <div className="hint">{t('status.drawing', { n: draft.length })}</div>
        </div>
      )}

      <svg
        ref={svgRef}
        className={`canvas tool-${ui.tool}`}
        viewBox={vb}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g>{gridLines}</g>
        <line x1={x0} y1={0} x2={x1} y2={0} stroke="#94a3b8" strokeWidth={sw * 1.5} />
        <line x1={0} y1={y0} x2={0} y2={y1} stroke="#94a3b8" strokeWidth={sw * 1.5} />

        {project.deck.length >= 4 && (
          <DesignLayers
            project={project}
            design={design}
            layers={{
              house: ui.layers.house,
              frame: ui.layers.frame && design.ok,
              boards: ui.layers.boards && design.ok,
              posts: ui.layers.posts && design.ok,
              balustrade: ui.layers.balustrade && design.ok,
              dims: ui.layers.dims && design.ok,
              postLabels: view.scale > 0.05,
              bearerLabels: view.scale > 0.04,
              joins: view.scale > 0.05,
              labels: true,
            }}
            fs={fs}
            sw={sw}
          />
        )}
        {project.deck.length < 4 && ui.layers.house &&
          project.house.map((pl, i) => <polyline key={i} points={pl.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={COLORS.house} strokeWidth={sw * 6} strokeDasharray={`${sw * 24} ${sw * 10}`} />)}

        {/* selection overlay */}
        {sel?.type === 'edge' && deckEdges[sel.index] && (
          <line x1={deckEdges[sel.index].a.x} y1={deckEdges[sel.index].a.y} x2={deckEdges[sel.index].b.x} y2={deckEdges[sel.index].b.y} stroke={COLORS.select} strokeWidth={sw * 6} opacity={0.8} />
        )}
        {sel?.type === 'stair' && design.stairs.find((s) => s.id === sel.id) && (
          <polygon points={design.stairs.find((s) => s.id === sel.id)!.outline.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={COLORS.select} strokeWidth={sw * 4} />
        )}
        {ui.tool === 'select' &&
          project.deck.map((p, i) => (
            <rect key={`v${i}`} x={p.x - 5 / view.scale} y={p.y - 5 / view.scale} width={10 / view.scale} height={10 / view.scale} fill={sel?.type === 'vertex' && sel.index === i ? COLORS.select : '#fff'} stroke="#111" strokeWidth={sw} />
          ))}

        {/* draft */}
        {draft.length > 0 && (
          <g>
            <polyline points={draft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#111" strokeWidth={sw * 2} />
            {previewPt && (
              <>
                <line x1={draft[draft.length - 1].x} y1={draft[draft.length - 1].y} x2={previewPt.x} y2={previewPt.y} stroke="#111" strokeWidth={sw * 1.5} strokeDasharray={`${sw * 8} ${sw * 6}`} />
                <text x={(draft[draft.length - 1].x + previewPt.x) / 2} y={(draft[draft.length - 1].y + previewPt.y) / 2 - fs * 0.5} fontSize={fs} fill="#111" textAnchor="middle" fontWeight={600}>
                  {Math.round(previewLen)}
                </text>
              </>
            )}
            {draft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 7 : 4) / view.scale} fill={i === 0 ? COLORS.select : '#111'} />
            ))}
          </g>
        )}
        {cursor && (ui.tool === 'deck' || ui.tool === 'house' || ui.tool === 'stair') && (
          <g>
            <line x1={(previewPt ?? cursor).x - fs} y1={(previewPt ?? cursor).y} x2={(previewPt ?? cursor).x + fs} y2={(previewPt ?? cursor).y} stroke="#111" strokeWidth={sw} />
            <line x1={(previewPt ?? cursor).x} y1={(previewPt ?? cursor).y - fs} x2={(previewPt ?? cursor).x} y2={(previewPt ?? cursor).y + fs} stroke="#111" strokeWidth={sw} />
          </g>
        )}
      </svg>

      <div className="statusbar">
        <span>
          {t('status.cursor')}: {cursor ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)}` : '-'}
        </span>
        <span>
          {t('status.area')}: {design.ok ? `${design.areaM2.toFixed(2)} m²` : '-'}
        </span>
        <span className="hint">{project.deck.length < 4 && !draft.length ? t('status.noDeck') : hint}</span>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
