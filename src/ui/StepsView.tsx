import { useT } from '../i18n';
import { useApp } from '../state';
import { WarningList } from './SidePanel';

/** The method of construction as a checklist the crew ticks off on site. Progress is saved with the project. */
export function StepsView() {
  const { project, design, updateProject, setUi } = useApp();
  const { t } = useT();
  if (!design.ok) {
    return (
      <div className="steps-wrap">
        <p className="muted">{t('res.invalid')}</p>
      </div>
    );
  }
  const keys = design.method.map((s, i) => `${i}:${s.key}`);
  const done = keys.filter((k) => project.progress[k]).length;
  const nextIdx = keys.findIndex((k) => !project.progress[k]);
  const toggle = (k: string) => updateProject((p) => ({ ...p, progress: { ...p.progress, [k]: !p.progress[k] } }), 'h.progress');

  return (
    <div className="steps-wrap">
      <div className="steps-head">
        <div>
          <h2>{t('nav.steps')}</h2>
          <span className="muted">
            {project.name} · {t('steps.progress', { done, total: keys.length })}
          </span>
        </div>
        <div className="steps-actions">
          <button className="btn" onClick={() => setUi({ mode: 'sheets' })}>
            {t('steps.sheets')}
          </button>
          <button className="btn ghost" onClick={() => { if (window.confirm(t('steps.resetConfirm'))) updateProject((p) => ({ ...p, progress: {} }), 'h.progress'); }} disabled={!done}>
            {t('steps.reset')}
          </button>
        </div>
      </div>
      <div className="progress" aria-label={t('steps.progress', { done, total: keys.length })}>
        <div style={{ width: `${keys.length ? (done / keys.length) * 100 : 0}%` }} />
      </div>
      <ol className="steps">
        {design.method.map((s, i) => {
          const k = keys[i];
          const isDone = !!project.progress[k];
          const isNext = i === nextIdx;
          return (
            <li key={k} className={`step ${isDone ? 'done' : ''} ${isNext ? 'now' : ''}`}>
              <label className="step-main">
                <input type="checkbox" checked={isDone} onChange={() => toggle(k)} />
                <span className="step-title">
                  <span className="n">{i + 1}.</span> {t(s.key, s.params)}
                </span>
              </label>
              {s.notes.length > 0 && (
                <ul>
                  {s.notes.map((n, j) => (
                    <li key={j}>{t(n.key, n.params)}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <section className="card reminders">
        <h3>{t('steps.reminders')}</h3>
        <p className={design.pathway === 'exemptPossible' ? 'ok' : 'warn'}>
          {t('res.pathway')}: {t(`pathway.${design.pathway}`)}
        </p>
        <WarningList warnings={design.warnings} />
      </section>
    </div>
  );
}
