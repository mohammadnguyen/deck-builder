import type { DesignResult } from '../engine';
import { productName, useT } from '../i18n';
import { PRODUCT_MAP } from '../model/catalog';
import type { DeckParams } from '../model/types';
import { money, stockLabel } from '../utils/format';

/** Bill of materials with the purchase quantities, prices and the GST footer. Used on the sheet and the materials page. */
export function BomTable({ design, params }: { design: DesignResult; params: DeckParams }) {
  const { t } = useT();
  const byCat = new Map<string, typeof design.bom.lines>();
  for (const l of design.bom.lines) byCat.set(l.category, [...(byCat.get(l.category) ?? []), l]);
  return (
    <table className="bom">
      <thead>
        <tr>
          <th>#</th>
          <th>{t('bom.item')}</th>
          <th>{t('bom.spec')}</th>
          <th>{t('bom.qty')}</th>
          <th>{t('bom.unit')}</th>
          <th>{t('bom.required')}</th>
          <th>{t('bom.purchased')}</th>
          <th>{t('bom.waste')}</th>
          <th>{t('bom.price')}</th>
          <th>{t('bom.total')}</th>
          <th>{t('bom.use')}</th>
        </tr>
      </thead>
      <tbody>
        {[...byCat.entries()].map(([cat, lines]) => (
          <CatRows key={cat} cat={cat} lines={lines} offset={design.bom.lines.indexOf(lines[0])} />
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={9}>{t('bom.subtotal')}</td>
          <td colSpan={2}>{money(design.bom.linesTotal)}</td>
        </tr>
        {design.bom.discount > 0 && (
          <tr>
            <td colSpan={9}>
              {t('bom.discount')} {params.supplierDiscountPct}%
            </td>
            <td colSpan={2}>-{money(design.bom.discount)}</td>
          </tr>
        )}
        {design.bom.delivery > 0 && (
          <tr>
            <td colSpan={9}>{t('bom.delivery')}</td>
            <td colSpan={2}>{money(design.bom.delivery)}</td>
          </tr>
        )}
        {design.bom.pricesIncludeGst ? (
          <>
            <tr className="grand">
              <td colSpan={9}>
                {t('bom.grand')} ({t('bom.gstIncluded')})
              </td>
              <td colSpan={2}>{money(design.bom.total)}</td>
            </tr>
            <tr>
              <td colSpan={9}>
                {t('bom.gst')} {params.gstPct}% ({t('bom.gstIncluded')})
              </td>
              <td colSpan={2}>{money(design.bom.gst)}</td>
            </tr>
            <tr>
              <td colSpan={9}>{t('bom.exGst')}</td>
              <td colSpan={2}>{money(design.bom.exGst)}</td>
            </tr>
          </>
        ) : (
          <>
            <tr>
              <td colSpan={9}>
                {t('bom.gst')} {params.gstPct}%
              </td>
              <td colSpan={2}>{money(design.bom.gst)}</td>
            </tr>
            <tr className="grand">
              <td colSpan={9}>{t('bom.grand')}</td>
              <td colSpan={2}>{money(design.bom.total)}</td>
            </tr>
          </>
        )}
      </tfoot>
    </table>
  );
}

function CatRows({ cat, lines, offset }: { cat: string; lines: DesignResult['bom']['lines']; offset: number }) {
  const { t, lang } = useT();
  return (
    <>
      <tr className="cat">
        <td colSpan={11}>{t(`bom.cat.${cat}`)}</td>
      </tr>
      {lines.map((l, i) => (
        <tr key={l.productId}>
          <td>{offset + i + 1}</td>
          <td>{productName(l.productId, lang)}</td>
          <td>{stockLabel(l.stockBreakdown)}</td>
          <td>
            {l.qty}
            {l.extraCount ? <small> ({t('bom.extra', { n: l.extraCount })})</small> : null}
            {PRODUCT_MAP[l.productId]?.packSize ? <small> ({t('bom.packs', { boxes: Math.ceil(l.qty / (PRODUCT_MAP[l.productId].packSize ?? 1)), size: PRODUCT_MAP[l.productId].packSize ?? 1 })})</small> : null}
          </td>
          <td>{PRODUCT_MAP[l.productId]?.unit === 'm' ? 'pcs' : t(`unit.${l.unit}`)}</td>
          <td>{l.requiredLm !== undefined ? l.requiredLm.toFixed(1) : ''}</td>
          <td>{l.purchasedLm !== undefined ? l.purchasedLm.toFixed(1) : ''}</td>
          <td>{l.cutWastePct !== undefined ? `${l.cutWastePct.toFixed(0)}%` : ''}</td>
          <td>
            {money(l.unitPrice)}
            {t(`unit.${l.unit}`)}
          </td>
          <td>{money(l.total)}</td>
          <td>{l.tags.map((x) => t(`tag.${x}`)).join(', ')}</td>
        </tr>
      ))}
    </>
  );
}
