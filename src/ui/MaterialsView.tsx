import { useState } from 'react';
import { productName, useT } from '../i18n';
import { useApp } from '../state';
import { exportCsv, exportProjectJson, exportXlsx } from '../utils/export';
import { supplierOrderText } from '../utils/order';
import { BomTable } from './BomTable';
import { PricesPanel } from './SidePanel';

/** Bill of materials, the supplier order text, exports and the price list, on one screen page. */
export function MaterialsView() {
  const { project, design, lang } = useApp();
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  if (!design.ok) {
    return (
      <div className="materials-wrap">
        <p className="muted">{t('res.invalid')}</p>
      </div>
    );
  }
  const order = supplierOrderText(project, design, lang);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the text stays selectable */
    }
  };
  return (
    <div className="materials-wrap">
      <div className="materials-head">
        <h2>{t('mat.bom')}</h2>
        <div className="steps-actions">
          <button className="btn" onClick={() => void exportXlsx(project, design, lang)}>
            {t('app.exportXlsx')}
          </button>
          <button className="btn" onClick={() => exportCsv(project, design, lang)}>
            {t('app.exportCsv')}
          </button>
          <button className="btn" onClick={() => exportProjectJson(project)}>
            {t('app.exportJson')}
          </button>
        </div>
      </div>
      <div className="materials-grid">
        <section className="card bom-card">
          <BomTable design={design} params={project.params} />
        </section>
        <section className="card order-card">
          <h3>{t('mat.order')}</h3>
          <p className="hint">{t('mat.orderHint')}</p>
          <textarea className="order" value={order} readOnly rows={Math.min(24, order.split('\n').length + 1)} />
          <button className="btn primary" onClick={() => void copy()}>
            {copied ? t('mat.copied') : t('mat.copy')}
          </button>
        </section>
      </div>
      <details className="card details-card">
        <summary>{t('mat.cut')}</summary>
        <div className="cut-grid screen">
          {design.bom.cutlists.map((c) => (
            <table key={c.productId} className="sch cut">
              <thead>
                <tr>
                  <th colSpan={4}>
                    {productName(c.productId, lang)} · {t('cut.waste')} {c.wastePct.toFixed(0)}%
                    {design.layout?.rips.length && c.productId === project.params.deckingProductId ? ` · ${design.layout.rips.map((r) => t('cut.rip', { n: r.boards, width: r.width })).join('；')}` : ''}
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
      </details>
      <details className="card details-card">
        <summary>{t('mat.prices')}</summary>
        <PricesPanel />
      </details>
    </div>
  );
}
