import { useMemo, useState } from 'react';
import { computeDesign } from '../engine';
import { useT } from '../i18n';
import { useApp } from '../state';
import { exportCsv, exportProjectJson, exportXlsx } from '../utils/export';
import { money } from '../utils/format';
import { supplierOrderText } from '../utils/order';
import { withNote } from '../utils/orderEdits';
import { CutDiagrams } from './CutDiagram';
import { OrderEditor } from './OrderEditor';
import { PricesPanel } from './SidePanel';

/** Bill of materials, the supplier order text, exports and the price list, on one screen page. */
export function MaterialsView() {
  const { project, design, lang, updateProject } = useApp();
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  // the framing cut simply (each stick into one length, few lengths) or for the least timber: what the other way costs
  const simple = project.rules.cutting !== 'cheapest';
  const otherTotal = useMemo(() => {
    if (!design.ok) return null;
    const other = computeDesign({ ...project, rules: { ...project.rules, cutting: simple ? 'cheapest' : 'simple' } });
    return other.ok ? other.bom.total : null;
  }, [project, design, simple]);
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
      <div className="cut-mode">
        <b>{t('cutmode.label')}</b>
        <div className="seg">
          {(['simple', 'cheapest'] as const).map((m) => (
            <button key={m} type="button" className={(m === 'simple') === simple ? 'on' : ''} onClick={() => updateProject((p) => ({ ...p, rules: { ...p.rules, cutting: m } }), 'h.cutMode')}>
              {t(`cutmode.${m}`)}
            </button>
          ))}
        </div>
        <small>
          {t(simple ? 'cutmode.simpleHint' : 'cutmode.cheapestHint', { saving: project.rules.extraLengthSaving ?? 50 })}{' '}
          {otherTotal !== null && Math.abs(otherTotal - design.bom.total) >= 1
            ? t(simple ? 'cutmode.costsMore' : 'cutmode.saves', { diff: money(Math.abs(otherTotal - design.bom.total)) })
            : otherTotal !== null
              ? t('cutmode.same')
              : ''}
        </small>
      </div>
      <div className="materials-grid">
        <section className="card bom-card">
          <OrderEditor />
        </section>
        <section className="card order-card">
          <h3>{t('mat.order')}</h3>
          <p className="hint">{t('mat.orderHint')}</p>
          <textarea className="order" value={order} readOnly rows={Math.min(24, order.split('\n').length + 1)} />
          <label className="order-note">
            <span>{t('ord.note')}</span>
            <textarea rows={2} value={project.order?.note ?? ''} onChange={(e) => updateProject((p) => ({ ...p, order: withNote(p, e.target.value) }), 'h.orderNote')} />
          </label>
          <button className="btn primary" onClick={() => void copy()}>
            {copied ? t('mat.copied') : t('mat.copy')}
          </button>
        </section>
      </div>
      <details className="card details-card">
        <summary>{t('mat.cut')}</summary>
        <p className="hint">{t('cut.introDrawn')}</p>
        {design.layout?.rips.length ? <p className="hint">{design.layout.rips.map((r) => t(r.notched ? 'cut.notch' : 'cut.rip', { n: r.boards, width: r.width })).join(t('list.sep'))}</p> : null}
        <CutDiagrams design={design} project={project} />
      </details>
      <details className="card details-card">
        <summary>{t('mat.prices')}</summary>
        <PricesPanel />
      </details>
    </div>
  );
}
