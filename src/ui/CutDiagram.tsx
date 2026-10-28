import { useId } from 'react';
import type { DesignResult } from '../engine';
import type { CutList } from '../engine/bom';
import { productName, useT } from '../i18n';
import { PRODUCT_MAP } from '../model/catalog';
import type { Project } from '../model/types';
import { cutMarks, cutRows, finishedLength, markUse, type CutMarks } from '../utils/cutmarks';

const W = 1000;
const H = 40;

/** One stock stick drawn to scale, cut into its pieces (lettered for framing) with the offcut hatched. */
function Bar({ stock, cuts, offcut, maxStock, productId, marks, project, hatch }: {
  stock: number;
  cuts: number[];
  offcut: number;
  maxStock: number;
  productId: string;
  marks: CutMarks;
  project: Project;
  hatch: string;
}) {
  const k = W / maxStock;
  const kerf = project.rules.kerf;
  let x = 0;
  const segs = cuts.map((cut, i) => {
    const m = marks.of(productId, cut);
    const len = m ? m.length : Math.round(finishedLength(cut, tagsOf(productId, cut, marks), project.rules));
    const w = cut * k;
    const seg = { x, w, label: m ? `${m.mark} ${len}` : String(len), short: m ? m.mark : String(len), i };
    x += w + kerf * k;
    return seg;
  });
  const stockW = stock * k;
  const offW = Math.max(0, stockW - x);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cut-bar" preserveAspectRatio="xMinYMid meet">
      <rect x={0.5} y={6} width={stockW - 1} height={H - 12} fill="#fff" stroke="#6b4a26" strokeWidth={1.5} />
      {segs.map((s) => (
        <g key={s.i}>
          <rect x={s.x + 0.5} y={6} width={Math.max(0, s.w - 1)} height={H - 12} fill="#ecd3a6" stroke="#6b4a26" strokeWidth={1.5} />
          {s.w > s.label.length * 13 + 10 ? (
            <text x={s.x + s.w / 2} y={H / 2 + 6.5} fontSize={19} textAnchor="middle" fontWeight={700} fill="#3b2410">
              {s.label}
            </text>
          ) : s.w > s.short.length * 13 + 4 ? (
            <text x={s.x + s.w / 2} y={H / 2 + 6.5} fontSize={19} textAnchor="middle" fontWeight={700} fill="#3b2410">
              {s.short}
            </text>
          ) : null}
        </g>
      ))}
      {offW > 2 && (
        <g>
          <rect x={x} y={6} width={offW} height={H - 12} fill={`url(#${hatch})`} stroke="#9ca3af" strokeWidth={1} />
          {offW > String(Math.round(offcut)).length * 12 + 8 && (
            <text x={x + offW / 2} y={H / 2 + 6} fontSize={15} textAnchor="middle" fill="#6b7280">
              {Math.round(offcut)}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

/** A spare stick: bought whole and not cut, so the rows add up to the order. */
function SpareBar({ stock, maxStock, label }: { stock: number; maxStock: number; label: string }) {
  const w = (W / maxStock) * stock;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cut-bar" preserveAspectRatio="xMinYMid meet">
      <rect x={0.5} y={6} width={w - 1} height={H - 12} fill="#fff" stroke="#6b4a26" strokeWidth={1.5} strokeDasharray="8 5" />
      {w > label.length * 11 + 10 && (
        <text x={w / 2} y={H / 2 + 6} fontSize={16} textAnchor="middle" fill="#6b4a26">
          {label}
        </text>
      )}
    </svg>
  );
}

function tagsOf(productId: string, cut: number, marks: CutMarks): string[] {
  return marks.of(productId, cut)?.tags ?? [];
}

/**
 * How to cut: for each product, every cutting pattern as a stick drawn to scale with its pieces, and how many
 * sticks are cut that way, then the spare sticks: the rows add up to the order, length for length. Framing pieces
 * carry the letters of the framing plan. In two columns the products are split here, the rows evened out: Safari
 * gives a drawn bar in CSS columns no size, so it drops out of the PDF made from the sheet.
 */
export function CutDiagrams({ design, project, filter, showUses = true, columns = 1 }: { design: DesignResult; project: Project; filter?: (c: CutList) => boolean; showUses?: boolean; columns?: 1 | 2 }) {
  const { t, lang } = useT();
  const hatch = `offcut-${useId().replace(/:/g, '')}`;
  const marks = cutMarks(design, project.rules, project.params.joistConnection === 'flush');
  const lists = design.bom.cutlists.filter((c) => !filter || filter(c));
  // the order of the marks: joists, bearers, other framing, posts, then the rest
  const order = (c: CutList) => {
    const first = marks.marks.findIndex((m) => m.productId === c.productId);
    return first >= 0 ? first : 1000;
  };
  lists.sort((a, b) => order(a) - order(b));
  // the line on the order: the cut and its spare (a line taken off the order: the cut only)
  const lineOf = (c: CutList) => design.bom.lines.find((l) => l.productId === c.productId && !l.addedId);
  const rowsOf = (c: CutList) => cutRows(c.groups, (cut) => marks.of(c.productId, cut)?.mark ?? String(Math.round(cut)), project.rules.kerf);
  const product = (c: CutList) => {
    const line = lineOf(c);
    const off = !line && design.bom.removed.some((l) => l.productId === c.productId);
    const spare = line?.spareStock ?? [];
    const maxStock = Math.max(...c.groups.map((g) => g.stock), ...spare.map((s) => s.length), 1);
    const perLength = new Map<number, number>();
    for (const g of c.groups) perLength.set(g.stock, (perLength.get(g.stock) ?? 0) + g.count);
    for (const s of spare) perLength.set(s.length, (perLength.get(s.length) ?? 0) + s.count);
    const sticks = [...perLength.values()].reduce((n, k) => n + k, 0);
    const lengths = [...perLength.entries()].sort((a, b) => b[0] - a[0]);
    const stockText = lengths.length === 1 ? t('cutd.sticks', { n: sticks, stock: `${(lengths[0][0] / 1000).toFixed(1)} m` }) : t('cutd.sticksMixed', { n: sticks, list: lengths.map(([len, n]) => `${n} × ${(len / 1000).toFixed(1)} m`).join(' + ') });
    const pieceMarks = marks.marks.filter((m) => m.productId === c.productId);
    return (
      <div key={c.productId} className="cut-product">
        <div className="cut-head">
          <b>{productName(c.productId, lang)}</b>
          <span>
            {stockText}
            {line?.extraCount ? ` · ${t('cutd.spare', { n: line.extraCount })}` : ''}
            {off ? ` · ${t('cutd.removed')}` : ''}
          </span>
        </div>
        {showUses && pieceMarks.length > 0 && (
          <div className="cut-keys">
            {pieceMarks.map((m) => (
              <span key={m.mark}>
                <b>{m.mark}</b> {m.length} × {m.count} {t(`cutd.use.${markUse(m)}`)}
              </span>
            ))}
          </div>
        )}
        {rowsOf(c).map((g, i) => (
          <div key={i} className="cut-row">
            <span className="cut-n">{g.count} ×</span>
            <span className="cut-len">{(g.stock / 1000).toFixed(1)} m</span>
            <Bar stock={g.stock} cuts={g.cuts} offcut={g.offcut} maxStock={maxStock} productId={c.productId} marks={marks} project={project} hatch={hatch} />
          </div>
        ))}
        {spare.map((s) => (
          <div key={`spare-${s.length}`} className="cut-row spare">
            <span className="cut-n">{s.count} ×</span>
            <span className="cut-len">{(s.length / 1000).toFixed(1)} m</span>
            <SpareBar stock={s.length} maxStock={maxStock} label={t('cutd.spareRow')} />
          </div>
        ))}
      </div>
    );
  };
  const defs = (
    <svg width={0} height={0} style={{ position: 'absolute' }}>
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={8} stroke="#c4c8ce" strokeWidth={3} />
        </pattern>
      </defs>
    </svg>
  );
  if (columns === 1) {
    return (
      <div className="cut-diagrams">
        {defs}
        {lists.map(product)}
      </div>
    );
  }
  // where the products split so the two columns hold about as many rows (a heading counts as a row)
  const size = lists.map((c) => 1 + (showUses && marks.marks.some((m) => m.productId === c.productId) ? 1 : 0) + rowsOf(c).length + (lineOf(c)?.spareStock?.length ?? 0));
  const all = size.reduce((a, b) => a + b, 0);
  let split = 0;
  let best = all;
  for (let i = 0, before = 0; i <= lists.length; before += size[i] ?? 0, i++) {
    if (Math.abs(all - 2 * before) < best) {
      best = Math.abs(all - 2 * before);
      split = i;
    }
  }
  return (
    <div className="cut-diagrams cut-cols">
      {defs}
      <div className="cut-col">{lists.slice(0, split).map(product)}</div>
      <div className="cut-col">{lists.slice(split).map(product)}</div>
    </div>
  );
}

/** products cut on the framing plan's timber: framing and posts */
export const isFramingCut = (c: CutList): boolean => {
  const cat = PRODUCT_MAP[c.productId]?.category;
  return cat === 'framing' || cat === 'post';
};
