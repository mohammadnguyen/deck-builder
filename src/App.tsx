import { useRef, type ReactNode } from 'react';
import { useT } from './i18n';
import { useApp, type Mode } from './state';
import { CanvasEditor } from './ui/CanvasEditor';
import { GuidePanel } from './ui/GuidePanel';
import { MaterialsView } from './ui/MaterialsView';
import { ResultsBar } from './ui/ResultsBar';
import { SheetsView } from './ui/Sheets';
import { StepsView } from './ui/StepsView';
import { exportProjectJson } from './utils/export';

const ICONS: Record<Mode, ReactNode> = {
  design: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v16H4zM4 12h8v8" />
    </svg>
  ),
  sheets: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l5 5v13H6zM15 3v5h5M9 13h6M9 17h6" />
    </svg>
  ),
  materials: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  ),
  steps: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </svg>
  ),
};
const MODES: { id: Mode; key: string }[] = [
  { id: 'design', key: 'nav.draw' },
  { id: 'sheets', key: 'nav.sheets' },
  { id: 'materials', key: 'nav.materials' },
  { id: 'steps', key: 'nav.steps' },
];

export default function App() {
  const { project, projects, lang, setLang, ui, setUi, updateProject, createProject, openProject, duplicateProject, deleteProject, importProject } = useApp();
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (!importProject(data)) window.alert(t('app.importError'));
    } catch {
      window.alert(t('app.importError'));
    }
  };
  const closeMenu = (e: React.MouseEvent) => {
    const d = (e.currentTarget as HTMLElement).closest('details');
    if (d) d.open = false;
  };

  const tabs = (cls: string) => (
    <nav className={cls} aria-label={t('nav.draw')}>
      {MODES.map((m) => (
        <button key={m.id} className={ui.mode === m.id ? 'active' : ''} onClick={() => setUi({ mode: m.id })}>
          {ICONS[m.id]}
          <span>
            {t(m.key)}
            {m.id === 'sheets' ? ' 7' : ''}
          </span>
        </button>
      ))}
    </nav>
  );

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand">
          <span className="logo">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
              <path d="M3 10h18M3 15h18M7 6v13M12 6v13M17 6v13" />
            </svg>
          </span>
          <b>{t('app.title')}</b>
        </div>
        <input className="project-name" value={project.name} aria-label={t('app.projectName')} onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))} />
        <details className="dd">
          <summary>{t('nav.projects')} ▾</summary>
          <div className="dd-menu">
            <select className="project-select" value={project.id} onChange={(e) => openProject(e.target.value)} title={t('app.projects')}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn" onClick={(e) => { createProject(false); closeMenu(e); }}>
              {t('app.newEmpty')}
            </button>
            <button className="btn" onClick={(e) => { createProject(true); closeMenu(e); }}>
              {t('app.newSample')}
            </button>
            <button className="btn" onClick={(e) => { duplicateProject(); closeMenu(e); }}>
              {t('app.duplicate')}
            </button>
            <button className="btn" onClick={(e) => { fileRef.current?.click(); closeMenu(e); }}>
              {t('app.importJson')}
            </button>
            <button className="btn" onClick={(e) => { exportProjectJson(project); closeMenu(e); }}>
              {t('app.exportJson')}
            </button>
            <button
              className="btn danger"
              onClick={(e) => {
                if (window.confirm(t('app.deleteConfirm', { name: project.name }))) deleteProject();
                closeMenu(e);
              }}
            >
              {t('app.delete')}
            </button>
          </div>
        </details>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
        {tabs('tabs-main')}
        <span className="saved">{t('nav.saved')}</span>
        <button className="btn lang" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title="Language">
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </header>

      {ui.mode === 'design' && (
        <main className="design-grid">
          <aside className="col guide-col">
            <GuidePanel />
          </aside>
          <section className="col canvas-col">
            <CanvasEditor />
          </section>
          <aside className="col results-col">
            <ResultsBar />
          </aside>
        </main>
      )}
      {ui.mode === 'sheets' && (
        <main className="sheets-main">
          <SheetsView />
        </main>
      )}
      {ui.mode === 'materials' && (
        <main className="page-main">
          <MaterialsView />
        </main>
      )}
      {ui.mode === 'steps' && (
        <main className="page-main">
          <StepsView />
        </main>
      )}
      {tabs('tabbar no-print')}
    </div>
  );
}
