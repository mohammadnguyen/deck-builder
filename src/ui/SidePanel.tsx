import { useState, type ReactNode } from 'react';
import { edges as polyEdges, normalizePolygon, validatePolygon } from '../engine/geometry';
import { productName, useT } from '../i18n';
import { CATALOG, CONCRETE_PRODUCTS, DECKING_PRODUCTS, FRAMING_PRODUCTS, POST_PRODUCTS, PRODUCT_MAP } from '../model/catalog';
import { defaultRules } from '../model/defaults';
import type { DeckParams, Pt, RuleSet } from '../model/types';
import { useApp, type PanelTab } from '../state';
import { money } from '../utils/format';

function Num({ label, value, onChange, step = 1, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; hint?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const v = parseFloat(text);
            if (Number.isFinite(v)) onChange(v);
            setText(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Sel({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Chk({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function SidePanel() {
  const { ui, setUi } = useApp();
  const { t } = useT();
  const tabs: PanelTab[] = ['params', 'selection', 'results', 'rules', 'prices'];
  return (
    <aside className="side">
      <div className="tabs">
        {tabs.map((tab) => (
          <button key={tab} className={ui.panelTab === tab ? 'active' : ''} onClick={() => setUi({ panelTab: tab })}>
            {t(`panel.${tab}`)}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {ui.panelTab === 'params' && <ParamsPanel />}
        {ui.panelTab === 'selection' && <SelectionPanel />}
        {ui.panelTab === 'results' && <ResultsPanel />}
        {ui.panelTab === 'rules' && <RulesPanel />}
        {ui.panelTab === 'prices' && <PricesPanel />}
      </div>
    </aside>
  );
}

function ParamsPanel() {
  const { project, updateProject, lang, setUi } = useApp();
  const { t } = useT();
  const p = project.params;
  const set = <K extends keyof DeckParams>(k: K, v: DeckParams[K]) => updateProject((pr) => ({ ...pr, params: { ...pr.params, [k]: v } }));
  const setBal = <K extends keyof DeckParams['balustrade']>(k: K, v: DeckParams['balustrade'][K]) =>
    updateProject((pr) => ({ ...pr, params: { ...pr.params, balustrade: { ...pr.params.balustrade, [k]: v } } }));
  const [rw, setRw] = useState(4800);
  const [rd, setRd] = useState(3600);
  const makeRect = () => {
    const deck: Pt[] = [{ x: 0, y: 0 }, { x: rw, y: 0 }, { x: rw, y: rd }, { x: 0, y: rd }];
    updateProject((pr) => ({ ...pr, deck, houseEdges: [0], stairs: [], house: pr.house.length ? pr.house : [[{ x: -1500, y: 0 }, { x: rw + 1500, y: 0 }]] }), true);
    setUi({ tool: 'select', selection: null });
  };
  const deckingOpts = DECKING_PRODUCTS.map((d) => ({ value: d.id, label: productName(d, lang) }));
  const framingOpts = FRAMING_PRODUCTS.map((d) => ({ value: d.id, label: productName(d, lang) }));
  const postOpts = [{ value: 'auto', label: t('p.post.auto') }, ...POST_PRODUCTS.map((d) => ({ value: d.id, label: productName(d, lang) }))];

  return (
    <div>
      <Group title={t('app.projectName')}>
        <label className="field">
          <span>{t('app.projectName')}</span>
          <input value={project.name} onChange={(e) => updateProject((pr) => ({ ...pr, name: e.target.value }))} />
        </label>
        <label className="field">
          <span>{t('app.client')}</span>
          <input value={project.client} onChange={(e) => updateProject((pr) => ({ ...pr, client: e.target.value }))} />
        </label>
        <label className="field">
          <span>{t('app.address')}</span>
          <input value={project.address} onChange={(e) => updateProject((pr) => ({ ...pr, address: e.target.value }))} />
        </label>
      </Group>
      <Group title={t('p.quickRect')}>
        <div className="row">
          <Num label={t('p.width')} value={rw} onChange={setRw} step={100} min={600} />
          <Num label={t('p.depth')} value={rd} onChange={setRd} step={100} min={600} />
        </div>
        <button className="btn" onClick={makeRect}>
          {t('p.create')}
        </button>
        <small>{t('p.quickRectHint')}</small>
      </Group>
      <Group title={t('p.group.geometry')}>
        <Num label={t('p.deckHeight')} value={p.deckHeight} onChange={(v) => set('deckHeight', v)} step={10} min={100} />
        <Sel
          label={t('p.boardAxis')}
          value={p.boardAxis}
          options={[
            { value: 'auto', label: t('p.boardAxis.auto') },
            { value: 'x', label: t('p.boardAxis.x') },
            { value: 'y', label: t('p.boardAxis.y') },
          ]}
          onChange={(v) => set('boardAxis', v as DeckParams['boardAxis'])}
        />
        <Sel
          label={t('p.attachment')}
          value={p.attachment}
          options={[
            { value: 'wall', label: t('p.attachment.wall') },
            { value: 'freestanding', label: t('p.attachment.freestanding') },
          ]}
          onChange={(v) => set('attachment', v as DeckParams['attachment'])}
        />
        {p.attachment === 'wall' && (
          <Sel
            label={t('p.wallFixing')}
            value={p.wallFixing}
            options={[
              { value: 'dynabolt', label: t('p.wallFixing.dynabolt') },
              { value: 'bolt', label: t('p.wallFixing.bolt') },
            ]}
            onChange={(v) => set('wallFixing', v as DeckParams['wallFixing'])}
          />
        )}
      </Group>
      <Group title={t('p.group.decking')}>
        <Sel
          label={t('p.decking')}
          value={p.deckingProductId}
          options={deckingOpts}
          onChange={(v) => {
            const prod = PRODUCT_MAP[v];
            updateProject((pr) => ({
              ...pr,
              params: { ...pr.params, deckingProductId: v, boardGap: prod.defaultGap ?? pr.params.boardGap, joistSpacing: prod.maxJoistSpacing ?? pr.params.joistSpacing },
            }));
          }}
        />
        <div className="row">
          <Num label={t('p.boardGap')} value={p.boardGap} onChange={(v) => set('boardGap', v)} min={0} max={20} />
          <Num label={t('p.joistSpacing')} value={p.joistSpacing} onChange={(v) => set('joistSpacing', v)} step={50} min={200} max={900} />
        </div>
        <Chk label={t('p.fascia')} checked={p.fascia} onChange={(v) => set('fascia', v)} />
        <Chk label={t('p.joistTape')} checked={p.joistTape} onChange={(v) => set('joistTape', v)} />
        <Chk label={t('p.weedMat')} checked={p.weedMat} onChange={(v) => set('weedMat', v)} />
        <Chk label={t('p.oil')} checked={p.oil} onChange={(v) => set('oil', v)} />
      </Group>
      <Group title={t('p.group.frame')}>
        <Sel label={t('p.joist')} value={p.joistProductId} options={framingOpts} onChange={(v) => set('joistProductId', v)} />
        <Sel label={t('p.bearer')} value={p.bearerProductId} options={framingOpts} onChange={(v) => set('bearerProductId', v)} />
        <Sel
          label={t('p.bearerLam')}
          value={String(p.bearerLaminations)}
          options={[
            { value: '1', label: t('p.lam1') },
            { value: '2', label: t('p.lam2') },
          ]}
          onChange={(v) => set('bearerLaminations', Number(v) as 1 | 2)}
        />
        <Sel
          label={t('p.joistConnection')}
          value={p.joistConnection}
          options={[
            { value: 'flush', label: t('p.joistConnection.flush') },
            { value: 'onTop', label: t('p.joistConnection.onTop') },
          ]}
          onChange={(v) => set('joistConnection', v as DeckParams['joistConnection'])}
        />
        {p.joistConnection === 'onTop' && (
          <Sel
            label={t('p.joistFixing')}
            value={p.joistFixing}
            options={[
              { value: 'skewNails', label: t('p.joistFixing.skewNails') },
              { value: 'tripleGrip', label: t('p.joistFixing.tripleGrip') },
            ]}
            onChange={(v) => set('joistFixing', v as DeckParams['joistFixing'])}
          />
        )}
        <Sel
          label={t('p.bearerToPost')}
          value={p.bearerToPost}
          options={[
            { value: 'checked', label: t('p.bearerToPost.checked') },
            { value: 'screwed', label: t('p.bearerToPost.screwed') },
            { value: 'bolted', label: t('p.bearerToPost.bolted') },
            { value: 'onTop', label: t('p.bearerToPost.onTop') },
          ]}
          onChange={(v) => set('bearerToPost', v as DeckParams['bearerToPost'])}
        />
        <Sel label={t('p.post')} value={p.postProductId} options={postOpts} onChange={(v) => set('postProductId', v)} />
      </Group>
      <Group title={t('p.group.footing')}>
        <Sel
          label={t('p.footingType')}
          value={p.footingType}
          options={[
            { value: 'stump', label: t('p.footingType.stump') },
            { value: 'stirrup', label: t('p.footingType.stirrup') },
            { value: 'slab', label: t('p.footingType.slab') },
          ]}
          onChange={(v) => set('footingType', v as DeckParams['footingType'])}
        />
        {p.footingType === 'slab' ? null : p.footingType === 'stump' ? (
          <div className="row">
            <Num label={t('p.footingDepth')} value={p.footingDepth} onChange={(v) => set('footingDepth', v)} step={50} min={300} />
            <Num label={t('p.footingDiameter')} value={p.footingDiameter} onChange={(v) => set('footingDiameter', v)} step={50} min={200} />
          </div>
        ) : (
          <div className="row">
            <Num label={t('p.padSize')} value={p.padSize} onChange={(v) => set('padSize', v)} step={50} min={200} />
            <Num label={t('p.padDepth')} value={p.padDepth} onChange={(v) => set('padDepth', v)} step={50} min={200} />
          </div>
        )}
        <Sel label={t('p.concrete')} value={p.concreteProductId} options={CONCRETE_PRODUCTS.map((c) => ({ value: c.id, label: productName(c, lang) }))} onChange={(v) => set('concreteProductId', v)} />
      </Group>
      <Group title={t('p.group.balustrade')}>
        <Sel
          label={t('p.balMode')}
          value={p.balustrade.mode}
          options={[
            { value: 'auto', label: t('p.bal.auto') },
            { value: 'on', label: t('p.bal.on') },
            { value: 'off', label: t('p.bal.off') },
          ]}
          onChange={(v) => setBal('mode', v as DeckParams['balustrade']['mode'])}
        />
        <div className="row">
          <Num label={t('p.balHeight')} value={p.balustrade.height} onChange={(v) => setBal('height', v)} step={10} min={865} />
          <Num label={t('p.balPostSpacing')} value={p.balustrade.postSpacing} onChange={(v) => setBal('postSpacing', v)} step={100} min={600} />
        </div>
        <Sel
          label={t('p.balInfill')}
          value={p.balustrade.infill}
          options={[
            { value: 'slats', label: t('p.infill.slats') },
            { value: 'wire', label: t('p.infill.wire') },
            { value: 'none', label: t('p.infill.none') },
          ]}
          onChange={(v) => setBal('infill', v as DeckParams['balustrade']['infill'])}
        />
        {p.balustrade.infill === 'wire' && <Num label={t('p.wireRuns')} value={p.balustrade.wireRuns} onChange={(v) => setBal('wireRuns', v)} min={4} max={16} />}
        {p.balustrade.infill === 'slats' && (
          <div className="row">
            <Num label={t('p.slatWidth')} value={p.balustrade.slatWidth} onChange={(v) => setBal('slatWidth', v)} min={19} />
            <Num label={t('p.slatGap')} value={p.balustrade.slatGap} onChange={(v) => setBal('slatGap', v)} min={10} max={100} />
          </div>
        )}
      </Group>
      <Group title={t('p.group.stairs')}>
        <Num label={t('p.stairWidth')} value={p.stairWidth} onChange={(v) => set('stairWidth', v)} step={50} min={600} />
      </Group>
      <Group title={t('p.group.cost')}>
        <div className="row">
          <Num label={t('p.wasteDecking')} value={p.wasteDeckingPct} onChange={(v) => set('wasteDeckingPct', v)} min={0} max={50} />
          <Num label={t('p.wasteFraming')} value={p.wasteFramingPct} onChange={(v) => set('wasteFramingPct', v)} min={0} max={50} />
          <Num label={t('p.gst')} value={p.gstPct} onChange={(v) => set('gstPct', v)} min={0} max={30} />
        </div>
        <Chk label={t('p.pricesIncludeGst')} checked={p.pricesIncludeGst} onChange={(v) => set('pricesIncludeGst', v)} />
        <div className="row">
          <Num label={t('p.supplierDiscount')} value={p.supplierDiscountPct} onChange={(v) => set('supplierDiscountPct', v)} min={0} max={50} />
          <Num label={t('p.deliveryFee')} value={p.deliveryFee} onChange={(v) => set('deliveryFee', v)} min={0} step={10} />
        </div>
        <label className="field">
          <span>{t('p.notes')}</span>
          <textarea value={p.notes} rows={3} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </Group>
    </div>
  );
}

function moveVertex(poly: Pt[], i: number, v: Pt): Pt[] {
  const n = poly.length;
  const out = poly.map((p) => ({ ...p }));
  const old = poly[i];
  const pi = (i - 1 + n) % n;
  const ni = (i + 1) % n;
  out[i] = { ...v };
  if (Math.abs(poly[pi].y - old.y) < 0.5) out[pi].y = v.y;
  else out[pi].x = v.x;
  if (Math.abs(poly[ni].y - old.y) < 0.5) out[ni].y = v.y;
  else out[ni].x = v.x;
  return out;
}

function SelectionPanel() {
  const { project, design, ui, setUi, updateProject } = useApp();
  const { t } = useT();
  const sel = ui.selection;
  const poly = project.deck;
  const E = poly.length >= 4 ? polyEdges(poly) : [];

  const applyPoly = (next: Pt[]) => {
    const norm = normalizePolygon(next);
    if (!validatePolygon(norm).ok || norm.length !== poly.length) return;
    updateProject((p) => ({ ...p, deck: norm }), true);
  };

  if (!sel) return <p className="muted">{t('sel.none')}</p>;

  if (sel.type === 'vertex' && poly[sel.index]) {
    const v = poly[sel.index];
    return (
      <Group title={t('sel.vertex', { n: sel.index + 1 })}>
        <div className="row">
          <Num label={t('sel.x')} value={v.x} onChange={(x) => applyPoly(moveVertex(poly, sel.index, { x, y: v.y }))} step={10} />
          <Num label={t('sel.y')} value={v.y} onChange={(y) => applyPoly(moveVertex(poly, sel.index, { x: v.x, y }))} step={10} />
        </div>
      </Group>
    );
  }

  if (sel.type === 'edge' && E[sel.index]) {
    const e = E[sel.index];
    const isHouse = project.houseEdges.includes(e.index);
    const override = project.params.balustrade.edgeOverride[String(e.index)];
    const stairsHere = project.stairs.filter((s) => s.edgeIndex === e.index);
    const setLength = (L: number) => {
      if (L < 100) return;
      const b = { x: e.a.x + e.dir.x * L, y: e.a.y + e.dir.y * L };
      applyPoly(moveVertex(poly, (e.index + 1) % poly.length, b));
    };
    const dirName = e.outward.x > 0 ? '→ +X' : e.outward.x < 0 ? '← -X' : e.outward.y > 0 ? '↓ +Y' : '↑ -Y';
    return (
      <div>
        <Group title={t('sel.edge', { n: e.index + 1 })}>
          <small>{t('sel.edgeInfo', { dir: dirName })}</small>
          <Num label={t('sel.length')} value={Math.round(e.length)} onChange={setLength} step={10} min={100} />
          <Chk
            label={t('sel.touchesHouse')}
            checked={isHouse}
            onChange={(v) =>
              updateProject(
                (p) => ({
                  ...p,
                  houseEdges: v ? [...new Set([...p.houseEdges, e.index])] : p.houseEdges.filter((i) => i !== e.index),
                  stairs: v ? p.stairs.filter((s) => s.edgeIndex !== e.index) : p.stairs,
                }),
                true,
              )
            }
          />
          {!isHouse && (
            <Sel
              label={t('sel.balustrade')}
              value={override === undefined ? 'auto' : override ? 'on' : 'off'}
              options={[
                { value: 'auto', label: t('sel.bal.auto') },
                { value: 'on', label: t('sel.bal.on') },
                { value: 'off', label: t('sel.bal.off') },
              ]}
              onChange={(v) =>
                updateProject((p) => {
                  const edgeOverride = { ...p.params.balustrade.edgeOverride };
                  if (v === 'auto') delete edgeOverride[String(e.index)];
                  else edgeOverride[String(e.index)] = v === 'on';
                  return { ...p, params: { ...p.params, balustrade: { ...p.params.balustrade, edgeOverride } } };
                })
              }
            />
          )}
        </Group>
        <Group title={t('sel.stairs')}>
          {isHouse ? (
            <small>{t('sel.houseEdgeStairs')}</small>
          ) : (
            <button
              className="btn"
              onClick={() => {
                const width = Math.min(project.params.stairWidth, e.length);
                let n = 1;
                for (const s of project.stairs) {
                  const m = /^S(\d+)$/.exec(s.id);
                  if (m) n = Math.max(n, Number(m[1]) + 1);
                }
                const id = `S${n}`;
                updateProject((p) => ({ ...p, stairs: [...p.stairs, { id, edgeIndex: e.index, offset: Math.max(0, Math.round((e.length - width) / 2 / 10) * 10), width, groundOffset: 0 }] }), true);
                setUi({ selection: { type: 'stair', id } });
              }}
            >
              {t('sel.addStair')}
            </button>
          )}
          {stairsHere.map((s) => (
            <button key={s.id} className="btn ghost" onClick={() => setUi({ selection: { type: 'stair', id: s.id } })}>
              {t('sel.stair', { id: s.id })}
            </button>
          ))}
        </Group>
      </div>
    );
  }

  if (sel.type === 'stair') {
    const s = project.stairs.find((x) => x.id === sel.id);
    if (!s) return <p className="muted">{t('sel.none')}</p>;
    const d = design.stairs.find((x) => x.id === s.id);
    const e = E[s.edgeIndex];
    const upd = (patch: Partial<typeof s>) => updateProject((p) => ({ ...p, stairs: p.stairs.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) }));
    return (
      <Group title={t('sel.stair', { id: s.id })}>
        <small>{t('sel.edge', { n: s.edgeIndex + 1 })}</small>
        <Num label={t('sel.stairOffset')} value={s.offset} onChange={(v) => upd({ offset: Math.max(0, Math.min(v, (e?.length ?? v) - s.width)) })} step={10} min={0} />
        <Num label={t('sel.stairWidth')} value={s.width} onChange={(v) => upd({ width: Math.max(300, v) })} step={50} min={300} />
        <Num label={t('sel.stairGround')} value={s.groundOffset} onChange={(v) => upd({ groundOffset: v })} step={10} />
        {d && (
          <div className="kv">
            <div>
              <span>Risers</span>
              <b>
                {d.risers} x {Math.round(d.riser)}
              </b>
            </div>
            <div>
              <span>Going</span>
              <b>{d.going}</b>
            </div>
            <div>
              <span>2R+G</span>
              <b>{Math.round(d.twoRG)}</b>
            </div>
            <div>
              <span>Run</span>
              <b>{Math.round(d.totalRun)}</b>
            </div>
            <div>
              <span>Stringers</span>
              <b>
                {d.stringerCount} x {d.stringerLength}
              </b>
            </div>
          </div>
        )}
        <button
          className="btn danger"
          onClick={() => {
            updateProject((p) => ({ ...p, stairs: p.stairs.filter((x) => x.id !== s.id) }), true);
            setUi({ selection: null });
          }}
        >
          {t('sel.delete')}
        </button>
      </Group>
    );
  }
  return <p className="muted">{t('sel.none')}</p>;
}

function RulesPanel() {
  const { project, updateProject, saveDefaultRules, lang } = useApp();
  const { t } = useT();
  const r = project.rules;
  const [saved, setSaved] = useState(false);
  const setRules = (fn: (r: RuleSet) => RuleSet) => updateProject((p) => ({ ...p, rules: fn(JSON.parse(JSON.stringify(p.rules))) }));
  const spacings = ['400', '450', '600'];
  const flws = [1800, 2400, 3000, 3600];
  const miscKeys: (keyof RuleSet)[] = [
    'elevatedFactor', 'bearerEdgeInset', 'houseBearerInset', 'postEndSetback', 'minBearerGap', 'braceHeight', 'engineerHeight',
    'lowDeckClearance', 'minGroundClearance', 'balustradeTriggerHeight', 'handrailTriggerRise', 'exemptMaxArea', 'exemptMaxHeight',
    'kerf', 'staggerOffset', 'minBoardPiece', 'boardEndAllowance', 'joistEndAllowance', 'screwsPerCrossing', 'boltsPerPost',
    'ledgerBoltSpacing', 'oilCoverage', 'oilCoats', 'stirrupLift', 'concreteBagYield', 'flushHouseInset', 'battenScrewsPerPost',
    'hangerNails', 'skewNailsPerCrossing',
  ];
  const stairKeys = ['minRiser', 'maxRiser', 'targetRiser', 'minGoing', 'maxGoing', 'min2RG', 'max2RG', 'maxRisers', 'stringerSpacing', 'nosing'] as const;
  return (
    <div>
      <p className="muted">{t('r.intro')}</p>
      <div className="row">
        <button className="btn" onClick={() => setRules(() => defaultRules())}>
          {t('r.reset')}
        </button>
        <button
          className="btn"
          onClick={() => {
            saveDefaultRules();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          {t('r.saveDefault')}
        </button>
      </div>
      {saved && <small className="ok">{t('r.saved')}</small>}
      <Group title={t('r.joistSpan')}>
        <table className="rules">
          <thead>
            <tr>
              <th>{t('r.product')}</th>
              {spacings.map((s) => (
                <th key={s}>@{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FRAMING_PRODUCTS.map((p) => (
              <tr key={p.id}>
                <td>{productName(p, lang)}</td>
                {spacings.map((s) => (
                  <td key={s}>
                    <input type="number" step={50} value={r.joistSpan[p.id]?.[s] ?? 0} onChange={(e) => setRules((rr) => { rr.joistSpan[p.id] = { ...(rr.joistSpan[p.id] ?? {}), [s]: Number(e.target.value) }; return rr; })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Group>
      <Group title={t('r.bearerSpan')}>
        <table className="rules">
          <thead>
            <tr>
              <th>{t('r.product')}</th>
              {flws.map((f) => (
                <th key={f}>
                  {t('r.flw')} {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FRAMING_PRODUCTS.flatMap((p) =>
              [1, 2].map((lam) => {
                const key = `${p.id}|${lam}`;
                const table = r.bearerSpan[key] ?? flws.map((f) => ({ flw: f, span: 0 }));
                return (
                  <tr key={key}>
                    <td>
                      {lam}/{productName(p, lang)}
                    </td>
                    {flws.map((f, i) => (
                      <td key={f}>
                        <input
                          type="number"
                          step={50}
                          value={table[i]?.span ?? 0}
                          onChange={(e) =>
                            setRules((rr) => {
                              const tbl = rr.bearerSpan[key] ?? flws.map((x) => ({ flw: x, span: 0 }));
                              tbl[i] = { flw: f, span: Number(e.target.value) };
                              rr.bearerSpan[key] = tbl;
                              return rr;
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </Group>
      <Group title={t('r.postMax')}>
        {POST_PRODUCTS.map((p) => (
          <Num key={p.id} label={productName(p, lang)} value={r.postMaxHeight[p.id] ?? 0} step={100} onChange={(v) => setRules((rr) => { rr.postMaxHeight[p.id] = v; return rr; })} />
        ))}
      </Group>
      <Group title={t('r.deckingSpacing')}>
        {DECKING_PRODUCTS.map((p) => (
          <Num key={p.id} label={productName(p, lang)} value={r.deckingMaxJoistSpacing[p.id] ?? 450} step={50} onChange={(v) => setRules((rr) => { rr.deckingMaxJoistSpacing[p.id] = v; return rr; })} />
        ))}
      </Group>
      <Group title={t('r.stair')}>
        {stairKeys.map((k) => (
          <Num key={k} label={t(`r.${k}`)} value={r.stair[k]} onChange={(v) => setRules((rr) => { rr.stair[k] = v; return rr; })} />
        ))}
      </Group>
      <Group title={t('r.misc')}>
        {miscKeys.map((k) => (
          <Num key={k} label={t(`r.${k}`)} value={r[k] as number} step={k === 'elevatedFactor' || k === 'concreteBagYield' ? 0.01 : 1} onChange={(v) => setRules((rr) => ({ ...rr, [k]: v }))} />
        ))}
      </Group>
    </div>
  );
}

function PricesPanel() {
  const { project, updateProject, saveDefaultPrices, lang } = useApp();
  const { t } = useT();
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <p className="muted">{t('pr.intro')}</p>
      <div className="row">
        <button className="btn" onClick={() => updateProject((p) => ({ ...p, prices: {} }))}>
          {t('pr.reset')}
        </button>
        <button
          className="btn"
          onClick={() => {
            saveDefaultPrices();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          {t('pr.saveDefault')}
        </button>
      </div>
      {saved && <small className="ok">{t('r.saved')}</small>}
      <table className="rules prices">
        <thead>
          <tr>
            <th>{t('pr.item')}</th>
            <th>{t('pr.unit')}</th>
            <th>{t('pr.price')}</th>
          </tr>
        </thead>
        <tbody>
          {CATALOG.map((p) => (
            <tr key={p.id}>
              <td>
                {productName(p, lang)}
                {p.packSize ? <small className="muted"> · {t('pr.pack', { n: p.packSize })}</small> : null}
                {p.ref ? <small className="muted"> · {p.ref}</small> : null}
              </td>
              <td>{t(`unit.${p.unit}`)}</td>
              <td>
                <input type="number" step={0.1} min={0} value={project.prices[p.id] ?? p.defaultPrice} onChange={(e) => updateProject((pr) => ({ ...pr, prices: { ...pr.prices, [p.id]: Number(e.target.value) } }))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WarningList({ warnings }: { warnings: { severity: string; key: string; params?: Record<string, string | number> }[] }) {
  const { t } = useT();
  return (
    <ul className="warnings">
      {warnings.map((w, i) => (
        <li key={i} className={`sev-${w.severity}`}>
          <b>{t(`sev.${w.severity}`)}</b> {t(w.key, w.params)}
        </li>
      ))}
    </ul>
  );
}

function ResultsPanel() {
  const { design, setUi } = useApp();
  const { t } = useT();
  if (!design.ok || !design.layout) {
    return (
      <div>
        <p className="muted">{t('res.invalid')}</p>
        <WarningList warnings={design.warnings} />
      </div>
    );
  }
  const lay = design.layout;
  const items: [string, string][] = [
    [t('res.area'), `${design.areaM2.toFixed(2)} m²`],
    [t('res.perimeter'), `${design.perimeterM.toFixed(1)} m`],
    [t('res.posts'), String(lay.posts.length)],
    [t('res.bearers'), String(lay.bearers.length)],
    [t('res.joists'), String(lay.joists.length)],
    [t('res.boards'), `${(lay.totals.boardLm / 1000).toFixed(1)} m`],
    [t('res.rows'), String(lay.totals.boardRows)],
    [t('res.screws'), String(lay.totals.screws)],
    [t('res.cost'), money(design.bom.total)],
  ];
  return (
    <div>
      <Group title={t('res.summary')}>
        <div className="kv">
          {items.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </Group>
      <Group title={t('res.levels')}>
        <div className="kv">
          <div>
            <span>{t('lvl.joistTop')}</span>
            <b>{Math.round(design.levels.joistTop)}</b>
          </div>
          <div>
            <span>{t('lvl.bearerTop')}</span>
            <b>{Math.round(design.levels.bearerTop)}</b>
          </div>
          <div>
            <span>{t('lvl.postTop')}</span>
            <b>{Math.round(design.levels.postTop)}</b>
          </div>
          <div>
            <span>{t('lvl.clearance')}</span>
            <b>{Math.round(design.levels.groundClearance)}</b>
          </div>
        </div>
      </Group>
      <Group title={t('res.pathway')}>
        <p className={design.pathway === 'exemptPossible' ? 'ok' : 'warn'}>{t(`pathway.${design.pathway}`)}</p>
      </Group>
      <Group title={t('res.warnings')}>
        <WarningList warnings={design.warnings} />
      </Group>
      <button className="btn primary" onClick={() => setUi({ mode: 'sheets' })}>
        {t('res.viewSheets')}
      </button>
    </div>
  );
}
