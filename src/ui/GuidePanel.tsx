import { edges as polyEdges } from '../engine/geometry';
import { productName, useT } from '../i18n';
import { DECKING_PRODUCTS, PRODUCT_MAP } from '../model/catalog';
import { newId } from '../model/defaults';
import type { Project, Pt, SlabArea } from '../model/types';
import { useApp } from '../state';
import { money } from '../utils/format';
import { breakersForAxis, currentBreakers, nextBreakerId, suggestBreaker } from '../utils/breakers';
import { frameSummary } from '../utils/frame';
import { addStairOnLongestEdge, detectShape, housePolylineFor, makeShape, mirrorProject, shapeDims, topEdgeIndex, type ShapeKind } from '../utils/shapes';
import { Chk, Num, Seg } from './fields';
import { SidePanel } from './SidePanel';

/** Plan-view colour swatch for each decking choice. */
const SWATCH: Record<string, string> = {
  'modelo-140x23': '#6E4B33',
  'ntw-terrace-us49': '#9C7A4B',
  'hw-86x19': '#B5582E',
  'hw-136x19': '#A8502A',
  'tp-90x22': '#D9B37A',
  'tp-140x22': '#D2A96F',
};

type WallKind = 'masonry' | 'timber' | 'none';

function wallKindOf(p: Project): WallKind {
  if (!p.houseEdges.length) return 'none';
  return p.params.attachment === 'wall' && p.params.wallFixing === 'dynabolt' ? 'masonry' : 'timber';
}

/**
 * Five guided steps that cover a normal job. Anything else lives behind "more settings",
 * which swaps in the full parameter / rules / prices panels.
 */
export function GuidePanel() {
  const { project, design, ui, setUi, updateProject } = useApp();
  const { t, lang } = useT();
  const p = project.params;

  if (ui.advanced) {
    return (
      <div className="guide-advanced">
        <button className="btn ghost back" onClick={() => setUi({ advanced: false })}>
          {t('g.back')}
        </button>
        <SidePanel />
      </div>
    );
  }

  const shape = project.deck.length >= 4 ? detectShape(project.deck) : null;
  const dims = shapeDims(project.deck);
  const wallKind = wallKindOf(project);

  const setShape = (kind: ShapeKind) => {
    if (kind === 'custom') {
      setUi({ drawMode: true, tool: project.deck.length >= 4 ? 'select' : 'deck', selection: null });
      return;
    }
    const deck = makeShape(kind, dims);
    updateProject((pr) => {
      const houseEdges = wallKind === 'none' ? [] : [0];
      let next: Project = {
        ...pr,
        deck,
        houseEdges,
        house: wallKind === 'none' ? [] : [housePolylineFor(deck, 0)],
        stairs: [],
        breakers: null,
        details: null,
        params: { ...pr.params, balustrade: { ...pr.params.balustrade, edgeOverride: {} } },
      };
      for (let i = 0; i < pr.stairs.length; i++) next = addStairOnLongestEdge(next);
      return next;
    }, 'h.shape');
    setUi({ tool: 'select', selection: null, drawMode: false });
  };

  const setWall = (k: WallKind) =>
    updateProject((pr) => {
      const top = topEdgeIndex(pr.deck);
      const houseEdges = k === 'none' ? [] : pr.houseEdges.length ? pr.houseEdges : top >= 0 ? [top] : [];
      const house = k === 'none' ? [] : pr.house.length ? pr.house : houseEdges.length ? [housePolylineFor(pr.deck, houseEdges[0])] : [];
      return {
        ...pr,
        houseEdges,
        house,
        stairs: pr.stairs.filter((s) => !houseEdges.includes(s.edgeIndex)),
        params: { ...pr.params, attachment: k === 'masonry' ? 'wall' : 'freestanding', wallFixing: k === 'masonry' ? 'dynabolt' : pr.params.wallFixing },
      };
    }, 'h.wall');

  const paramLabel: Partial<Record<keyof Project['params'], string>> = { deckHeight: 'h.height', footingType: 'h.wall', deckingProductId: 'h.decking', edgeBoard: 'h.edgeBoard', stairWidth: 'h.stairs' };
  const setParam = <K extends keyof Project['params']>(k: K, v: Project['params'][K]) => updateProject((pr) => ({ ...pr, params: { ...pr.params, [k]: v } }), paramLabel[k] ?? 'h.params');

  const chooseDecking = (id: string) => {
    const prod = PRODUCT_MAP[id];
    updateProject((pr) => ({
      ...pr,
      params: { ...pr.params, deckingProductId: id, boardGap: prod.defaultGap ?? pr.params.boardGap, joistSpacing: Math.min(pr.params.joistSpacing, prod.maxJoistSpacing ?? pr.params.joistSpacing) },
    }), 'h.decking');
  };

  const priceLabel = (id: string): string => {
    const prod = PRODUCT_MAP[id];
    const price = project.prices[id] ?? prod.defaultPrice;
    if (prod.unit === 'm' && prod.stockLengths && prod.stockLengths.length === 1) return `${money(price * (prod.stockLengths[0] / 1000))}${t('g.perBoard')}`;
    return `${money(price)}${t(`unit.${prod.unit}`)}`;
  };

  // board direction: the whole frame is laid out again, so hand-placed breakers start over (unless the boards
  // already run that way)
  const setBoardAxis = (v: 'auto' | 'x' | 'y') => {
    if (v === p.boardAxis) return;
    const kept = breakersForAxis(project, v);
    updateProject((pr) => ({ ...pr, params: { ...pr.params, boardAxis: v }, breakers: breakersForAxis(pr, v) }), 'h.boardAxis');
    if (!kept && ui.selection?.type === 'breaker') setUi({ selection: null });
  };
  const lay = design.ok ? design.layout : null;
  const addBreaker = () => {
    if (!lay) return;
    const s = suggestBreaker(lay);
    if (!s) return;
    const base = currentBreakers(project, lay);
    const id = nextBreakerId(base);
    updateProject((pr) => ({ ...pr, breakers: { ...base, items: [...base.items, { id, ...s }] } }), 'h.addBreaker');
    setUi({ selection: { type: 'breaker', id } });
  };

  const exposedEdges = project.deck.length >= 4 ? polyEdges(project.deck).filter((e) => !project.houseEdges.includes(e.index)) : [];
  const stairRise = project.stairs.length ? Math.round(project.stairs[0].rise ?? p.deckHeight - project.stairs[0].groundOffset) : p.deckHeight;
  const setStairRise = (v: number) => {
    const rise = Math.max(100, v);
    updateProject((pr) => ({ ...pr, stairs: pr.stairs.map((s) => ({ ...s, rise: rise === pr.params.deckHeight ? undefined : rise, groundOffset: 0 })) }), 'h.stairs');
  };
  const setStairWidth = (w: number) => {
    const width = Math.max(600, w);
    updateProject((pr) => {
      const E = polyEdges(pr.deck);
      return { ...pr, params: { ...pr.params, stairWidth: width }, stairs: pr.stairs.map((s) => ({ ...s, width: Math.min(width, E[s.edgeIndex]?.length ?? width) })) };
    }, 'h.stairs');
  };

  return (
    <div className="guide">
      <div className="guide-intro">{t('g.intro')}</div>

      <section className="gstep">
        <h3>
          <i>1</i>
          {t('g.shape')}
        </h3>
        <div className="tiles" role="group" aria-label={t('g.shape')}>
          <button type="button" className={`tile ${shape === 'rect' && !ui.drawMode ? 'on' : ''}`} onClick={() => setShape('rect')}>
            <svg aria-hidden="true" width="30" height="22" viewBox="0 0 30 22"><rect x="1" y="1" width="28" height="20" fill="#F0E4D2" stroke="#1C2430" strokeWidth="1.6" /></svg>
            {t('g.shape.rect')}
          </button>
          <button type="button" className={`tile ${shape === 'L' && !ui.drawMode ? 'on' : ''}`} onClick={() => setShape('L')}>
            <svg aria-hidden="true" width="30" height="22" viewBox="0 0 30 22"><path d="M1 1h28v10H16v10H1z" fill="#F0E4D2" stroke="#1C2430" strokeWidth="1.6" /></svg>
            {t('g.shape.L')}
          </button>
          <button type="button" className={`tile ${shape === 'U' && !ui.drawMode ? 'on' : ''}`} onClick={() => setShape('U')}>
            <svg aria-hidden="true" width="30" height="22" viewBox="0 0 30 22"><path d="M1 1h28v20h-9V11H10v10H1z" fill="#F0E4D2" stroke="#1C2430" strokeWidth="1.6" /></svg>
            {t('g.shape.U')}
          </button>
          <button type="button" className={`tile ${ui.drawMode || shape === 'custom' ? 'on' : ''}`} onClick={() => setShape('custom')}>
            <svg aria-hidden="true" width="30" height="22" viewBox="0 0 30 22" fill="none" stroke="#1C2430" strokeWidth="1.6" strokeLinecap="round"><path d="M4 19 20 3M18 3h3v3" /></svg>
            {t('g.shape.custom')}
          </button>
        </div>
        {project.deck.length >= 4 && !ui.drawMode && (
          <button type="button" className="btn ghost mirror" onClick={() => updateProject((pr) => mirrorProject(pr), 'h.mirror')}>
            ⇋ {t('g.mirror')}
          </button>
        )}
        {ui.drawMode ? (
          <p className="hint">{t('g.drawing')}</p>
        ) : project.deck.length >= 4 ? (
          <p className="hint">
            <b>{t('g.current', { w: dims.w, d: dims.d })}</b>
            {shape === 'L' || shape === 'U' ? ` · ${t('g.currentNotch', { nw: dims.nw, nd: dims.nd })}` : ''}
            <br />
            {t('g.shapeHint')}
          </p>
        ) : (
          <p className="hint">{t('g.shapeHint')}</p>
        )}
      </section>

      <section className="gstep">
        <h3>
          <i>2</i>
          {t('g.wall')}
        </h3>
        <Seg<WallKind>
          label={t('g.wall')}
          value={wallKind}
          options={[
            { value: 'masonry', label: t('g.wall.masonry') },
            { value: 'timber', label: t('g.wall.timber') },
            { value: 'none', label: t('g.wall.none') },
          ]}
          onChange={setWall}
        />
        <p className="hint">{t(`g.wallHint.${wallKind}`, { inset: project.rules.houseBearerInset, edge: p.edgeBoard ? t('g.wallHint.none.edge') : '' })}</p>
        <Seg<'stump' | 'slab'>
          label={t('g.ground')}
          value={p.footingType === 'slab' ? 'slab' : 'stump'}
          options={[
            { value: 'stump', label: t('g.ground.stump') },
            { value: 'slab', label: t('g.ground.slab') },
          ]}
          onChange={(v) => setParam('footingType', v)}
        />
        <p className="hint">{p.footingType === 'slab' ? t('g.groundHint.slab') : t('g.groundHint.stump', { dia: p.footingDiameter, depth: p.footingDepth })}</p>
        {p.footingType !== 'slab' && <SlabAreas />}
      </section>

      <section className="gstep">
        <h3>
          <i>3</i>
          {t('g.height')}
        </h3>
        <div className="height-row">
          <input type="range" min={150} max={1500} step={10} value={p.deckHeight} aria-label={t('g.height')} onChange={(e) => setParam('deckHeight', Number(e.target.value))} />
          <Num label="" value={p.deckHeight} onChange={(v) => setParam('deckHeight', Math.max(100, v))} step={10} min={100} />
          <span className="unit">mm</span>
        </div>
        <p className="hint">{t('g.heightHint')}</p>
      </section>

      <section className="gstep">
        <h3>
          <i>4</i>
          {t('g.decking')}
        </h3>
        <div className="boards" role="radiogroup" aria-label={t('g.decking')}>
          {DECKING_PRODUCTS.map((d) => (
            <button type="button" key={d.id} className={`board ${p.deckingProductId === d.id ? 'on' : ''}`} onClick={() => chooseDecking(d.id)} role="radio" aria-checked={p.deckingProductId === d.id}>
              <span className="sw" style={{ background: SWATCH[d.id] ?? '#c9a874' }} aria-hidden="true" />
              <span className="name">{productName(d, lang)}</span>
              <b>{priceLabel(d.id)}</b>
            </button>
          ))}
        </div>
        <div className="dir-row">
          <span className="lbl">{t('g.boardDir')}</span>
          <Seg<'auto' | 'x' | 'y'>
            label={t('g.boardDir')}
            value={p.boardAxis}
            options={[
              { value: 'auto', label: t('g.boardDir.auto') },
              { value: 'x', label: t('g.boardDir.x') },
              { value: 'y', label: t('g.boardDir.y') },
            ]}
            onChange={setBoardAxis}
          />
        </div>
        {lay && <p className="hint">{t('g.boardDirHint', { now: t(`g.boardDir.now.${lay.boardAxis}`) })}</p>}
        {lay && <p className="hint">{design.joistSetout ? t('g.joistSetoutNote', { spacing: Math.round(design.joistSetoutSpacing) }) : t('g.joistSpacingNote', { cap: design.joistSpacingCap, spacing: design.joistSpacingText })}</p>}
        {lay && <p className={design.frame.noFit ? 'hint warn' : 'hint'}>{frameSummary(design, project.rules, t)}</p>}
        <Chk label={t('g.edgeBoard')} checked={p.edgeBoard} onChange={(v) => setParam('edgeBoard', v)} />
        {p.edgeBoard && design.ok && <p className="hint">{t('g.edgeBoardNote', { product: productName(design.edgeBoardProductId, lang) })}</p>}
        {lay && design.breakersOn && (
          <>
            <div className="brk-row">
              <span>{t('g.breakers', { n: lay.breakers.length, mode: t(lay.breakerMode === 'manual' ? 'g.breakers.manual' : 'g.breakers.auto') })}</span>
              <button type="button" className="btn ghost small" onClick={addBreaker} disabled={!lay.boards.length}>
                {t('g.breakerAdd')}
              </button>
              {lay.breakerMode === 'manual' && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    updateProject((pr) => ({ ...pr, breakers: null }), 'h.breakerAuto');
                    if (ui.selection?.type === 'breaker') setUi({ selection: null });
                  }}
                >
                  {t('canvas.autoBreakers')}
                </button>
              )}
            </div>
            {lay.breakerMode === 'manual' && lay.totals.boardJoins > 0 && <p className="hint warn">{t('layout.breakerJoins', { n: lay.totals.boardJoins })}</p>}
            <p className="hint">
              {lay.breakers.length > 0 && lay.breakerMode === 'auto' ? `${t('g.breakerNote')} ` : ''}
              {t('g.breakerEditHint')}
            </p>
          </>
        )}
      </section>

      <section className="gstep">
        <h3>
          <i>5</i>
          {t('g.stairs')}
        </h3>
        <div className="stair-row">
          <div className="seg counter" role="group" aria-label={t('g.stairs')}>
            <button type="button" onClick={() => updateProject((pr) => ({ ...pr, stairs: pr.stairs.slice(0, -1) }), 'h.deleteStair')} disabled={!project.stairs.length} aria-label="-">
              −
            </button>
            <button type="button" className="on">
              {t('g.stairCount', { n: project.stairs.length })}
            </button>
            <button type="button" onClick={() => updateProject((pr) => addStairOnLongestEdge(pr), 'h.addStair')} disabled={!exposedEdges.length} aria-label="+">
              +
            </button>
          </div>
          <span className="unit">{t('g.stairWidth')}</span>
          <Num label="" value={p.stairWidth} onChange={setStairWidth} step={50} min={600} />
          <span className="unit">mm</span>
        </div>
        {project.stairs.length > 0 && (
          <div className="stair-row" style={{ marginTop: 6 }}>
            <span className="unit">{t('g.stairRise')}</span>
            <Num label="" value={stairRise} onChange={setStairRise} step={10} min={100} />
            <span className="unit">mm</span>
            {design.ok && design.stairs[0] && (
              <span className="unit">
                {design.stairs[0].risers} × {Math.round(design.stairs[0].riser)} / {design.stairs[0].going}
              </span>
            )}
          </div>
        )}
        <p className="hint">{project.stairs.length ? t('g.stairRiseHint') : t('g.stairHint')}</p>
      </section>

      <button type="button" className="more" onClick={() => setUi({ advanced: true, panelTab: 'params' })}>
        {t('g.more')}
        <small>{t('g.moreHint')}</small>
      </button>
    </div>
  );
}

/**
 * Existing concrete under part of the deck (a patio slab): no stumps or bearers over it, the joists on pedestals.
 * Each slab a rectangle measured from the deck's top left corner, with the deck's level above it.
 */
function SlabAreas() {
  const { project, design, updateProject } = useApp();
  const { t } = useT();
  const slabs = project.slabs ?? [];
  const o = design.bb;
  const rectOf = (s: SlabArea) => {
    const xs = s.poly.map((q) => q.x);
    const ys = s.poly.map((q) => q.y);
    return { x: Math.min(...xs) - o.minX, y: Math.min(...ys) - o.minY, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
  };
  const polyOf = (r: { x: number; y: number; w: number; d: number }): Pt[] => {
    const x0 = o.minX + r.x;
    const y0 = o.minY + r.y;
    return [{ x: x0, y: y0 }, { x: x0 + r.w, y: y0 }, { x: x0 + r.w, y: y0 + r.d }, { x: x0, y: y0 + r.d }];
  };
  const change = (id: string, patch: Partial<SlabArea>) => updateProject((p) => ({ ...p, slabs: (p.slabs ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) }), 'h.slab');
  const add = () =>
    updateProject(
      (p) => ({ ...p, slabs: [...(p.slabs ?? []), { id: newId('S'), height: Math.min(p.params.deckHeight, 170), poly: polyOf({ x: 0, y: 0, w: Math.min(3000, o.width), d: Math.min(3000, o.height) }) }] }),
      'h.slab',
    );
  return (
    <div className="slabs">
      <b>{t('g.slab.title')}</b>
      <p className="hint">{t('g.slab.hint')}</p>
      {slabs.map((s) => {
        const r = rectOf(s);
        const info = design.slabs.find((x) => x.id === s.id);
        return (
          <div key={s.id} className="slab-row">
            <Num label={t('g.slab.x')} value={Math.round(r.x)} step={10} onChange={(v) => change(s.id, { poly: polyOf({ ...r, x: v }) })} />
            <Num label={t('g.slab.y')} value={Math.round(r.y)} step={10} onChange={(v) => change(s.id, { poly: polyOf({ ...r, y: v }) })} />
            <Num label={t('g.slab.w')} value={Math.round(r.w)} step={10} min={100} onChange={(v) => change(s.id, { poly: polyOf({ ...r, w: Math.max(100, v) }) })} />
            <Num label={t('g.slab.d')} value={Math.round(r.d)} step={10} min={100} onChange={(v) => change(s.id, { poly: polyOf({ ...r, d: Math.max(100, v) }) })} />
            <Num label={t('g.slab.height')} value={s.height} step={5} min={50} onChange={(v) => change(s.id, { height: Math.max(50, v) })} />
            <div className="slab-foot">
              <small>{info ? (info.productId ? t(info.pads ? 'g.slab.infoPads' : 'g.slab.info', { n: info.count, pads: info.pads, h: Math.round(info.pedestalHeight) }) : t(info.pedestalHeight < 30 ? 'compliance.slabTooLow' : 'compliance.slabTooHigh', { h: Math.round(info.pedestalHeight), height: s.height, joist: design.levels.joistD })) : ''}</small>
              <button type="button" className="linkish" onClick={() => updateProject((p) => ({ ...p, slabs: (p.slabs ?? []).filter((x) => x.id !== s.id) }), 'h.slab')}>
                {t('g.slab.remove')}
              </button>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn" onClick={add}>
        {t('g.slab.add')}
      </button>
    </div>
  );
}
