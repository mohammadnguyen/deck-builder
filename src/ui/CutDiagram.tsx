import { useId } from 'react';
import type { DesignResult } from '../engine';
import type { CutList } from '../engine/bom';
import { productName, useT } from '../i18n';
import { PRODUCT_MAP } from '../model/catalog';
import type { Project } from '../model/types';
import { cutMarks, finishedLength, markUse, type CutMarks } from '../utils/cutmarks';

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

function tagsOf(productId: string, cut: number, marks: CutMarks): string[] {
  return marks.of(productId, cut)?.tags ?? [];
}

/**
 * How to cut: for each product, every cutting pattern as a stick drawn to scale with its pieces, and how many
 * sticks are cut that way. Framing pieces carry the letters of the framing plan.
 */
export function CutDiagrams({ design, project, filter, showUses = true }: { design: DesignResult; project: Project; filter?: (c: CutList) => boolean; showUses?: boolean }) {
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
  return (
    <div className="cut-diagrams">
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={8} stroke="#c4c8ce" strokeWidth={3} />
          </pattern>
        </defs>
      </svg>
      {lists.map((c) => {
        const line = design.bom.lines.find((l) => l.productId === c.productId);
        const maxStock = Math.max(...c.groups.map((g) => g.stock), 1);
        const sticks = c.groups.reduce((n, g) => n + g.count, 0);
        const stockText = [...new Set(c.groups.map((g) => g.stock))].sort((a, b) => b - a).map((s) => `${(s / 1000).toFixed(1)} m`).join(' / ');
        const pieceMarks = marks.marks.filter((m) => m.productId === c.productId);
        return (
          <div key={c.productId} className="cut-product">
            <div className="cut-head">
              <b>{productName(c.productId, lang)}</b>
              <span>
                {t('cutd.sticks', { n: sticks, stock: stockText })}
                {line?.extraCount ? ` · ${t('cutd.spare', { n: line.extraCount })}` : ''}
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
            {[...c.groups]
              .sort((a, b) => b.count - a.count || b.cuts.length - a.cuts.length)
              .map((g, i) => (
                <div key={i} className="cut-row">
                  <span className="cut-n">{g.count} ×</span>
                  <Bar stock={g.stock} cuts={g.cuts} offcut={g.offcut} maxStock={maxStock} productId={c.productId} marks={marks} project={project} hatch={hatch} />
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** products cut on the framing plan's timber: framing and posts */
export const isFramingCut = (c: CutList): boolean => {
  const cat = PRODUCT_MAP[c.productId]?.category;
  return cat === 'framing' || cat === 'post';
};
