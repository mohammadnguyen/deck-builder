# Deck Builder: working notes

One tool for the shop counter, the builder and the crew: draw a deck, get the frame, the boards, drawings,
a priced order list and the construction steps. Residential decks in NSW.

## The design principle (from the owner, standing rule)

Use the most practical method: the design that is economical and saves time, labour and materials while
giving the same result, and always meets the standards and building codes in NSW (NCC Housing Provisions,
AS 1684 timber framing, AS 3660 termites, barrier and stair rules). Whenever the engine has a choice, it
takes the practical one; when a choice depends on the company's own costs or habits, make it a rule the
owner can change rather than a hidden constant.

## Company rules given so far

- Composite decking: joists set out at 400 centres from the start of each bay, the short space last.
  Timber decking: joist spacing evened out per bay.
- Picture-frame edge boards priced separately, 45 degree mitres; double joists under edge board joints.
- The frame follows the boards, and boards are not wasted unless there is no other way. Composite boards
  are 5.4 m at most: a run that fits one board gets no breaker; a longer run gets symmetric breaker boards
  that stop at the edge board, placed where the boards waste least (2.7 | 5.4 | 2.7, halves, thirds,
  quarters); where two placings buy the same boards, the one with fewer joists, then the one without short
  pieces (7.2 m deck: 2.64 | 1.33 | 2.64, not 0.62 | 5.38 | 0.62). One more breaker only when it saves at least
  the boards the owner sets (rule, default 2), and a breaker line carries on to the edge board wherever that
  wastes nothing. Two joists under each breaker.
  Breakers can be moved, resized, added and deleted by hand; no limit on the distance between breakers.
- Stumps 200 diameter x 500 deep. The stump at a house wall stays clear of the house footing.
- Every bearer end sits fully on a stump; bearers join only over a stump with a 45° scarf through the
  depth, centred on the stump (a wall bearer, bolted along the wall, is butted); double bearers join over
  different stumps (a double wall bearer's joins at least a bolt spacing apart).
- Every joist end sits on a bearer; joists join only over a bearer. Field joists are lapped side by side,
  each end running on to the bearer's far face, nailed together (rule); the lapped piece sits one joist over
  toward the start of its bay, and such a bay is spaced so the space it opens stays within the decking's
  limit. Joists under the edge boards and breakers stay in line under the board joints, butted. Only the
  perimeter ends under the edge boards overhang. A run that fits one stick is never joined.
- Framing pine (H3 MGP10 / F7) is bought in the lengths the yard usually has: 3.6, 4.8, 5.4 and 6.0 m (a
  rule the owner can change). Cutting is a rule, simple by default so a crew without a cut list can cut it:
  every stick cut into equal pieces of one length (whole, halves, thirds: 1.8 m from a 5.4 in thirds, not one
  from a 2.4; 2.2 m two from a 4.8), bought in as few lengths as will do, another length only where it saves
  the owner's amount (default $50); never "10 x 5.4, 3 x 2.4, 7 x 6.0, 1 x 4.8". The other choice, least
  timber, mixes lengths and pieces on a stick (the cheapest mix wins). The materials page switches it and
  shows what the other way costs.
- Joins: the fewer the better. A joist or bearer takes pieces up to the longest stick, and of the supports
  that allow the fewest joins, the joins go where the pieces cut cleanly from the stocked lengths.
- Standard frame: 90x45 joists on single 140x45 bearers, stumps at about 1.5 m. The frame is sized
  automatically from the stocked sizes and kept standard unless another frame is clearly cheaper once
  stump labour is counted (rules: labour per stump, switch margin, sizes to choose from).
- Boards are laid from the far edge board so the ripped last row goes against the house (a rule the owner can
  switch); a board running on past an inside corner is notched round it when the strip past the corner is too
  short to lay on its own.
- Spares on the order: 3 decking boards and 1 of each edge board / fascia product (per job); framing by per cent.
- The order follows the cutting diagrams: timber is ordered in exactly the lengths and counts the diagrams cut, plus
  the spares, which the diagrams draw as whole sticks, so the rows add up to the order length for length. By hand a
  timber line only takes more spares, never fewer than the cut; timber counts typed in before (they could leave the
  drawings behind) are dropped when a project loads.
- Existing concrete under part of the deck (a slab, drawn with how far the deck sits above it): no stumps or bearers
  on it; the joists stand on adjustable pedestals set to its level, one under each joist at each support row (a join's
  two ends on the one head), the row along a slab edge just inside it (rule). A wall bearer stays bolted along the
  wall over a slab. Stump holes keep clear of every slab (rule); where the ground beside a slab is too narrow for a
  stump, the joists there stand on pedestals on pads poured beside it, level with it (rule: pad size).
- Stairs to the NCC from the deck height; the last ripped board row is marked; the order list is editable.

## Drawings (owner's ask)

Drawings are for the crew to build from, read by the client and the owner too: the big picture on the sheet
in the simplest form, the small details left to the crew on site. Joists and bearers look clearly different;
every cut of framing timber gets a letter on the framing plan, and the cutting diagrams draw which stick each
letter comes from (lengths within 5 mm share a letter, cut to the longer); the set-out sheet works from string
lines and a datum; standard details show the joins, edge boards and breakers the deck actually has; the
framing plan draws the braces a high deck needs. A deck against the house carries the AS 3660.1 reminder to
keep the house's termite management clear. When editing stops, the results panel prices ways to save (the
boards the other way, a nudge that drops a breaker or the ripped row) for the counter to offer.

## Working in this repo

- `npm test` (vitest), `npm run typecheck`, `npm run build` (typecheck + Vite build).
- The engine is pure and fast: `computeDesign(project)` in `src/engine/index.ts` calls `computeLayout`
  (`src/engine/layout.ts`, boards along x; a y layout is computed in a swapped frame), then `buildBom`
  and `buildMethod`. Keep a design under about 10 ms; the editor recomputes it while dragging.
- Every user-facing string exists in both `src/i18n/zh.ts` and `src/i18n/en.ts`.
- Projects live in the browser that made them (localStorage). A share link (project menu) carries a whole project in
  the address after `#` (`src/utils/share.ts`): only what differs from `defaultRules()` / `defaultParams()`,
  deflated, so a link made before a default changes opens with the new default; opening it stores the project there.
- A changed rule default that saved rule sets should follow bumps `RULES_VERSION` in
  `src/model/defaults.ts` with a one-off step in `migrateProject` (`src/state.tsx`).
- Prove engine changes with tests and a sweep over many deck shapes, and check the UI in a browser
  (desktop and phone) before shipping.
