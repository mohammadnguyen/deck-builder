import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { PRODUCT_MAP, sizeLabel } from '../model/catalog';
import { useApp } from '../state';
import { money } from '../utils/format';
import { savingTips, type SavingTip } from '../utils/tips';

/** Quantities, price and the three things people do next. Updates with every edit. */
export function ResultsBar() {
  const { project, design, setUi, updateProject } = useApp();
  const { t, lang } = useT();
  const p = project.params;
  // ways to save: priced by designing them, once editing has stopped (never while a corner is dragged)
  const [tips, setTips] = useState<SavingTip[]>([]);
  useEffect(() => {
    setTips([]);
    if (!design.ok) return;
    const id = window.setTimeout(() => setTips(savingTips(project, design)), 700);
    return () => window.clearTimeout(id);
  }, [project, design]);

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
    { v: t('res.kpi.pieces', { n: lay.joists.length }), k: t('res.kpi.joists', { size: sizeLabel(design.frame.joistProductId), spacing: design.joistSpacingText }) },
    { v: t('res.kpi.pieces', { n: lay.bearers.length }), k: t('res.kpi.bearers', { size: `${design.frame.bearerLaminations === 2 ? '2/' : ''}${sizeLabel(design.frame.bearerProductId)}` }) },
    ...(concreteLine ? [{ v: t('res.kpi.bags', { n: concreteLine.qty }), k: PRODUCT_MAP[concreteLine.productId].name[lang] }] : []),
    ...(clipLine ? [{ v: t('res.kpi.boxes', { n: boxes(clipLine.qty, clipLine.productId) }), k: t('res.kpi.clips', { n: clipLine.qty }) }] : []),
    ...(screwLine ? [{ v: t('res.kpi.boxes', { n: boxes(screwLine.qty, screwLine.productId) }), k: t('res.kpi.screws', { n: screwLine.qty }) }] : []),
  ];

  const tipText = (tip: SavingTip): string => {
    const price = Math.abs(tip.saving) < 1 ? t('tip.same') : tip.saving > 0 ? t('tip.less', { money: money(tip.saving) }) : t('tip.more', { money: money(-tip.saving) });
    if (tip.kind === 'axis') return t('tip.axis', { dir: t(`p.boardAxis.${tip.axis}`), price });
    const [a, b] = [tip.from!, tip.to!];
    const area = (b[0] * b[1] - a[0] * a[1]) / 1e6;
    return t(tip.kind === 'breaker' ? 'tip.breaker' : tip.kind === 'nest' ? 'tip.nest' : 'tip.rip', {
      from: `${a[0]} × ${a[1]}`,
      to: `${b[0]} × ${b[1]}`,
      price,
      area: t('tip.area', { m2: `${area > 0 ? '+' : '−'}${Math.abs(area).toFixed(2)}` }),
    });
  };

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

      {tips.length > 0 && (
        <div className="card tips">
          <b>{t('tip.title')}</b>
          {tips.map((tip, i) => (
            <div className="tip" key={i}>
              <span>{tipText(tip)}</span>
              <button type="button" className="btn" onClick={() => updateProject(tip.apply, 'h.tip')}>
                {t('tip.apply')}
              </button>
            </div>
          ))}
        </div>
      )}

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
