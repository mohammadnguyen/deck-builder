import type { DesignResult } from '../engine';
import type { BomLine } from '../engine/bom';
import { PRODUCT_MAP } from '../model/catalog';
import type { Lang, Project } from '../model/types';
import { productName, translate } from '../i18n';

/** Name of an order line: the catalogue name, or what was typed for an item added by hand. */
export function lineName(l: BomLine, lang: Lang): string {
  return l.productId ? productName(l.productId, lang) : l.name || '-';
}

/** The supplier's own item wording when an invoice reference is known, else the catalogue name. */
export function orderName(productId: string, lang: Lang): string {
  const p = PRODUCT_MAP[productId];
  if (!p) return productId;
  if (p.ref) return p.ref.split(/,| \$/)[0].trim();
  return productName(p, lang);
}

/** Plain-text purchase order grouped the way the supplier sells: stock lengths for timber, boxes for packs. */
export function supplierOrderText(project: Project, design: DesignResult, lang: Lang): string {
  const lines: string[] = [];
  const title = lang === 'zh' ? '订货单' : 'Order';
  lines.push(`${project.name} · ${title} · ${new Date().toISOString().slice(0, 10)}`);
  if (project.client || project.address) lines.push([project.client, project.address].filter(Boolean).join(' · '));
  lines.push('');
  let n = 0;
  for (const l of design.bom.lines) {
    if (!(l.qty > 0)) continue;
    const p = PRODUCT_MAP[l.productId];
    if (!p) {
      // an item added by hand by name
      n++;
      lines.push(`${n}. ${l.name || '-'} — ${l.qty} ${translate(lang, `unitName.${l.unit}`)}`);
      continue;
    }
    n++;
    let qty: string;
    if (p.unit === 'm' && l.stockBreakdown?.length) {
      qty = l.stockBreakdown.map((s) => `${(s.length / 1000).toFixed(1)}m x ${s.count}`).join(', ');
    } else if (p.packSize) {
      const boxes = Math.ceil(l.qty / p.packSize);
      qty = lang === 'zh' ? `${boxes} 盒（${l.qty} 个）` : `${boxes} box${boxes > 1 ? 'es' : ''} (${l.qty} pcs)`;
    } else {
      const unit = lang === 'zh' ? { ea: '个', bag: '袋', roll: '卷', L: 'L', m2: 'm²', m: 'm', m3: 'm³' }[p.unit] : p.unit;
      qty = `${l.qty} ${unit}`;
    }
    lines.push(`${n}. ${orderName(l.productId, lang)} — ${qty}`);
  }
  const note = project.order?.note?.trim();
  if (note) {
    lines.push('');
    lines.push(`${translate(lang, 'ord.noteLabel')}: ${note}`);
  }
  return lines.join('\n');
}
