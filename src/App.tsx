import { useRef } from 'react';
import { useT } from './i18n';
import { useApp } from './state';
import { CanvasEditor } from './ui/CanvasEditor';
import { SheetsView } from './ui/Sheets';
import { SidePanel } from './ui/SidePanel';
import { exportProjectJson } from './utils/export';

export default function App() {
  const { project, projects, lang, setLang, ui, setUi, createProject, openProject, duplicateProject, deleteProject, importProject } = useApp();
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

  return (
    <div className="app">
      <header className="header no-print">
        <div className="brand">
          <b>{t('app.title')}</b>
          <small>{t('app.subtitle')}</small>
        </div>
        <select className="project-select" value={project.id} onChange={(e) => openProject(e.target.value)} title={t('app.projects')}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="menu">
          <button className="btn" onClick={() => createProject(false)}>
            {t('app.newEmpty')}
          </button>
          <button className="btn" onClick={() => createProject(true)}>
            {t('app.newSample')}
          </button>
          <button className="btn" onClick={duplicateProject}>
            {t('app.duplicate')}
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm(t('app.deleteConfirm', { name: project.name }))) deleteProject();
            }}
          >
            {t('app.delete')}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            {t('app.importJson')}
          </button>
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
          <button className="btn" onClick={() => exportProjectJson(project)}>
            {t('app.exportJson')}
          </button>
        </div>
        <div className="mode-tabs">
          <button className={ui.mode === 'design' ? 'active' : ''} onClick={() => setUi({ mode: 'design' })}>
            {t('app.design')}
          </button>
          <button className={ui.mode === 'sheets' ? 'active' : ''} onClick={() => setUi({ mode: 'sheets' })}>
            {t('app.sheets')}
          </button>
        </div>
        <button className="btn lang" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title="Language">
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </header>
      {ui.mode === 'design' ? (
        <main className="design">
          <CanvasEditor />
          <SidePanel />
        </main>
      ) : (
        <main className="sheets-main">
          <SheetsView />
        </main>
      )}
    </div>
  );
}
