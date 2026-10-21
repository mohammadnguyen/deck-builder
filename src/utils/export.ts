import type { DesignResult } from '../engine';
import { lineName } from './order';
import { productName, translate } from '../i18n';
import type { Lang, Project } from '../model/types';
import { PRODUCT_MAP } from '../model/catalog';
import { stockLabel } from './format';

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportProjectJson(project: Project): void {
  downloadBlob(`${safeName(project.name)}.deck.json`, new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
}

function safeName(s: string): string {
  return (s || 'deck').replace(/[^\w一-龥-]+/g, '_');
}

function bomRows(design: DesignResult, lang: Lang): (string | number)[][] {
  const t = (k: string, p?: Record<string, string | number>) => translate(lang, k, p);
  const rows: (string | number)[][] = [[t('bom.item'), t('bom.spec'), t('bom.qty'), t('bom.unit'), t('bom.required'), t('bom.purchased'), t('bom.price'), t('bom.total'), t('bom.use')]];
  for (const l of design.bom.lines) {
    rows.push([
      lineName(l, lang),
      stockLabel(l.stockBreakdown),
      l.qty,
      t(`unit.${l.unit}`),
      l.requiredLm !== undefined ? Number(l.requiredLm.toFixed(1)) : '',
      l.purchasedLm !== undefined ? Number(l.purchasedLm.toFixed(1)) : '',
      Number(l.unitPrice.toFixed(2)),
      Number(l.total.toFixed(2)),
      l.tags.map((x) => t(`tag.${x}`)).join(', '),
    ]);
  }
  rows.push([]);
  rows.push([t('bom.subtotal'), '', '', '', '', '', '', Number(design.bom.linesTotal.toFixed(2))]);
  if (design.bom.discount > 0) rows.push([t('bom.discount'), '', '', '', '', '', '', -Number(design.bom.discount.toFixed(2))]);
  if (design.bom.delivery > 0) rows.push([t('bom.delivery'), '', '', '', '', '', '', Number(design.bom.delivery.toFixed(2))]);
  rows.push([design.bom.pricesIncludeGst ? `${t('bom.gst')} (${t('bom.gstIncluded')})` : t('bom.gst'), '', '', '', '', '', '', Number(design.bom.gst.toFixed(2))]);
  rows.push([t('bom.grand'), '', '', '', '', '', '', Number(design.bom.total.toFixed(2))]);
  return rows;
}

export function exportCsv(project: Project, design: DesignResult, lang: Lang): void {
  const rows = bomRows(design, lang);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(`${safeName(project.name)}-bom.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
}

export async function exportXlsx(project: Project, design: DesignResult, lang: Lang): Promise<void> {
  const XLSX = await import('xlsx');
  const t = (k: string, p?: Record<string, string | number>) => translate(lang, k, p);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bomRows(design, lang)), 'BOM');

  const cut: (string | number)[][] = [[t('cut.product'), t('cut.stock'), t('cut.count'), t('cut.cuts'), t('cut.offcut')]];
  for (const c of design.bom.cutlists) {
    for (const g of c.groups) cut.push([productName(c.productId, lang), g.stock, g.count, g.cuts.join(' + '), Math.round(g.offcut)]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cut), 'CutList');

  const foot: (string | number)[][] = [[t('col.id'), t('col.x'), t('col.y'), t('col.bearer'), t('col.depth')]];
  if (design.layout) {
    for (const p of design.layout.posts) {
      foot.push([p.id, Math.round(p.pt.x - design.datum.x), Math.round(p.pt.y - design.datum.y), p.bearerId, project.params.footingType === 'stump' ? project.params.footingDepth : project.params.padDepth]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(foot), 'Footings');

  const method: (string | number)[][] = [['#', 'Step', 'Notes']];
  design.method.forEach((s, i) => {
    method.push([i + 1, t(s.key, s.params), s.notes.map((n) => t(n.key, n.params)).join('\n')]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(method), 'Method');

  const prices: (string | number)[][] = [[t('pr.item'), t('pr.unit'), t('pr.price')]];
  for (const p of Object.values(PRODUCT_MAP)) prices.push([p.name[lang], t(`unit.${p.unit}`), project.prices[p.id] ?? p.defaultPrice]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prices), 'Prices');

  XLSX.writeFile(wb, `${safeName(project.name)}-deck.xlsx`);
}
