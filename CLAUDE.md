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
  quarters), one more breaker only when it saves at least the boards the owner sets (rule, default 2), and a
  breaker line carries on to the edge board wherever that wastes nothing. Two joists under each breaker.
  Breakers can be moved, resized, added and deleted by hand; no limit on the distance between breakers.
- Stumps 200 diameter x 500 deep. The stump at a house wall stays clear of the house footing.
- Every bearer end sits fully on a stump; bearers join only over a stump, each piece taking half;
  double bearers join over different stumps (a double wall bearer's joins at least a bolt spacing apart).
- Every joist end sits on a bearer; joists join only over a bearer, half each; only the perimeter ends
  under the edge boards overhang. A run that fits one stick is never joined.
- Framing pine (H3 MGP10 / F7) is bought in the lengths the yard usually has: 3.6, 4.8, 5.4 and 6.0 m (a
  rule the owner can change). One cut list may mix lengths, cut the way a carpenter would: the cheapest mix
  wins, e.g. 2.5 m joists come from 5.4 m sticks cut in half.
- Joins: the fewer the better. A joist or bearer takes pieces up to the longest stick, and of the supports
  that allow the fewest joins, the joins go where the pieces cut cleanly from the stocked lengths.
- Standard frame: 90x45 joists on single 140x45 bearers, stumps at about 1.5 m. The frame is sized
  automatically from the stocked sizes and kept standard unless another frame is clearly cheaper once
  stump labour is counted (rules: labour per stump, switch margin, sizes to choose from).
- Stairs to the NCC from the deck height; the last ripped board row is marked; the order list is editable.

## Drawings (owner's ask)

Drawings are for the crew to build from, read by the client and the owner too: the big picture on the sheet
in the simplest form, the small details left to the crew on site. Joists and bearers look clearly different;
every cut of framing timber gets a letter on the framing plan, and the cutting diagrams draw which stick each
letter comes from (lengths within 5 mm share a letter, cut to the longer); the set-out sheet works from string
lines and a datum; standard details show the joins, edge boards and breakers the deck actually has.

## Working in this repo

- `npm test` (vitest), `npm run typecheck`, `npm run build` (typecheck + Vite build).
- The engine is pure and fast: `computeDesign(project)` in `src/engine/index.ts` calls `computeLayout`
  (`src/engine/layout.ts`, boards along x; a y layout is computed in a swapped frame), then `buildBom`
  and `buildMethod`. Keep a design under about 10 ms; the editor recomputes it while dragging.
- Every user-facing string exists in both `src/i18n/zh.ts` and `src/i18n/en.ts`.
- A changed rule default that saved rule sets should follow bumps `RULES_VERSION` in
  `src/model/defaults.ts` with a one-off step in `migrateProject` (`src/state.tsx`).
- Prove engine changes with tests and a sweep over many deck shapes, and check the UI in a browser
  (desktop and phone) before shipping.
