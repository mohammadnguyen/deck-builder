import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeDesign, type DesignResult } from './engine';
import { LangContext, translate } from './i18n';
import { defaultParams, defaultRules, newProject } from './model/defaults';
import { PRODUCT_MAP, resolveProductId } from './model/catalog';
import type { DeckParams, Lang, Project, RuleSet } from './model/types';
import { canRedo as hCanRedo, canUndo as hCanUndo, currentState, initHistory, jumpHistory, pushHistory, redoHistory, undoHistory, type History } from './utils/history';

export type Tool = 'select' | 'deck' | 'house' | 'stair' | 'pan';
export type Selection =
  | { type: 'edge'; index: number }
  | { type: 'vertex'; index: number }
  | { type: 'stair'; id: string }
  | null;
export interface Layers {
  frame: boolean;
  boards: boolean;
  posts: boolean;
  balustrade: boolean;
  dims: boolean;
  house: boolean;
}
export type PanelTab = 'params' | 'selection' | 'rules' | 'prices' | 'results';
export type Mode = 'design' | 'sheets' | 'materials' | 'steps';
export interface UIState {
  tool: Tool;
  selection: Selection;
  snap: number;
  layers: Layers;
  mode: Mode;
  panelTab: PanelTab;
  /** full parameter / rules / prices panels instead of the five-step guide */
  advanced: boolean;
  /** free drawing tools shown on the canvas */
  drawMode: boolean;
}

/** what undo / redo / jump just did, so the canvas can confirm it in a toast */
export interface HistoryAction {
  kind: 'undo' | 'redo' | 'jump';
  label: string;
  at: number;
}

const LS = {
  projects: 'deckbuilder.projects.v1',
  current: 'deckbuilder.current.v1',
  lang: 'deckbuilder.lang',
  rules: 'deckbuilder.defaultRules.v1',
  prices: 'deckbuilder.defaultPrices.v1',
};

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app keeps working in memory */
  }
}

/** Fill in any fields added since the project was saved. */
export function migrateProject(p: Partial<Project>): Project {
  const dr = defaultRules();
  const dp = defaultParams();
  const rules: RuleSet = { ...dr, ...(p.rules ?? {}), stair: { ...dr.stair, ...(p.rules?.stair ?? {}) } } as RuleSet;
  // rows that still hold a superseded default are upgraded; customised rows are left alone
  const superseded: Record<string, string> = {
    'tp-140x45|1': JSON.stringify([{ flw: 1800, span: 1300 }, { flw: 2400, span: 1100 }, { flw: 3000, span: 1000 }, { flw: 3600, span: 900 }]),
  };
  for (const [key, oldJson] of Object.entries(superseded)) {
    if (JSON.stringify(rules.bearerSpan[key]) === oldJson) rules.bearerSpan[key] = dr.bearerSpan[key];
  }
  // decking spacing caps that still hold the old 400 default follow the company practice (500)
  rules.deckingMaxJoistSpacing = { ...dr.deckingMaxJoistSpacing, ...(rules.deckingMaxJoistSpacing ?? {}) };
  for (const id of ['modelo-140x23', 'ntw-terrace-us49']) {
    if (rules.deckingMaxJoistSpacing[id] === 400) rules.deckingMaxJoistSpacing[id] = dr.deckingMaxJoistSpacing[id];
  }
  const params: DeckParams = {
    ...dp,
    ...(p.params ?? {}),
    balustrade: { ...dp.balustrade, ...(p.params?.balustrade ?? {}) },
  } as DeckParams;
  // company practice: 200 mm auger holes; projects still on the old 300 default follow
  if (params.footingDiameter === 300) params.footingDiameter = 200;
  if ((params.attachment as string) === 'ledger') {
    params.attachment = 'wall';
    params.wallFixing = 'bolt';
  }
  for (const k of ['deckingProductId', 'joistProductId', 'bearerProductId', 'concreteProductId'] as const) {
    const id = resolveProductId(params[k]);
    params[k] = PRODUCT_MAP[id] ? id : dp[k];
  }
  if (params.postProductId !== 'auto' && !PRODUCT_MAP[resolveProductId(params.postProductId)]) params.postProductId = dp.postProductId;
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.prices ?? {})) prices[resolveProductId(k)] = v;
  const base = newProject(p.name ?? 'Deck');
  return {
    ...base,
    ...p,
    deck: p.deck ?? [],
    houseEdges: p.houseEdges ?? [],
    house: p.house ?? [],
    stairs: p.stairs ?? [],
    prices,
    rules,
    params,
    progress: p.progress ?? {},
  } as Project;
}

export function isProjectLike(x: unknown): x is Partial<Project> {
  return !!x && typeof x === 'object' && Array.isArray((x as Project).deck) && typeof (x as Project).params === 'object';
}

interface Store {
  projects: Project[];
  /** edit history per project id; the entry at index holds the project as it is now */
  histories: Record<string, History<Project>>;
}

interface AppCtx {
  project: Project;
  projects: Project[];
  design: DesignResult;
  lang: Lang;
  ui: UIState;
  canUndo: boolean;
  canRedo: boolean;
  /** labels and times of every step for the history list */
  history: { label: string; at: number }[];
  historyIndex: number;
  lastHistoryAction: HistoryAction | null;
  setLang: (l: Lang) => void;
  setUi: (patch: Partial<UIState>) => void;
  /**
   * Change the current project. Every change is undoable; `label` names it in the history
   * (an i18n key) and rapid changes with the same label coalesce into one step.
   */
  updateProject: (fn: (p: Project) => Project, label?: string | boolean, coalesceMs?: number) => void;
  undo: () => void;
  redo: () => void;
  jumpTo: (index: number) => void;
  createProject: (sample: boolean) => void;
  openProject: (id: string) => void;
  duplicateProject: () => void;
  deleteProject: () => void;
  importProject: (data: unknown) => boolean;
  saveDefaultRules: () => void;
  saveDefaultPrices: () => void;
  defaultRulesForNew: () => RuleSet;
}

const Ctx = createContext<AppCtx | null>(null);

const historyFor = (store: Store, p: Project): History<Project> => store.histories[p.id] ?? initHistory(p, 'h.open');

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadJSON<Lang>(LS.lang, 'zh'));
  const [store, setStore] = useState<Store>(() => {
    const stored = loadJSON<Partial<Project>[]>(LS.projects, []);
    let list = stored.filter(isProjectLike).map(migrateProject);
    if (!list.length) {
      const rules = loadJSON<RuleSet | null>(LS.rules, null);
      const prices = loadJSON<Record<string, number> | null>(LS.prices, null);
      list = [newProject(lang === 'zh' ? '示例 deck' : 'Sample deck', true, rules ?? undefined, prices ?? undefined)];
    }
    return { projects: list, histories: {} };
  });
  const [currentId, setCurrentId] = useState<string>(() => loadJSON<string>(LS.current, ''));
  const [ui, setUiState] = useState<UIState>({
    tool: 'select',
    selection: null,
    snap: 50,
    layers: { frame: true, boards: true, posts: true, balustrade: true, dims: false, house: true },
    mode: 'design',
    panelTab: 'params',
    advanced: false,
    drawMode: false,
  });
  const [lastHistoryAction, setLastHistoryAction] = useState<HistoryAction | null>(null);

  const projects = store.projects;
  const project = useMemo(() => projects.find((p) => p.id === currentId) ?? projects[0], [projects, currentId]);
  const cur = project?.id;

  useEffect(() => {
    if (project && project.id !== currentId) setCurrentId(project.id);
  }, [project, currentId]);

  // persist (debounced)
  useEffect(() => {
    const h = setTimeout(() => {
      saveJSON(LS.projects, projects);
      saveJSON(LS.current, currentId);
    }, 300);
    return () => clearTimeout(h);
  }, [projects, currentId]);
  useEffect(() => saveJSON(LS.lang, lang), [lang]);

  const design = useMemo(() => computeDesign(project), [project]);

  const setUi = useCallback((patch: Partial<UIState>) => setUiState((u) => ({ ...u, ...patch })), []);

  const updateProject = useCallback(
    (fn: (p: Project) => Project, label: string | boolean = 'h.edit', coalesceMs = 1200) => {
      const lbl = typeof label === 'string' ? label : 'h.edit';
      setStore((s) => {
        const id = cur ?? s.projects[0]?.id;
        const p = s.projects.find((x) => x.id === id);
        if (!p) return s;
        const changed = fn(p);
        if (changed === p) return s;
        const next = { ...changed, updatedAt: new Date().toISOString() };
        const h = pushHistory(historyFor(s, p), next, lbl, Date.now(), coalesceMs);
        return { projects: s.projects.map((x) => (x.id === id ? next : x)), histories: { ...s.histories, [id]: h } };
      });
    },
    [cur],
  );

  const applyHistory = useCallback(
    (kind: HistoryAction['kind'], move: (h: History<Project>) => History<Project>) => {
      setStore((s) => {
        const p = s.projects.find((x) => x.id === cur);
        if (!p) return s;
        const h = historyFor(s, p);
        const nh = move(h);
        if (nh === h) return s;
        const from = h.entries[h.index];
        const label = kind === 'undo' ? from.label : nh.entries[nh.index].label;
        setLastHistoryAction({ kind, label, at: Date.now() });
        return { projects: s.projects.map((x) => (x.id === p.id ? currentState(nh) : x)), histories: { ...s.histories, [p.id]: nh } };
      });
    },
    [cur],
  );
  const undo = useCallback(() => applyHistory('undo', undoHistory), [applyHistory]);
  const redo = useCallback(() => applyHistory('redo', redoHistory), [applyHistory]);
  const jumpTo = useCallback((index: number) => applyHistory('jump', (h) => jumpHistory(h, index)), [applyHistory]);

  const hist = project ? historyFor(store, project) : null;
  const canUndo = hist ? hCanUndo(hist) : false;
  const canRedo = hist ? hCanRedo(hist) : false;
  const history = useMemo(() => (hist ? hist.entries.map((e) => ({ label: e.label, at: e.at })) : []), [hist]);
  const historyIndex = hist ? hist.index : 0;

  const defaultRulesForNew = useCallback((): RuleSet => {
    const r = loadJSON<RuleSet | null>(LS.rules, null);
    return r ? migrateProject({ rules: r } as Partial<Project>).rules : defaultRules();
  }, []);

  const addProject = useCallback((p: Project) => {
    setStore((s) => ({ projects: [...s.projects, p], histories: { ...s.histories, [p.id]: initHistory(p, 'h.open') } }));
    setCurrentId(p.id);
    setUiState((u) => ({ ...u, selection: null, tool: 'select', mode: 'design', drawMode: false }));
  }, []);

  const createProject = useCallback(
    (sample: boolean) => {
      const prices = loadJSON<Record<string, number> | null>(LS.prices, null);
      const name = `${lang === 'zh' ? 'Deck 项目' : 'Deck project'} ${projects.length + 1}`;
      addProject(newProject(name, sample, defaultRulesForNew(), prices ?? undefined));
    },
    [lang, projects.length, defaultRulesForNew, addProject],
  );

  const openProject = useCallback((id: string) => {
    setCurrentId(id);
    setUiState((u) => ({ ...u, selection: null, mode: 'design', drawMode: false }));
  }, []);

  const duplicateProject = useCallback(() => {
    const copy = { ...JSON.parse(JSON.stringify(project)), id: newProject('x').id, name: `${project.name} (copy)` } as Project;
    addProject(copy);
  }, [project, addProject]);

  const deleteProject = useCallback(() => {
    setStore((s) => {
      const rest = s.projects.filter((p) => p.id !== project.id);
      const histories = { ...s.histories };
      delete histories[project.id];
      if (!rest.length) {
        const fresh = newProject(lang === 'zh' ? 'Deck 项目 1' : 'Deck project 1', false, defaultRulesForNew());
        rest.push(fresh);
        histories[fresh.id] = initHistory(fresh, 'h.open');
      }
      setCurrentId(rest[0].id);
      return { projects: rest, histories };
    });
  }, [project, lang, defaultRulesForNew]);

  const importProject = useCallback(
    (data: unknown): boolean => {
      if (!isProjectLike(data)) return false;
      const p = migrateProject(data);
      p.id = newProject('x').id;
      addProject(p);
      return true;
    },
    [addProject],
  );

  const saveDefaultRules = useCallback(() => saveJSON(LS.rules, project.rules), [project]);
  const saveDefaultPrices = useCallback(() => saveJSON(LS.prices, project.prices), [project]);
  const setLang = useCallback((l: Lang) => setLangState(l), []);

  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);

  const value: AppCtx = {
    project, projects, design, lang, ui, canUndo, canRedo, history, historyIndex, lastHistoryAction,
    setLang, setUi, updateProject, undo, redo, jumpTo, createProject, openProject,
    duplicateProject, deleteProject, importProject, saveDefaultRules, saveDefaultPrices, defaultRulesForNew,
  };
  return (
    <Ctx.Provider value={value}>
      <LangContext.Provider value={{ lang, t }}>{children}</LangContext.Provider>
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}
