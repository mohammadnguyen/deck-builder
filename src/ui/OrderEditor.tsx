import { Fragment, useState } from 'react';
import type { BomLine } from '../engine/bom';
import { productName, useT } from '../i18n';
import { CATALOG, PRODUCT_MAP, stockLengthsOf } from '../model/catalog';
import type { ProductCategory, Unit } from '../model/types';
import { useApp } from '../state';
import { money, stockLabel } from '../utils/format';
import { lineName } from '../utils/order';
import { asCalculated, withAdded, withoutLine, withPrice, withQty, withStock } from '../utils/orderEdits';
import { NumInline } from './fields';

const CATS: ProductCategory[] = ['decking', 'framing', 'post', 'balustrade', 'hardware', 'concrete', 'consumable', 'other'];
const UNITS: Unit[] = ['ea', 'm', 'm2', 'm3', 'L', 'bag', 'roll'];

/** pieces per box for products sold in boxes (timber sold by the metre is ordered by stock length instead) */
const packOf = (l: BomLine): number => {
  const prod = l.productId ? PRODUCT_MAP[l.productId] : undefined;
  return prod && prod.unit !== 'm' && prod.packSize ? prod.packSize : 0;
};

/**
 * The order list, editable: quantities (stock lengths for timber, boxes for screws and clips), unit
 * prices, taking lines off and putting them back, and adding catalogue products or anything else by name.
 * The calculated list stays the starting point; a changed line shows what was calculated.
 */
export function OrderEditor() {
  const { project, design, updateProject } = useApp();
  const { t, lang } = useT();
  const bom = design.bom;
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const groups = CATS.map((c) => [c, bom.lines.filter((l) => l.category === c)] as const).filter(([, ls]) => ls.length > 0);
  const changed = !!project.order && (Object.keys(project.order.lines).length > 0 || project.order.added.length > 0);
  let n = 0;
  return (
    <div className="order-edit">
      <p className="hint">{t('ord.hint')}</p>
      <div className="bom-scroll">
        <table className="bom edit">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('bom.item')}</th>
              <th>{t('bom.qty')}</th>
              <th>{t('bom.price')}</th>
              <th>{t('bom.total')}</th>
              <th aria-label={t('ord.delete')} />
            </tr>
          </thead>
          <tbody>
            {groups.map(([cat, ls]) => (
              <Fragment key={cat}>
                <tr className="cat">
                  <td colSpan={6}>{t(`bom.cat.${cat}`)}</td>
                </tr>
                {ls.map((l) => (
                  <OrderRow key={l.key} n={++n} line={l} flash={flash === l.key} />
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>{t('bom.subtotal')}</td>
              <td colSpan={2}>{money(bom.linesTotal)}</td>
            </tr>
            {bom.discount > 0 && (
              <tr>
                <td colSpan={4}>
                  {t('bom.discount')} {project.params.supplierDiscountPct}%
                </td>
                <td colSpan={2}>-{money(bom.discount)}</td>
              </tr>
            )}
            {bom.delivery > 0 && (
              <tr>
                <td colSpan={4}>{t('bom.delivery')}</td>
                <td colSpan={2}>{money(bom.delivery)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4}>
                {t('bom.gst')} {project.params.gstPct}%{bom.pricesIncludeGst ? ` (${t('bom.gstIncluded')})` : ''}
              </td>
              <td colSpan={2}>{money(bom.gst)}</td>
            </tr>
            <tr className="grand">
              <td colSpan={4}>{bom.pricesIncludeGst ? `${t('bom.grand')} (${t('bom.gstIncluded')})` : t('bom.grand')}</td>
              <td colSpan={2}>{money(bom.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {bom.removed.length > 0 && (
        <p className="order-removed">
          <span>{t('ord.removed')}</span>
          {bom.removed.map((l) => (
            <span key={l.key} className="chip">
              {lineName(l, lang)}
              <button type="button" className="linkish" onClick={() => updateProject((p) => ({ ...p, order: asCalculated(p, l.productId) }), 'h.orderRestore')}>
                {t('ord.restore')}
              </button>
            </span>
          ))}
        </p>
      )}
      <div className="order-actions">
        {adding ? (
          <AddItem
            onDone={(key) => {
              setAdding(false);
              if (key) setFlash(key);
            }}
          />
        ) : (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            {t('ord.add')}
          </button>
        )}
        {changed && !adding && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (window.confirm(t('ord.resetAllConfirm'))) updateProject((p) => ({ ...p, order: p.order?.note ? { lines: {}, added: [], note: p.order.note } : null }), 'h.orderReset');
            }}
          >
            {t('ord.resetAll')}
          </button>
        )}
      </div>
    </div>
  );
}

function OrderRow({ n, line, flash }: { n: number; line: BomLine; flash: boolean }) {
  const { project, updateProject } = useApp();
  const { t, lang } = useT();
  const prod = line.productId ? PRODUCT_MAP[line.productId] : undefined;
  const timber = !!prod && line.unit === 'm';
  const pack = packOf(line);
  const order = (fn: Parameters<typeof updateProject>[0], label = 'h.order') => updateProject(fn, label);
  const freeLengths = timber ? [...stockLengthsOf(prod, project.rules)].sort((a, b) => b - a).filter((len) => !(line.stockBreakdown ?? []).some((s) => s.length === len)) : [];
  const calcText = line.calcQty === undefined ? '' : timber && line.calcStock ? stockLabel(line.calcStock) : pack ? `${Math.ceil(line.calcQty / pack)} ${t('unitName.box')}` : `${line.calcQty} ${t(`unitName.${line.unit}`)}`;
  return (
    <tr className={`${line.edited ? 'edited' : ''} ${line.addedId ? 'added' : ''} ${flash ? 'flash' : ''}`}>
      <td>{n}</td>
      <td className="name">
        <div>{lineName(line, lang)}</div>
        <div className="sub">
          {line.tags.map((x) => t(`tag.${x}`)).join(', ')}
          {!line.edited && !line.addedId && timber && line.requiredLm !== undefined ? ` · ${t('ord.need', { m: line.requiredLm.toFixed(1), waste: (line.cutWastePct ?? 0).toFixed(0) })}` : ''}
          {!line.edited && !line.addedId && line.extraCount ? ` · ${t('bom.extra', { n: line.extraCount })}` : ''}
          {line.edited && (
            <>
              {' · '}
              <span className="calc">{t('ord.calc', { qty: calcText })}</span>{' '}
              <button type="button" className="linkish" onClick={() => order((p) => ({ ...p, order: asCalculated(p, line.productId) }), 'h.orderReset')}>
                {t('ord.reset')}
              </button>
            </>
          )}
        </div>
      </td>
      <td className="qty">
        {timber ? (
          <div className="stock">
            {(line.stockBreakdown ?? []).map((s) => (
              <label key={s.length} className="len">
                <span>{(s.length / 1000).toFixed(1)}m ×</span>
                <NumInline value={s.count} step={1} min={0} onCommit={(v) => order((p) => ({ ...p, order: withStock(p, line, s.length, v) }))} />
              </label>
            ))}
            {freeLengths.length > 0 && (
              <select
                className="add-len"
                value=""
                aria-label={t('ord.addLength')}
                onChange={(e) => {
                  const len = Number(e.target.value);
                  if (len) order((p) => ({ ...p, order: withStock(p, line, len, 1) }));
                }}
              >
                <option value="">{t('ord.addLength')}</option>
                {freeLengths.map((len) => (
                  <option key={len} value={len}>
                    {(len / 1000).toFixed(1)} m
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : pack ? (
          <label className="len">
            <NumInline value={Math.ceil(line.qty / pack)} step={1} min={0} onCommit={(v) => order((p) => ({ ...p, order: withQty(p, line, Math.round(v) * pack) }))} />
            <span>{t('ord.boxes', { size: pack })}</span>
          </label>
        ) : (
          <label className="len">
            <NumInline value={line.qty} step={line.unit === 'L' ? 0.1 : 1} min={0} onCommit={(v) => order((p) => ({ ...p, order: withQty(p, line, v) }))} />
            <span>{t(`unitName.${line.unit}`)}</span>
          </label>
        )}
      </td>
      <td className="price">
        <NumInline value={Math.round(line.unitPrice * 100) / 100} step={0.01} min={0} onCommit={(v) => order((p) => ({ ...p, ...withPrice(p, line, v) }), 'h.price')} />
        <small>{t(`unit.${line.unit}`)}</small>
      </td>
      <td className="total">{money(line.total)}</td>
      <td>
        <button type="button" className="del" title={t('ord.delete')} aria-label={t('ord.delete')} onClick={() => order((p) => ({ ...p, order: withoutLine(p, line) }), 'h.orderRemove')}>
          ×
        </button>
      </td>
    </tr>
  );
}

function AddItem({ onDone }: { onDone: (key: string | null) => void }) {
  const { project, design, updateProject } = useApp();
  const { t, lang } = useT();
  const [pid, setPid] = useState('');
  const [len, setLen] = useState(0);
  const [qty, setQty] = useState('1');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('ea');
  const [price, setPrice] = useState('');
  const custom = pid === 'custom';
  const prod = pid && !custom ? PRODUCT_MAP[pid] : undefined;
  const timber = prod?.unit === 'm';
  const lengths = timber ? [...stockLengthsOf(prod, project.rules)].sort((a, b) => b - a) : [];
  const pack = prod && !timber && prod.packSize ? prod.packSize : 0;
  const q = Number(qty);
  const ready = Number.isFinite(q) && q > 0 && (custom ? name.trim().length > 0 : !!prod);
  const add = () => {
    if (!ready) return;
    let key: string | null = null;
    updateProject((p) => {
      const r = withAdded(
        p,
        design,
        custom
          ? { name, unit, unitPrice: Number(price) || 0, qty: q }
          : { productId: prod!.id, qty: pack ? Math.round(q) * pack : timber ? Math.round(q) : q, length: timber ? len || lengths[0] : undefined },
      );
      key = r.key;
      return { ...p, order: r.order };
    }, 'h.orderAdd');
    onDone(key);
  };
  return (
    <div className="add-item">
      <select
        value={pid}
        onChange={(e) => {
          setPid(e.target.value);
          setLen(0);
        }}
        aria-label={t('ord.choose')}
      >
        <option value="">{t('ord.choose')}</option>
        {CATS.filter((c) => c !== 'other').map((c) => {
          const ps = CATALOG.filter((p) => p.category === c);
          return ps.length ? (
            <optgroup key={c} label={t(`bom.cat.${c}`)}>
              {ps.map((p) => (
                <option key={p.id} value={p.id}>
                  {productName(p, lang)}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
        <option value="custom">{t('ord.custom')}</option>
      </select>
      {custom && (
        <>
          <input className="name" placeholder={t('ord.name')} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('ord.name')} />
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label={t('bom.unit')}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`unitName.${u}`)}
              </option>
            ))}
          </select>
          <input type="number" min={0} step={0.01} placeholder={t('ord.price')} value={price} onChange={(e) => setPrice(e.target.value)} aria-label={t('ord.price')} />
        </>
      )}
      {timber && (
        <select value={len || lengths[0]} onChange={(e) => setLen(Number(e.target.value))} aria-label={t('ord.length')}>
          {lengths.map((l) => (
            <option key={l} value={l}>
              {(l / 1000).toFixed(1)} m
            </option>
          ))}
        </select>
      )}
      {pid && (
        <label className="len">
          <input type="number" min={0} step={timber || pack ? 1 : 0.1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t('ord.qty')} />
          <span>{timber ? t('unit.pcs') : pack ? t('ord.boxes', { size: pack }) : custom ? t(`unitName.${unit}`) : t(`unitName.${prod?.unit ?? 'ea'}`)}</span>
        </label>
      )}
      <button type="button" className="btn primary" disabled={!ready} onClick={add}>
        {t('ord.addBtn')}
      </button>
      <button type="button" className="btn ghost" onClick={() => onDone(null)}>
        {t('ord.cancel')}
      </button>
    </div>
  );
}
