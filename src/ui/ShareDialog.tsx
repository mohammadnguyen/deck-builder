import { useEffect, useMemo, useRef, useState } from 'react';
import { encode } from 'uqr';
import { useT } from '../i18n';
import { useApp } from '../state';
import { shareLink } from '../utils/share';

/** A QR code drawn square by square: a phone camera opens the link. */
function QrCode({ text }: { text: string }) {
  const { data } = useMemo(() => encode(text, { ecc: 'L', border: 2 }), [text]);
  const n = data.length;
  let d = '';
  data.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) d += `M${x} ${y}h1v1h-1z`;
  }));
  return (
    <svg className="qr" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#111" />
    </svg>
  );
}

/**
 * Share the project with another phone or computer: a QR code to scan and a link to send. The link carries the whole
 * project; opening it stores the project there (see utils/share).
 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { project } = useApp();
  const { t } = useT();
  const link = useMemo(() => shareLink(project, window.location.origin + window.location.pathname), [project]);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';
  // the keys stay in the dialog while it is open (the editor's shortcuts never see them): Escape closes it
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the link stays selectable */
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: project.name, text: t('share.text', { name: project.name }), url: link });
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div
        ref={box}
        className="modal share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('share.title', { name: project.name })}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{t('share.title', { name: project.name })}</h3>
        <p className="hint">{t('share.hint')}</p>
        <QrCode text={link} />
        <input className="share-link" readOnly value={link} aria-label={t('share.link')} onFocus={(e) => e.target.select()} />
        <div className="share-actions">
          <button type="button" className="btn primary" onClick={() => void copy()}>
            {copied ? t('share.copied') : t('share.copy')}
          </button>
          {canShare && (
            <button type="button" className="btn" onClick={() => void share()}>
              {t('share.more')}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('share.close')}
          </button>
        </div>
        <p className="hint">{t('share.privacy')}</p>
      </div>
    </div>
  );
}
