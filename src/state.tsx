import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeDesign, type DesignResult } from './engine';
import { LangContext, translate } from './i18n';
import { defaultParams, defaultRules, newProject } from './model/defaults';
import { PRODUCT_MAP, resolveProductId } from './model/catalog';
import type { DeckParams, Lang, Project, RuleSet } from './model/types';

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
export interface UIState {
  tool: Tool;
  selection: Selection;
  snap: number;
  layers: Layers;
  mode: 'design' | 'sheets';
  panelTab: PanelTab;
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
  const params: DeckParams = {
    ...dp,
    ...(p.params ?? {}),
    balustrade: { ...dp.balustrade, ...(p.params?.balustrade ?? {}) },
  } as DeckParams;
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
  } as Project;
}

export function isProjectLike(x: unknown): x is Partial<Project> {
  return !!x && typeof x === 'object' && Array.isArray((x as Project).deck) && typeof (x as Project).params === 'object';
}

interface AppCtx {
  project: Project;
  projects: Project[];
  design: DesignResult;
  lang: Lang;
  ui: UIState;
  canUndo: boolean;
  setLang: (l: Lang) => void;
  setUi: (patch: Partial<UIState>) => void;
  updateProject: (fn: (p: Project) => Project, undoable?: boolean) => void;
  undo: () => void;
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadJSON<Lang>(LS.lang, 'zh'));
  const [projects, setProjects] = useState<Project[]>(() => {
    const stored = loadJSON<Partial<Project>[]>(LS.projects, []);
    const list = stored.filter(isProjectLike).map(migrateProject);
    if (list.length) return list;
    const rules = loadJSON<RuleSet | null>(LS.rules, null);
    const prices = loadJSON<Record<string, number> | null>(LS.prices, null);
    return [newProject(lang === 'zh' ? '示例 deck' : 'Sample deck', true, rules ?? undefined, prices ?? undefined)];
  });
  const [currentId, setCurrentId] = useState<string>(() => {
    const id = loadJSON<string>(LS.current, '');
    return id;
  });
  const [ui, setUiState] = useState<UIState>({
    tool: 'select',
    selection: null,
    snap: 50,
    layers: { frame: true, boards: false, posts: true, balustrade: true, dims: true, house: true },
    mode: 'design',
    panelTab: 'params',
  });
  const history = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const project = useMemo(() => projects.find((p) => p.id === currentId) ?? projects[0], [projects, currentId]);

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
    (fn: (p: Project) => Project, undoable = false) => {
      setProjects((list) =>
        list.map((p) => {
          if (p.id !== (currentId || list[0]?.id)) return p;
          if (undoable) {
            history.current.push(JSON.stringify(p));
            if (history.current.length > 50) history.current.shift();
            setCanUndo(true);
          }
          const next = fn(p);
          return { ...next, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [currentId],
  );

  const undo = useCallback(() => {
    const snap = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!snap) return;
    const prev = JSON.parse(snap) as Project;
    setProjects((list) => list.map((p) => (p.id === prev.id ? prev : p)));
  }, []);

  const defaultRulesForNew = useCallback((): RuleSet => {
    const r = loadJSON<RuleSet | null>(LS.rules, null);
    return r ? migrateProject({ rules: r } as Partial<Project>).rules : defaultRules();
  }, []);

  const createProject = useCallback(
    (sample: boolean) => {
      const prices = loadJSON<Record<string, number> | null>(LS.prices, null);
      const name = `${lang === 'zh' ? 'Deck 项目' : 'Deck project'} ${projects.length + 1}`;
      const p = newProject(name, sample, defaultRulesForNew(), prices ?? undefined);
      history.current = [];
      setCanUndo(false);
      setProjects((list) => [...list, p]);
      setCurrentId(p.id);
      setUiState((u) => ({ ...u, selection: null, tool: sample ? 'select' : 'deck', mode: 'design' }));
    },
    [lang, projects.length, defaultRulesForNew],
  );

  const openProject = useCallback((id: string) => {
    history.current = [];
    setCanUndo(false);
    setCurrentId(id);
    setUiState((u) => ({ ...u, selection: null, mode: 'design' }));
  }, []);

  const duplicateProject = useCallback(() => {
    const copy = { ...JSON.parse(JSON.stringify(project)), id: newProject('x').id, name: `${project.name} (copy)` } as Project;
    setProjects((list) => [...list, copy]);
    setCurrentId(copy.id);
  }, [project]);

  const deleteProject = useCallback(() => {
    setProjects((list) => {
      const rest = list.filter((p) => p.id !== project.id);
      if (!rest.length) rest.push(newProject(lang === 'zh' ? 'Deck 项目 1' : 'Deck project 1', false, defaultRulesForNew()));
      setCurrentId(rest[0].id);
      return rest;
    });
    history.current = [];
    setCanUndo(false);
  }, [project, lang, defaultRulesForNew]);

  const importProject = useCallback((data: unknown): boolean => {
    if (!isProjectLike(data)) return false;
    const p = migrateProject(data);
    p.id = newProject('x').id;
    setProjects((list) => [...list, p]);
    setCurrentId(p.id);
    return true;
  }, []);

  const saveDefaultRules = useCallback(() => saveJSON(LS.rules, project.rules), [project]);
  const saveDefaultPrices = useCallback(() => saveJSON(LS.prices, project.prices), [project]);
  const setLang = useCallback((l: Lang) => setLangState(l), []);

  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);

  const value: AppCtx = {
    project, projects, design, lang, ui, canUndo, setLang, setUi, updateProject, undo, createProject, openProject,
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
