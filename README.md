# Deck Builder

NSW 住宅 deck 的设计、算量和施工方法工具。画一个正交轮廓，工具自动排出 bearer、柱、joist 和面板，
生成放样图、框架图、铺板图、标准节点、材料清单（含下料优化和估价）以及分步施工说明。
纯前端网页，数据保存在浏览器本地，可导出 JSON / CSV / Excel，打印为 A3 PDF。界面中英文可切换。

A design, take-off and method-of-construction tool for residential decks in NSW. Draw an orthogonal
outline, and the tool lays out bearers, posts, joists and boards, then produces a setout plan, framing
plan, decking plan, standard details, a bill of materials with 1D cut optimisation and pricing, and a
step-by-step method. Pure front end, data stays in the browser, exports to JSON / CSV / Excel, prints
to A3 PDF. Bilingual UI (中文 / English).

## 使用 / Usage

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (vitest)
npm run build      # type-check + production build to dist/
```

画图：选择「画 deck 轮廓」，点击放角点（自动正交、吸附），或输入长度后按 Enter 沿当前方向放点；
Enter 闭合，Esc 取消，Backspace 退一点。贴着房屋的边在「选中」面板勾选「贴墙」，或先画房屋墙线让工具自动识别。
楼梯用「添加楼梯」工具点在一条非贴墙边上，可沿边拖动。

Drawing: pick "Draw deck outline", click corners (orthogonal and snapped) or type a length and press
Enter to place the next point along the current direction. Enter closes, Esc cancels, Backspace removes
a point. Mark edges that touch the house in the Selection panel, or draw the house wall first and the
tool detects them. Place stairs with the "Add stairs" tool on any open edge and drag them along it.

## 规则与免责 / Rules and disclaimer

构件跨度、柱距、楼梯几何、栏杆触发高度、exempt 阈值等都在「规则」面板里，随项目保存，也可保存为默认。
内置数值是**保守典型值**，不是 AS 1684.2 的原表。施工前必须按 AS 1684.2、供应商跨度表或工程师核对。
Codes SEPP 的 exempt 判断只是提示，具体以 certifier 为准。

Spans, post spacing, stair geometry, balustrade trigger height and exempt thresholds live in the Rules
panel, saved with each project and optionally as your defaults. The built-in numbers are **conservative
typical values**, not the AS 1684.2 tables. Verify against AS 1684.2, supplier span tables or an engineer
before construction. The exempt-development hint is not a planning determination.

## 结构 / Structure

```
src/engine/      pure rules engine: geometry, layout (bearers/posts/joists/boards), stairs,
                 balustrade, 1D cut optimiser, BOM + pricing, compliance checks, method steps
src/model/       types, product catalog, default rules / params
src/ui/          canvas editor, side panel, print sheets, standard details
src/i18n/        zh / en dictionaries
```

The engine is pure TypeScript with no DOM dependency: `computeDesign(project)` returns everything the
drawings, schedules and method text are rendered from. Tests live in `src/engine/__tests__`.

## 部署到 GitHub Pages / Deploy

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. One-time setup in the
repository: Settings → Pages → Source: **GitHub Actions**. The site is then served at
`https://<owner>.github.io/<repo>/`.

## Roadmap (v2)

- 斜边和任意角度轮廓 / non-orthogonal outlines
- 逐柱地面高程、多标高、切口和绕障碍 / per-post ground levels, split levels, cut-outs
- 钢 / 铝子框架 / steel and aluminium sub-frames
- 底图描线 / tracing over photos or PDF plans
- 地界与 setback 检查 / boundary setback checks
- 云端账号与协同 / cloud accounts and sharing
