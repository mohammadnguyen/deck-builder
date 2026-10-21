import type { DesignResult } from '../engine';
import { useT } from '../i18n';
import type { Project } from '../model/types';
import { PRODUCT_MAP, sizeLabel } from '../model/catalog';

const TIMBER = '#e3c08d';
const TIMBER2 = '#c8965c';
const CONCRETE = '#d9d9d9';
const INK = '#222';

function Lbl({ x, y, children, anchor = 'start', size = 8 }: { x: number; y: number; children: string; anchor?: 'start' | 'middle' | 'end'; size?: number }) {
  return (
    <text x={x} y={y} fontSize={size} fill={INK} textAnchor={anchor} fontFamily="Arial, sans-serif">
      {children}
    </text>
  );
}

function Leader({ from, to }: { from: [number, number]; to: [number, number] }) {
  return <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={INK} strokeWidth={0.5} />;
}

function Hatch({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const lines = [];
  for (let i = -h; i < w; i += 6) {
    lines.push(<line key={i} x1={x + Math.max(0, i)} y1={y + Math.max(0, -i)} x2={x + Math.min(w, i + h)} y2={y + Math.min(h, h - (i + h - w > 0 ? i + h - w : 0))} stroke="#777" strokeWidth={0.4} />);
  }
  return <g clipPath={undefined}>{lines}</g>;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail">
      <svg viewBox="0 0 300 220" className="detail-svg">
        <rect x={0.5} y={0.5} width={299} height={219} fill="#fff" stroke="#999" strokeWidth={0.5} />
        {children}
      </svg>
      <div className="detail-title">{title}</div>
    </div>
  );
}

export function DetailsGrid({ project, design }: { project: Project; design: DesignResult }) {
  const { t } = useT();
  const p = project.params;
  // the frame as designed (sized automatically, or as set)
  const fr = design.frame;
  const joist = PRODUCT_MAP[fr.joistProductId];
  const bearer = PRODUCT_MAP[fr.bearerProductId];
  const decking = PRODUCT_MAP[p.deckingProductId];
  const post = PRODUCT_MAP[design.postProductId];
  const sizeOf = (prod?: { id: string }) => (prod ? sizeLabel(prod.id) : '');
  const bolted = p.bearerToPost !== 'onTop';
  const screwed = p.bearerToPost === 'screwed';
  const checked = p.bearerToPost === 'checked';
  const slab = p.footingType === 'slab';
  const flush = p.joistConnection === 'flush';
  const stump = p.footingType === 'stump';

  const detailCount = 2 + (design.balustrade.enabled ? 1 : 0) + (design.stairs.length > 0 ? 1 : 0) + (design.layout && design.layout.ledgers.length > 0 ? 1 : 0);
  return (
    <div className="details-grid" style={{ gridTemplateColumns: `repeat(${detailCount <= 4 ? 2 : 3}, 1fr)` }}>
      <Frame title={t('detail.postSection')}>
        {/* decking */}
        {[60, 86, 112, 138, 164, 190, 216].map((x) => (
          <rect key={x} x={x} y={50} width={24} height={6} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
        ))}
        {flush ? (
          <>
            {/* bearer end-on with joists hung either side, tops level */}
            <rect x={56} y={56} width={80} height={14} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
            <rect x={164} y={56} width={80} height={14} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
            <rect x={136} y={56} width={28} height={30} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
            <polyline points="136,60 130,60 130,72 136,72" fill="none" stroke={INK} strokeWidth={1.2} />
            <polyline points="164,60 170,60 170,72 164,72" fill="none" stroke={INK} strokeWidth={1.2} />
            {screwed ? (
              <>
                <line x1={130} y1={62} x2={150} y2={66} stroke={INK} strokeWidth={1} />
                <line x1={130} y1={78} x2={150} y2={82} stroke={INK} strokeWidth={1} />
              </>
            ) : (
              <>
                <line x1={128} y1={64} x2={172} y2={64} stroke={INK} strokeWidth={1.2} />
                <line x1={128} y1={80} x2={172} y2={80} stroke={INK} strokeWidth={1.2} />
              </>
            )}
            <rect x={142} y={86} width={16} height={stump ? 109 : 59} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
            <rect x={142} y={56} width={16} height={30} fill="none" stroke={INK} strokeWidth={0.4} strokeDasharray="2 2" />
          </>
        ) : (
          <>
            {/* joist */}
            <rect x={56} y={56} width={188} height={14} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
            {/* bearer */}
            {checked ? (
              <>
                {/* post cheek beside the bearer, bearer bearing on the shoulder of the check */}
                <rect x={142} y={70} width={8} height={30} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
                <rect x={150} y={70} width={16} height={30} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
                <line x1={138} y1={78} x2={166} y2={80} stroke={INK} strokeWidth={1} />
                <line x1={138} y1={92} x2={166} y2={94} stroke={INK} strokeWidth={1} />
              </>
            ) : bolted && fr.bearerLaminations === 1 ? (
              <>
                <rect x={158} y={70} width={16} height={30} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
                {screwed ? (
                  <>
                    <line x1={176} y1={76} x2={146} y2={80} stroke={INK} strokeWidth={1} />
                    <line x1={176} y1={92} x2={146} y2={96} stroke={INK} strokeWidth={1} />
                  </>
                ) : (
                  <>
                    <line x1={138} y1={78} x2={178} y2={78} stroke={INK} strokeWidth={1.2} />
                    <line x1={138} y1={92} x2={178} y2={92} stroke={INK} strokeWidth={1.2} />
                  </>
                )}
              </>
            ) : bolted ? (
              <>
                <rect x={126} y={70} width={16} height={30} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
                <rect x={158} y={70} width={16} height={30} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
                <line x1={122} y1={78} x2={178} y2={78} stroke={INK} strokeWidth={1.2} />
                <line x1={122} y1={92} x2={178} y2={92} stroke={INK} strokeWidth={1.2} />
              </>
            ) : (
              <>
                <rect x={120} y={70} width={60} height={30} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
                <polyline points="136,100 136,112 164,112 164,100" fill="none" stroke={INK} strokeWidth={1} />
              </>
            )}
            {/* post */}
            <rect x={142} y={checked ? 100 : bolted ? 70 : 100} width={16} height={stump ? (checked ? 95 : bolted ? 125 : 95) : slab ? (checked ? 50 : bolted ? 80 : 50) : checked ? 45 : bolted ? 75 : 45} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
          </>
        )}
        {/* ground */}
        <line x1={20} y1={150} x2={280} y2={150} stroke={INK} strokeWidth={0.8} />
        {!slab && <Hatch x={20} y={150} w={100} h={12} />}
        {!slab && <Hatch x={180} y={150} w={100} h={12} />}
        {slab ? (
          <>
            <rect x={20} y={150} width={260} height={10} fill={CONCRETE} stroke={INK} strokeWidth={0.6} />
            <Lbl x={217} y={178}>{t('footing.slab')}</Lbl>
            <Leader from={[180, 155]} to={[215, 175]} />
          </>
        ) : stump ? (
          <>
            <rect x={125} y={150} width={50} height={50} fill={CONCRETE} stroke={INK} strokeWidth={0.6} />
            <rect x={142} y={150} width={16} height={45} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
            {[146, 150, 154].map((x) => (
              <circle key={x} cx={x} cy={197} r={1.2} fill="#777" />
            ))}
            <line x1={185} y1={150} x2={185} y2={200} stroke={INK} strokeWidth={0.5} />
            <line x1={182} y1={150} x2={188} y2={150} stroke={INK} strokeWidth={0.5} />
            <line x1={182} y1={200} x2={188} y2={200} stroke={INK} strokeWidth={0.5} />
            <Lbl x={189} y={178}>{`${p.footingDepth} ${t('d.depth')}`}</Lbl>
            <Leader from={[150, 185]} to={[215, 205]} />
            <Lbl x={217} y={208}>{`${t('d.concrete')} Ø${p.footingDiameter}`}</Lbl>
            <Lbl x={120} y={210} anchor="end">{t('d.gravel')}</Lbl>
            <Leader from={[122, 207]} to={[146, 198]} />
          </>
        ) : (
          <>
            <rect x={115} y={150} width={70} height={35} fill={CONCRETE} stroke={INK} strokeWidth={0.6} />
            <polyline points="140,120 140,150 160,150 160,120" fill="none" stroke={INK} strokeWidth={1.4} />
            <line x1={136} y1={128} x2={164} y2={128} stroke={INK} strokeWidth={1.2} />
            <line x1={136} y1={140} x2={164} y2={140} stroke={INK} strokeWidth={1.2} />
            <Leader from={[160, 135]} to={[215, 128]} />
            <Lbl x={217} y={131}>{`${t('d.stirrup')} + ${t('d.bolts')}`}</Lbl>
            <Leader from={[180, 175]} to={[215, 190]} />
            <Lbl x={217} y={193}>{`${t('d.pad')} ${p.padSize}x${p.padSize}x${p.padDepth}`}</Lbl>
          </>
        )}
        <Leader from={[228, 53]} to={[250, 40]} />
        <Lbl x={294} y={43} anchor="end">{`${t('d.decking')} ${sizeOf(decking)}`}</Lbl>
        <Leader from={[244, 64]} to={[250, 74]} />
        <Lbl x={294} y={77} anchor="end">{`${t('d.joist')} ${sizeOf(joist)} @ ${design.joistSpacingText}`}</Lbl>
        <Leader from={[flush ? 164 : bolted ? 174 : 180, flush ? 84 : 90]} to={[205, 100]} />
        <Lbl x={294} y={103} anchor="end">{`${t('d.bearer')} ${fr.bearerLaminations}/${sizeOf(bearer)}`}</Lbl>
        {(screwed || checked) && <Lbl x={294} y={113} anchor="end">{`${project.rules.battenScrewsPerPost} x 14g x 100`}</Lbl>}
        {checked && <Lbl x={88} y={110} anchor="end" size={7}>{t('d.checked')}</Lbl>}
        {!screwed && !checked && bolted && <Lbl x={294} y={113} anchor="end">{t('d.bolts')}</Lbl>}
        {!bolted && <Lbl x={294} y={113} anchor="end">{t('d.postCap')}</Lbl>}
        {flush && <Lbl x={294} y={123} anchor="end">{t('d.hanger')}</Lbl>}
        {!flush && <Lbl x={294} y={123} anchor="end">{p.joistFixing === 'skewNails' ? `${project.rules.skewNailsPerCrossing} x 75 ${t('d.skew')}` : 'triple grip'}</Lbl>}
        <Leader from={[142, 125]} to={[90, 125]} />
        <Lbl x={88} y={128} anchor="end">{`${t('d.post')} ${sizeOf(post)}`}</Lbl>
        <Lbl x={24} y={146}>{t('d.ground')}</Lbl>
        {decking.family !== 'composite' && (
          <>
            <Lbl x={24} y={62}>{t('d.tape')}</Lbl>
            <Leader from={[48, 60]} to={[70, 56]} />
          </>
        )}
        <line x1={30} y1={50} x2={50} y2={50} stroke={INK} strokeWidth={0.5} strokeDasharray="2 2" />
        <Lbl x={30} y={46} size={7}>{`${t('d.deckLevel')} +${p.deckHeight}`}</Lbl>
      </Frame>

      <Frame title={t('detail.deckFix')}>
        {[60, 150, 240].map((x) => (
          <rect key={x} x={x - 6} y={20} width={12} height={180} fill={TIMBER2} stroke={INK} strokeWidth={0.5} />
        ))}
        <rect x={150} y={85} width={12} height={40} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
        {[40, 78, 116, 154].map((y, i) => (
          <g key={y}>
            {i === 2 ? (
              <>
                <rect x={30} y={y} width={118} height={30} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
                <rect x={152} y={y} width={118} height={30} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
              </>
            ) : (
              <rect x={30} y={y} width={240} height={30} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
            )}
            {[60, 150, 240].map((x) =>
              i === 2 && x === 150 ? (
                <g key={x}>
                  <circle cx={x - 3} cy={y + 9} r={1.6} fill={INK} />
                  <circle cx={x - 3} cy={y + 21} r={1.6} fill={INK} />
                  <circle cx={x + 3} cy={y + 9} r={1.6} fill={INK} />
                  <circle cx={x + 3} cy={y + 21} r={1.6} fill={INK} />
                </g>
              ) : (
                <g key={x}>
                  <circle cx={x} cy={y + 9} r={1.6} fill={INK} />
                  <circle cx={x} cy={y + 21} r={1.6} fill={INK} />
                </g>
              ),
            )}
          </g>
        ))}
        <Lbl x={20} y={212}>{`${t('d.gap')} ${p.boardGap} mm`}</Lbl>
        <Leader from={[40, 208]} to={[45, 74]} />
        <Lbl x={120} y={212}>{t('d.screws')}</Lbl>
        <Lbl x={166} y={95}>{t('d.block')}</Lbl>
        <Leader from={[164, 97]} to={[162, 105]} />
        <Lbl x={236} y={16} anchor="middle" size={7}>{`${t('d.joist')} @ ${design.joistSpacingText}`}</Lbl>
      </Frame>

      {design.balustrade.enabled && (
        <Frame title={t('detail.balustrade')}>
          <rect x={30} y={150} width={240} height={6} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
          <rect x={30} y={156} width={240} height={24} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
          <rect x={140} y={30} width={16} height={150} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
          <line x1={132} y1={163} x2={164} y2={163} stroke={INK} strokeWidth={1.2} />
          <line x1={132} y1={174} x2={164} y2={174} stroke={INK} strokeWidth={1.2} />
          <rect x={60} y={30} width={80} height={8} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
          <rect x={156} y={30} width={80} height={8} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
          <rect x={60} y={132} width={80} height={8} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
          <rect x={156} y={132} width={80} height={8} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
          {p.balustrade.infill === 'slats' &&
            [70, 84, 98, 112, 126, 166, 180, 194, 208, 222].map((x) => <rect key={x} x={x} y={38} width={5} height={94} fill={TIMBER} stroke={INK} strokeWidth={0.4} />)}
          {p.balustrade.infill === 'wire' &&
            [48, 58, 68, 78, 88, 98, 108, 118, 128].map((y) => (
              <g key={y}>
                <line x1={60} y1={y} x2={140} y2={y} stroke={INK} strokeWidth={0.6} />
                <line x1={156} y1={y} x2={236} y2={y} stroke={INK} strokeWidth={0.6} />
              </g>
            ))}
          <line x1={255} y1={30} x2={255} y2={150} stroke={INK} strokeWidth={0.5} />
          <line x1={252} y1={30} x2={258} y2={30} stroke={INK} strokeWidth={0.5} />
          <line x1={252} y1={150} x2={258} y2={150} stroke={INK} strokeWidth={0.5} />
          <Lbl x={259} y={92}>{`${p.balustrade.height}`}</Lbl>
          <Lbl x={20} y={200}>{t('d.bolts')}</Lbl>
          <Leader from={[52, 196]} to={[132, 170]} />
          <Lbl x={150} y={200}>{t('d.sphere')}</Lbl>
          <Lbl x={62} y={26} size={7}>{t('d.rail')}</Lbl>
          <Lbl x={148} y={24} anchor="middle" size={7}>{`${t('d.post')} 90x90 @ ${p.balustrade.postSpacing}`}</Lbl>
          <Lbl x={240} y={178} anchor="end" size={7}>{t('d.joist')}</Lbl>
        </Frame>
      )}

      {design.stairs.length > 0 && (
        <Frame title={t('detail.stair')}>
          {(() => {
            const s = design.stairs[0];
            const steps = Math.min(5, Math.max(2, s.risers));
            const R = 20;
            const G = 30;
            const x0 = 70;
            const y0 = 50;
            const pts: string[] = [];
            for (let k = 0; k < steps; k++) {
              pts.push(`${x0 + k * G},${y0 + k * R}`);
              pts.push(`${x0 + (k + 1) * G},${y0 + k * R}`);
            }
            const endX = x0 + steps * G;
            const endY = y0 + (steps - 1) * R;
            const bottomY = endY + R;
            return (
              <>
                <rect x={20} y={y0 - 6} width={50} height={6} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
                <rect x={20} y={y0} width={50} height={22} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
                <polygon points={`${x0},${y0 + 4} ${pts.slice(2).join(' ')} ${endX},${bottomY} ${endX - 14},${bottomY} ${x0},${y0 + 36}`} fill={TIMBER2} stroke={INK} strokeWidth={0.6} opacity={0.9} />
                {Array.from({ length: steps }, (_, k) => (
                  <rect key={k} x={x0 + k * G} y={y0 + k * R - 4} width={G + 4} height={4} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
                ))}
                <line x1={x0 - 4} y1={y0 + 12} x2={x0 + 10} y2={y0 + 12} stroke={INK} strokeWidth={1.2} />
                <line x1={x0 - 4} y1={y0 + 20} x2={x0 + 10} y2={y0 + 20} stroke={INK} strokeWidth={1.2} />
                <rect x={endX - 16} y={bottomY} width={20} height={8} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
                <rect x={endX - 30} y={bottomY + 8} width={60} height={12} fill={CONCRETE} stroke={INK} strokeWidth={0.5} />
                <line x1={20} y1={bottomY + 8} x2={280} y2={bottomY + 8} stroke={INK} strokeWidth={0.6} />
                <line x1={x0 + G + 2} y1={y0 - 10} x2={x0 + 2 * G + 2} y2={y0 - 10} stroke={INK} strokeWidth={0.5} />
                <Lbl x={x0 + 1.5 * G} y={y0 - 13} anchor="middle" size={7}>{`${t('d.going')} ${s.going}`}</Lbl>
                <line x1={x0 + 2 * G + 10} y1={y0 + R} x2={x0 + 2 * G + 10} y2={y0 + 2 * R} stroke={INK} strokeWidth={0.5} />
                <Lbl x={x0 + 2 * G + 13} y={y0 + 1.5 * R + 3} size={7}>{`${t('d.riser')} ${Math.round(s.riser)}`}</Lbl>
                <Lbl x={200} y={70}>{`${s.stringerCount} x ${t('d.stringer')} 290x45`}</Lbl>
                <Leader from={[198, 72]} to={[150, 95]} />
                <Lbl x={200} y={bottomY + 32}>{t('d.kicker')}</Lbl>
                <Lbl x={20} y={y0 + 40} size={7}>{t('d.bolts')}</Lbl>
                <Lbl x={20} y={210} size={7}>{`${t('d.tread')}: ${s.boardsPerTread} x ${sizeOf(decking)}`}</Lbl>
              </>
            );
          })()}
        </Frame>
      )}

      {design.layout && design.layout.ledgers.length > 0 && (
        <Frame title={p.wallFixing === 'dynabolt' ? t('detail.wall') : t('detail.ledger')}>
          <rect x={20} y={20} width={40} height={190} fill="#eee" stroke={INK} strokeWidth={0.6} />
          <Hatch x={20} y={20} w={40} h={190} />
          {/* wall bearer end-on against the wall */}
          <rect x={60} y={flush ? 60 : 74} width={14} height={40} fill={TIMBER2} stroke={INK} strokeWidth={0.6} />
          <line x1={36} y1={flush ? 72 : 86} x2={78} y2={flush ? 72 : 86} stroke={INK} strokeWidth={1.6} />
          <line x1={36} y1={flush ? 90 : 104} x2={78} y2={flush ? 90 : 104} stroke={INK} strokeWidth={1.6} />
          {flush ? (
            <>
              <rect x={74} y={60} width={182} height={26} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
              <polyline points="74,66 74,86 90,86 90,66" fill="none" stroke={INK} strokeWidth={1.4} />
            </>
          ) : (
            <rect x={60} y={60} width={196} height={14} fill={TIMBER} stroke={INK} strokeWidth={0.6} />
          )}
          {[64, 90, 116, 142, 168, 194, 220].map((x) => (
            <rect key={x} x={x} y={54} width={24} height={6} fill={TIMBER} stroke={INK} strokeWidth={0.5} />
          ))}
          {p.wallFixing === 'bolt' && <polyline points="40,48 70,48 70,58 76,62" fill="none" stroke={INK} strokeWidth={1.2} />}
          <Lbl x={110} y={124}>{p.wallFixing === 'dynabolt' ? t('d.masonry') : t('d.house')}</Lbl>
          <Leader from={[108, 121]} to={[60, 115]} />
          <Lbl x={110} y={140}>{`${t('d.wallBearer')} ${fr.bearerLaminations}/${sizeOf(bearer)}`}</Lbl>
          <Leader from={[108, 137]} to={[72, 100]} />
          <Lbl x={110} y={152}>{p.wallFixing === 'dynabolt' ? t('d.anchors', { spacing: project.rules.ledgerBoltSpacing }) : `M12 @ ${project.rules.ledgerBoltSpacing}`}</Lbl>
          {p.wallFixing === 'bolt' && (
            <>
              <Lbl x={110} y={40}>{t('d.flashing')}</Lbl>
              <Leader from={[108, 42]} to={[70, 48]} />
            </>
          )}
          {flush && (
            <>
              <Lbl x={110} y={170}>{t('d.hanger')}</Lbl>
              <Leader from={[108, 167]} to={[90, 86]} />
            </>
          )}
          <Lbl x={110} y={186} size={7}>{`${t('d.joist')} ${sizeOf(joist)} @ ${design.joistSpacingText}`}</Lbl>
          <Lbl x={24} y={205} size={7}>{t('d.ground')}</Lbl>
          <line x1={60} y1={200} x2={280} y2={200} stroke={INK} strokeWidth={0.6} />
        </Frame>
      )}
    </div>
  );
}
