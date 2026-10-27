import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeDesign, type DesignResult } from './engine';
import { LangContext, translate } from './i18n';
import { defaultParams, defaultRules, newProject } from './model/defaults';
import { PRODUCT_MAP, resolveProductId, CATALOG } from './model/catalog';
import type { DeckParams, Lang, OrderEdits, Project, RuleSet } from './model/types';
import { canRedo as hCanRedo, canUndo as hCanUndo, currentState, initHistory, jumpHistory, pushHistory, redoHistory, undoHistory, type History } from './utils/history';
import { isShareHash, sharedProject } from './utils/share';

export type Tool = 'select' | 'deck' | 'house' | 'stair' | 'pan';
export type Selection =
  | { type: 'edge'; index: number }
  | { type: 'vertex'; index: number }
  | { type: 'stair'; id: string }
  | { type: 'breaker'; id: string }
  | null;
export interface Layers {
  frame: boolean;
  boards: boolean;
  posts: boolean;
  balustrade: boolean;
  dims: boolean;
  house: boolean;
  /** piece marks on the frame (shown while the boards are hidden) */
  cuts: boolean;
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
  rules.deckingMaxJoistSpacing = { ...dr.deckingMaxJoistSpacing, ...(rules.deckingMaxJoistSpacing ?? {}) };
  // version 2: composite decking is framed at 400 centres; rule sets still on the old 500 default follow
  // once (a value set after the upgrade is kept, as the version is stored with the rules)
  if ((p.rules?.rulesVersion ?? 1) < 2) {
    for (const prod of CATALOG) {
      if (prod.isDecking && prod.family === 'composite' && rules.deckingMaxJoistSpacing[prod.id] === 500) rules.deckingMaxJoistSpacing[prod.id] = dr.deckingMaxJoistSpacing[prod.id];
    }
  }
  // version 3: bearers run out under the edge joists and every bearer end sits on its stump
  if ((p.rules?.rulesVersion ?? 1) < 3) {
    if (rules.postEndSetback === 150) rules.postEndSetback = dr.postEndSetback;
    if (rules.bearerEndInset === 45) rules.bearerEndInset = dr.bearerEndInset;
  }
  rules.rulesVersion = Math.max(p.rules?.rulesVersion ?? 1, dr.rulesVersion ?? 1);
  const params: DeckParams = {
    ...dp,
    ...(p.params ?? {}),
    balustrade: { ...dp.balustrade, ...(p.params?.balustrade ?? {}) },
  } as DeckParams;
  // company practice: 200 mm auger holes; projects still on the old 300 default follow
  if (params.footingDiameter === 300) params.footingDiameter = 200;
  // frame sizes: a project still on the old default sizes is sized automatically (the standard frame unless
  // another is clearly cheaper); sizes someone picked stay as they are
  if (p.params && p.params.frameSizing === undefined) {
    const stock = params.joistProductId === 'tp-90x45' && params.bearerProductId === 'tp-140x45' && params.bearerLaminations === 1;
    params.frameSizing = stock ? 'auto' : 'fixed';
  }
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
    breakers: p.breakers && Array.isArray(p.breakers.items) ? p.breakers : null,
    order: migrateOrder(p.order),
  } as Project;
}

/**
 * The hand changes to a saved order. Timber cut on the cutting diagrams is ordered as cut: counts typed in for it
 * before (`stock`, which could leave the drawings behind) are dropped, so the line follows the cut again; its spare,
 * lines taken off, other quantities, items added and the note stay.
 */
function migrateOrder(order: unknown): Project['order'] {
  if (!order || typeof order !== 'object') return null;
  const o = order as Partial<OrderEdits>;
  const lines: OrderEdits['lines'] = {};
  for (const [id, e] of Object.entries(o.lines && typeof o.lines === 'object' ? o.lines : {})) {
    if (!e || typeof e !== 'object') continue;
    const { stock: _old, ...rest } = e as OrderEdits['lines'][string] & { stock?: unknown };
    if (rest.removed || rest.qty !== undefined || rest.spare !== undefined) lines[id] = rest;
  }
  const added = Array.isArray(o.added) ? o.added : [];
  const note = typeof o.note === 'string' ? o.note : undefined;
  return Object.keys(lines).length || added.length || note?.trim() ? { lines, added, note } : null;
}

export function isProjectLike(x: unknown): x is Partial<Project> {
  return !!x && typeof x === 'object' && Array.isArray((x as Project).deck) && typeof (x as Project).params === 'object';
}

/**
 * A project from a share link among the ones stored here: new here, it is added; the same job, not changed here
 * since the link was made, is replaced; one changed here since is kept, and the link's copy saved beside it (once:
 * the same link again opens that copy).
 */
export function receiveShared(list: Project[], shared: Project, copyName: (name: string) => string): { projects: Project[]; id: string; copy: boolean } {
  const here = list.find((p) => p.id === shared.id);
  if (!here) return { projects: [...list, shared], id: shared.id, copy: false };
  if (!(here.updatedAt > shared.updatedAt)) return { projects: list.map((p) => (p.id === shared.id ? shared : p)), id: shared.id, copy: false };
  const content = (p: Project) => JSON.stringify({ ...p, id: '', name: '' });
  const saved = list.find((p) => p.id !== shared.id && content(p) === content(shared));
  if (saved) return { projects: list, id: saved.id, copy: true };
  const copy = { ...shared, id: newProject('x').id, name: copyName(shared.name) };
  return { projects: [...list, copy], id: copy.id, copy: true };
}

/** a project that came in by a share link: named in a notice, saved beside one changed here (copy); a link that
 *  could not be read (cut short on the way) is said so */
export interface Arrival {
  name: string;
  copy: boolean;
  at: number;
  broken?: boolean;
}

/** the share link leaves the address once its project is stored, so a reload does not bring it again */
const clearShareHash = () => window.history.replaceState(null, '', window.location.pathname + window.location.search);

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
  /** false when the browser refused to store the projects (private mode, quota) */
  saveOk: boolean;
  /** the project a share link just brought */
  arrival: Arrival | null;
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

/** one-off actions: every click is its own undo step, never merged with the previous one */
const DISCRETE = new Set([
  'h.shape', 'h.wall', 'h.decking', 'h.edgeBoard', 'h.draw', 'h.house', 'h.moveEdge', 'h.moveVertex', 'h.moveStair',
  'h.addStair', 'h.deleteStair', 'h.edgeLength', 'h.notch', 'h.removeNotch', 'h.mirror', 'h.clear',
  'h.moveBreaker', 'h.breakerLength', 'h.addBreaker', 'h.deleteBreaker', 'h.breakerAuto', 'h.boardAxis',
  'h.order', 'h.orderAdd', 'h.orderRemove', 'h.orderRestore', 'h.orderReset', 'h.price',
]);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadJSON<Lang>(LS.lang, 'zh'));
  // the projects stored here, and the one a share link brings (opened, and no sample made for it)
  const [boot] = useState(() => {
    const stored = loadJSON<Partial<Project>[]>(LS.projects, []);
    let list = stored.filter(isProjectLike).map(migrateProject);
    let current = loadJSON<string>(LS.current, '');
    let arrival: Arrival | null = null;
    const histories: Store['histories'] = {};
    const shared = sharedProject(window.location.hash);
    if (shared && isProjectLike(shared)) {
      const r = receiveShared(list, migrateProject(shared), (name) => translate(lang, 'share.copyName', { name }));
      const p = r.projects.find((x) => x.id === r.id)!;
      list = r.projects;
      current = r.id;
      histories[r.id] = initHistory(p, 'h.shared');
      arrival = { name: p.name, copy: r.copy, at: Date.now() };
    } else if (isShareHash(window.location.hash)) arrival = { name: '', copy: false, at: Date.now(), broken: true };
    if (!list.length) {
      const rules = loadJSON<RuleSet | null>(LS.rules, null);
      const prices = loadJSON<Record<string, number> | null>(LS.prices, null);
      list = [newProject(lang === 'zh' ? '示例 deck' : 'Sample deck', true, rules ?? undefined, prices ?? undefined)];
    }
    return { store: { projects: list, histories }, current, arrival };
  });
  const [store, setStore] = useState<Store>(boot.store);
  const [currentId, setCurrentId] = useState<string>(boot.current);
  const [arrival, setArrival] = useState<Arrival | null>(boot.arrival);
  const [ui, setUiState] = useState<UIState>({
    tool: 'select',
    selection: null,
    snap: 50,
    layers: { frame: true, boards: true, posts: true, balustrade: true, dims: false, house: true, cuts: true },
    mode: 'design',
    panelTab: 'params',
    advanced: false,
    drawMode: false,
  });
  const [lastHistoryAction, setLastHistoryAction] = useState<HistoryAction | null>(null);
  const [saveOk, setSaveOk] = useState(true);

  const projects = store.projects;
  const project = useMemo(() => projects.find((p) => p.id === currentId) ?? projects[0], [projects, currentId]);
  const cur = project?.id;

  useEffect(() => {
    if (project && project.id !== currentId) setCurrentId(project.id);
  }, [project, currentId]);

  // persist (debounced, and immediately when the page is being hidden or closed)
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(LS.projects, JSON.stringify(projects));
        localStorage.setItem(LS.current, JSON.stringify(currentId));
        setSaveOk(true);
      } catch {
        setSaveOk(false);
      }
    };
    const h = setTimeout(save, 300);
    window.addEventListener('pagehide', save);
    window.addEventListener('visibilitychange', save);
    return () => {
      clearTimeout(h);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('visibilitychange', save);
    };
  }, [projects, currentId]);
  useEffect(() => saveJSON(LS.lang, lang), [lang]);

  const design = useMemo(() => computeDesign(project), [project]);

  const setUi = useCallback((patch: Partial<UIState>) => setUiState((u) => ({ ...u, ...patch })), []);

  const updateProject = useCallback(
    (fn: (p: Project) => Project, label: string | boolean = 'h.edit', coalesceMs?: number) => {
      const lbl = typeof label === 'string' ? label : 'h.edit';
      const window_ = coalesceMs ?? (DISCRETE.has(lbl) ? 0 : 1200);
      setStore((s) => {
        const id = cur ?? s.projects[0]?.id;
        const p = s.projects.find((x) => x.id === id);
        if (!p) return s;
        const changed = fn(p);
        // handlers often rebuild the object with the same values: that is not an edit
        if (changed === p || JSON.stringify(changed) === JSON.stringify(p)) return s;
        const next = { ...changed, updatedAt: new Date().toISOString() };
        const h = pushHistory(historyFor(s, p), next, lbl, Date.now(), window_);
        return { projects: s.projects.map((x) => (x.id === id ? next : x)), histories: { ...s.histories, [id]: h } };
      });
    },
    [cur],
  );

  const applyHistory = useCallback(
    (kind: HistoryAction['kind'], move: (h: History<Project>) => History<Project>) => {
      const p = store.projects.find((x) => x.id === cur);
      if (!p) return;
      const h = historyFor(store, p);
      const nh = move(h);
      if (nh === h) return;
      const from = h.entries[h.index];
      const label = kind === 'undo' ? from.label : nh.entries[nh.index].label;
      setStore({ projects: store.projects.map((x) => (x.id === p.id ? currentState(nh) : x)), histories: { ...store.histories, [p.id]: nh } });
      setLastHistoryAction({ kind, label, at: Date.now() });
      setUiState((u) => ({ ...u, selection: null }));
    },
    [cur, store],
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

  // a share link opened while the app is open: the same as at the start
  const receive = useCallback(
    (hash: string) => {
      if (!isShareHash(hash)) return;
      clearShareHash();
      const shared = sharedProject(hash);
      if (!shared || !isProjectLike(shared)) {
        setArrival({ name: '', copy: false, at: Date.now(), broken: true });
        return;
      }
      const r = receiveShared(store.projects, migrateProject(shared), (name) => translate(lang, 'share.copyName', { name }));
      const p = r.projects.find((x) => x.id === r.id)!;
      setStore({ projects: r.projects, histories: { ...store.histories, [r.id]: initHistory(p, 'h.shared') } });
      setCurrentId(r.id);
      setUiState((u) => ({ ...u, selection: null, tool: 'select', mode: 'design', drawMode: false }));
      setArrival({ name: p.name, copy: r.copy, at: Date.now() });
    },
    [store, lang],
  );
  useEffect(() => {
    if (isShareHash(window.location.hash)) clearShareHash();
  }, []);
  useEffect(() => {
    const onHash = () => receive(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [receive]);

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
    const rest = store.projects.filter((p) => p.id !== project.id);
    const histories = { ...store.histories };
    delete histories[project.id];
    if (!rest.length) {
      const fresh = newProject(lang === 'zh' ? 'Deck 项目 1' : 'Deck project 1', false, defaultRulesForNew());
      rest.push(fresh);
      histories[fresh.id] = initHistory(fresh, 'h.open');
    }
    setStore({ projects: rest, histories });
    setCurrentId(rest[0].id);
  }, [store, project, lang, defaultRulesForNew]);

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
    project, projects, design, lang, ui, canUndo, canRedo, saveOk, arrival, history, historyIndex, lastHistoryAction,
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
