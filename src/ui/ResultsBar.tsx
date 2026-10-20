import { useT } from '../i18n';
import { PRODUCT_MAP, sizeLabel } from '../model/catalog';
import { useApp } from '../state';
import { money } from '../utils/format';

/** Quantities, price and the three things people do next. Updates with every edit. */
export function ResultsBar() {
  const { project, design, setUi } = useApp();
  const { t, lang } = useT();
  const p = project.params;

  if (!design.ok || !design.layout) {
    return (
      <div className="results">
        <div className="card empty">{project.deck.length >= 4 ? t('res.invalid') : t('res.noDeck')}</div>
      </div>
    );
  }
  const lay = design.layout;
  const lines = design.bom.lines;
  const byTag = (tag: string) => lines.find((l) => l.tags.includes(tag));
  const deckLine = byTag('decking');
  const edgeLine = byTag('edgeBoard');
  const clipLine = byTag('clip');
  const screwLine = lines.find((l) => /^screw-(colour|deck)/.test(l.productId));
  const concreteLine = lines.find((l) => l.category === 'concrete');
  const boxes = (qty: number, id: string) => Math.ceil(qty / (PRODUCT_MAP[id]?.packSize ?? 1));
  const reminders = design.warnings.filter((w) => w.severity === 'error' || w.severity === 'warn');
  const first = reminders[0];

  const kpis: { v: string; k: string }[] = [
    { v: String(lay.posts.length), k: t('res.kpi.posts', { post: sizeLabel(design.postProductId) }) },
    ...(deckLine ? [{ v: t('res.kpi.pcs', { n: deckLine.qty }), k: t('res.kpi.boards', { len: (lay.totals.boardLm / 1000).toFixed(1) }) }] : []),
    ...(edgeLine ? [{ v: t('res.kpi.pcs', { n: edgeLine.qty }), k: t('res.kpi.edgeBoards', { n: lay.totals.mitres }) }] : []),
    { v: t('res.kpi.pieces', { n: lay.joists.length }), k: t('res.kpi.joists', { size: sizeLabel(p.joistProductId), spacing: design.joistSpacingText }) },
    { v: t('res.kpi.pieces', { n: lay.bearers.length }), k: t('res.kpi.bearers', { size: sizeLabel(p.bearerProductId) }) },
    ...(concreteLine ? [{ v: t('res.kpi.bags', { n: concreteLine.qty }), k: PRODUCT_MAP[concreteLine.productId].name[lang] }] : []),
    ...(clipLine ? [{ v: t('res.kpi.boxes', { n: boxes(clipLine.qty, clipLine.productId) }), k: t('res.kpi.clips', { n: clipLine.qty }) }] : []),
    ...(screwLine ? [{ v: t('res.kpi.boxes', { n: boxes(screwLine.qty, screwLine.productId) }), k: t('res.kpi.screws', { n: screwLine.qty }) }] : []),
  ];

  const print = () => {
    setUi({ mode: 'sheets' });
    window.setTimeout(() => window.print(), 700);
  };

  return (
    <div className="results">
      <div className="card">
        <div className="card-head">
          <b>{t('res.thisDeck')}</b>
          <span>
            {design.areaM2.toFixed(1)} m² · {t('res.spacing', { s: design.joistSpacingText, span: Math.round(lay.maxBearerSpanUsed) || '-' })}
          </span>
        </div>
        <div className="kpis">
          {kpis.map((k, i) => (
            <div className="kpi" key={i}>
              <b>{k.v}</b>
              <span>{k.k}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card price">
        <div className="prow">
          <span>{t('res.subtotal')}</span>
          <span>{money(design.bom.linesTotal)}</span>
        </div>
        {design.bom.discount > 0 && (
          <div className="prow">
            <span>{t('res.discount', { pct: p.supplierDiscountPct })}</span>
            <span>−{money(design.bom.discount)}</span>
          </div>
        )}
        {design.bom.delivery > 0 && (
          <div className="prow">
            <span>{t('res.delivery')}</span>
            <span>{money(design.bom.delivery)}</span>
          </div>
        )}
        <div className="ptotal">
          <span>{design.bom.pricesIncludeGst ? t('res.total') : t('res.totalEx')}</span>
          <b>{money(design.bom.pricesIncludeGst ? design.bom.total : design.bom.exGst)}</b>
        </div>
        <p className="hint">{t('res.priceHint')}</p>
      </div>

      <button className="btn primary big" onClick={print}>
        {t('res.printSheets')}
      </button>
      <button className="btn big" onClick={() => setUi({ mode: 'materials' })}>
        {t('res.order')}
      </button>
      <button className="btn big" onClick={() => setUi({ mode: 'steps' })}>
        {t('res.toSteps')}
      </button>

      {reminders.length > 0 && first && (
        <button type="button" className={`reminder ${first.severity}`} onClick={() => setUi({ mode: 'steps' })}>
          <b>{t('res.reminders', { n: reminders.length })}</b>
          <span>{t(first.key, first.params)}</span>
          <small>{t('res.allReminders')}</small>
        </button>
      )}
    </div>
  );
}
