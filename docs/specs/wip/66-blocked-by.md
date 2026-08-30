# Blocked-by: mark a node as blocked by another

## Handoff

- This file is the implementation plan; `/continue-work` works the **Phases** in order, reviews, and ships.
- Read `CLAUDE.md`, `docs/DESIGN.md`, [`boards-and-nodes.md`](../boards-and-nodes.md) and [`overview.md`](../overview.md) first; the REST contract lives in [`rest-api.md`](../rest-api.md).
- Nothing durable may live only in **Handoff**, **Surface brief**, **Acceptance** or **Phases**. `/ship` deletes all four.
- The run stops at a draft PR. The merge is the user's.

## What

A card can wait on other cards: pick blockers from the card menu or the detail screen, see what a card is waiting on, and the waiting state resolves itself from the blockers' own statuses. `blockedBy[]` already exists on the document; nothing in the UI wrote it before this feature.

The feature has a surface: the card face, the card menu, the detail screen and Overview all change.

## Why

Real household work waits on other work — "Lay tiles" waits on "Order tiles", "Stain the greenhouse benches" waits on "Replace the cracked pane". Marcus speaks this natively ("blocked on"); Nadia and Ingrid need it said as waiting. The suggestion engine ([#55](https://github.com/Senth/home-backlog/issues/55)) needs `blockedBy` as its actionability test and its "unblocks" score input, so the field had to become real before that issue.

Decisions already settled elsewhere, kept:

- **`blocked` is not a status.** A card stays in its real column and shows a mark — the condition, not a stage (`boards-and-nodes.md` § "`blocked` is not a status").
- **Blocker titles live on the detail screen, not the card face.** A chip row of titles on the face drowns a column of ten waiting cards.

The rejected alternatives, and why:

- **Auto-clear: completing a blocker removes it from every waiting card's `blockedBy`.** Rejected by the owner, and the mechanism is worse than it looks. The client cannot run the safe query pair the counters use: the shared half is `visibility == 'shared' && blockedBy array-contains <id>`, but the private half needs `participantIds array-contains` *and* `blockedBy array-contains` — Firestore allows one `array-contains` per query, so the private half has no provably safe query. Doing it from a Cloud Function contradicts `PROJECT.md` ("node operations stay client-side and offline-capable"). Doing it with a denormalized reverse list (`unblocks[]` on the blocker) survives the query problem, but the owner's call removes the need: references are kept.
- **Blocked-by as a moment that passes.** Clearing on completion loses the one thing a reopened blocker needs: the wrong delivery arrives, "Order tiles" reopens, and the waiting cards would stay free with no memory of why. So `blockedBy` is a **durable relation**: nothing in the app ever removes an entry except a person. Completing a waiting card keeps its `blockedBy` too — in Done it is inert history.
- **"Blocked by" wording.** Project jargon; Ingrid's stated quit line is learning a vocabulary for something she already understands. The app says waiting, in both languages.

## Data & queries

`blockedBy: string[]` keeps its shape, default `[]`, validated as a list by the rules since the field shipped. **No new field, no new status, no backfill** — every document carries it from birth. New model helpers in `models/node.ts`:

- `unresolvedBlockers(node, blockerById: Map<string, Node>) → string[]` — the entries whose blocker is missing from the map or whose blocker's `status != 'done'`. "Waiting" means this list is non-empty and the node itself is not done. A missing blocker waits: honest *not yet* beats a mark that lies either way.
- A blocker may be any non-done node — project, task or step. No cap on list length; realistic use is one or two, and the REST API already writes the field.

**How each screen resolves blocker statuses:**

- **The board.** Blockers on the same board (children of the same parent) resolve from the board's own query pair — the merged results carry every status column, so this is free. Blockers living anywhere else are watched by a `BlockerWatcher` mounted once per board screen: one invisible component per cross-board blocker id, each a single-document `useNode` listener, deduped across cards and torn down with the screen. Single-document listeners are the app's existing pattern (the detail screen's root listener); they cannot be query-denied the way a multi-document query can. Until a watched document loads, its card waits — the not-yet direction.
- **The detail screen.** One-shot `getNode` per blocker id — the breadcrumb precedent: deliberately *n* single reads, never `documentId() 'in' <ids>`, because one unreadable blocker must not erase every row. A `null` read renders the gone row (below). Read fresh when the screen focuses, so a reopened blocker re-blocks on return.
- **The picker's home-wide search** (online only, one-shot `getDocsFromServer`, fired debounced on a non-empty query):

  - Q-S1: `archived == false && completedAt == null && visibility == 'shared' && orderBy('updatedAt', 'desc') && limit(50)` — provably safe: `visibility == 'shared'` is the read rule's first disjunct.
  - Q-S2: `archived == false && completedAt == null && participantIds array-contains <uid> && orderBy('updatedAt', 'desc') && limit(50)` — provably safe: `array-contains <uid>` is the second disjunct.

  Results merge and dedupe by id, filter client-side on a case-insensitive title substring, and drop self, existing blockers and done. `completedAt == null` is "not done", so a blocker's past stays out of the picker even when custom statuses arrive. The 50-cap means a home of thousands of dormant cards can miss candidates; the search says so rather than pretending completeness. **Two new composite indexes** in `firestore.indexes.json`: `(archived, completedAt, visibility, updatedAt DESC)` and `(archived, completedAt, participantIds, updatedAt DESC)` — the existing pairs end in `dueDate` or `completedAt`, neither of which orders candidates usefully.

No listener is added for the search; no query is fired until the picker is used. The mark on Overview and the board reuses statuses already in hand or the watcher's documents — no new collection-wide subscription anywhere.

## Rules & tests

**No rules change.** `blockedBy is list` already validates every write (firestore.rules:272), pick and unpick are ordinary `updateNode` writes on the blocked card, and `unblocks[]` was rejected with the cascade. `tests/rules/` gains cases only if a rule line changes — it does not.

The REST API keeps writing `blockedBy` as it does today (`body.ts`, `validate.ts`, `writes.ts`, `bulk.ts`). What changes is documentation: `functions/SKILL.md`'s field-table row for `blockedBy` currently says "Stored, no screen yet. Nothing renders it today" — false the day this ships. It becomes: rendered as *Waiting*; the app derives the state from the blockers' statuses; **nothing auto-clears it**, a done blocker stops holding cards, and reopening re-blocks them; an agent that writes a private node's id into a shared card's list leaves the other members a row they cannot read and can remove. The same two sentences go into `rest-api.md` where the field is listed as stored-only.

## Surface brief

- Job:      Marcus sees that "Lay tiles" is held by "Order tiles", and Nadia sees why her Saturday card is not hers yet
- Primary:  pick a card this one waits on. Exactly one primary action
- Read:     1st the card title · 2nd what it waits on, as titles · 3rd each blocker's state (waiting or done)
- Not like: a dependency graph, a Jira issue-link panel, anything that invites a diagram
- Remove / quiet / sharpen:  remove nothing — sharpen the existing face mark with a count, and make the picker's same-board-first priority visible as group headers

## UI flow

**The card face** (BoardCard). The mark exists: `pause-circle-outline` plus the word *Waiting* in the warning colour. It gains a count when more than one blocker holds the card (*Waiting · 2*), an `accessibilityLabel` with the plural form, and one behaviour change: it renders from `unresolvedBlockers`, not from `blockedBy.length` — a done blocker stops marking its dependents, and a card in Done never marks, whatever its list holds. The colour stays: it is the warning colour, not red, and the words and the icon already separate it from the overdue text beside it; `browser-review` judges whether the two fight.

**The card menu** gains a *Waiting on…* page, the same page mechanism as *Move under…* (scroll inside the height Paper measured, never a second overlay):

- Chosen blockers first, check-marked; tapping one unpicks it.
- Then the other cards **on this board** under a *On this board* header — free, from the board's nodes already in hand, and this works offline.
- Then a *Search everywhere…* item under an *Everywhere* header, opening the search dialog. It needs the server, so it is disabled with the offline hint exactly like *Move under…*.

**The search dialog** (shared by menu and detail screen, the `TitleDialog`/`ConfirmDialog` mounting precedent): a search field, debounced ≥ 2 characters, firing Q-S1 + Q-S2 once per settled query; a capped, deduped, title-filtered list; a footer line when the cap was hit. Tapping a result picks it and closes; tapping a picked result unpicks it. Offline the dialog says it needs a connection.

**The detail screen** gains a *Waiting on* section between the notes field and the people section — below notes so Ingrid's chimney-sweep note keeps its place, and rendered always, because an add affordance nobody can find is a feature nobody has. One row per blocker: its title, and its state — a *Done* chip when the blocker has completed, nothing when it is still going. A blocker that is gone or unreadable renders as a row saying so (the deleted-card sentence, the `members.unknown` register) with the remove action beside it; a mark with nothing behind it is Ingrid's "tapped something and cannot find my way back", rebuilt as data. Each row carries a remove affordance labelled *Stop waiting on {{title}}*. An add row opens the search dialog.

**Overview.** `RowMeta` carries the card face's own marks deliberately; the waiting mark joins it, so a blocked project answers Overview's "is anything on fire" honestly. `overview.md`'s out-of-scope line "a blocked mark on a row — `blockedBy` is not built" is corrected in the same change.

**Offline.** Pick and unpick are `updateNode` writes and queue like every other field write; same-board picks work in a shed with no signal, and the mark updates from the local cache. The search dialog and the detail rows' title reads need the server and say so. The board's watcher degrades the way `useNode` does: cached blockers render, unreachable ones hold the card in waiting.

**Tokens and components.** `MetaChip` carries no new chip — the mark is the existing icon-plus-label row. The state chip on a detail row is a `MetaChip` (not a control, the *Hidden* precedent). Spacing, icon sizes and touch targets come from `space` / `icon` / `touchTarget`; no numeric literal in any style prop, no colour outside `theme/`.

## Strings

All through `t()`, `en-US.json` and `sv-SE.json` in the same change. The face word `board.blocked` (*Waiting* / *Väntar*) already exists and stays. New keys, with the register settled in review:

| Key | en-US | sv-SE |
| --- | ----- | ----- |
| `board.waitingOn` | Waiting on… | Väntar på… |
| `board.waitingLabel` | (plural, a11y) Waiting on {{count}} task/tasks | Väntar på {{count}} uppgift/uppgifter |
| `board.waitingGroupBoard` | On this board | På den här tavlan |
| `board.waitingGroupEverywhere` | Everywhere | Överallt |
| `board.waitingSearch` | Search everywhere… | Sök överallt… |
| `detail.waitingOn` | Waiting on | Väntar på |
| `detail.waitingAdd` | Add a card this one waits on | Lägg till ett kort den här väntar på |
| `detail.waitingSearchTitle` | Find the card it waits on | Hitta kortet det väntar på |
| `detail.waitingSearchPlaceholder` | Search cards | Sök kort |
| `detail.waitingSearchEmpty` | No cards match | Inga kort matchar |
| `detail.waitingSearchCapped` | Showing the first {{count}} — refine the search | Visar de första {{count}} — begränsa sökningen |
| `detail.blockerDone` | Done | Klar |
| `detail.blockerGone` | That card is gone. | Det kortet är borta. |
| `detail.stopWaitingOn` | Stop waiting on {{title}} | Sluta vänta på {{title}} |
| `detail.stopWaitingOnGone` | Stop waiting on it | Sluta vänta på det |

The offline hint reuses `board.offlineHint`. i18next plurals carry the label; "uppgift" is the register `sv-SE` already uses for tasks — check the existing locale for the word the app actually uses on cards and stay with it.

## Acceptance

1. [test] Picking a card on the same board from the card menu marks the card Waiting, with the count when a second blocker is picked, and lists both titles on the details screen.
2. [test] Finding a card on another board through *Search everywhere…* marks the card Waiting and its title appears on the details screen.
3. [test] Completing the blocker clears the waiting mark and its details row shows Done, without a reload; reopening the blocker brings the mark back.
4. [test] *Stop waiting on* removes the row, and the mark goes when the last blocker goes.
5. [test] Completing a waiting card keeps its `blockedBy` in the document and shows no mark in the Done column.
6. [test] Deleting a blocker leaves its row saying the card is gone, with the remove action working, and the mark stays until the row is removed.
7. [test] Picking a same-board blocker offline queues the write and lands it when the connection returns.
8. [test] A blocked project shows the waiting mark on Overview.
9. [eye]  The waiting mark reads as *not yet*, never as an alarm, and does not fight the overdue text on the same card.
10. [eye] The picker's group headers make the same-board-first priority visible without reading the help text.

## What this does NOT change

- The status enum, the column set, the drag, the counters, the two board queries, the visibility invariant — none of it moves. The mark is a render over `blockedBy`, and every write it needs is an `updateNode`.
- The REST API's write path: `blockedBy` is accepted today and accepted tomorrow, unchanged (`body.ts` line 55/240, `validate.ts` line 211, `writes.ts`, `bulk.ts`). Only its documentation changes.
- The suggestion engine. #55 reads `unresolvedBlockers` when it exists; nothing here builds it.
- `moveNode`, `createNode`, `deleteNode`: completion writes `status`, `rank`, `completedAt` and the counters, and nothing else; deletion does not sweep references — the gone row is the answer, deliberately.
- The detail screen's other sections and their order above the new one.

## Out of scope

- **A cycle warning in the picker**, [#183](https://github.com/Senth/home-backlog/issues/183). A–waits-on–B–waits-on–A is permitted and renders: two marked cards, both fixable at either end. The warning is a best-effort nicety when both nodes are already in hand.
- **What a card unblocks — the reverse view**, [#184](https://github.com/Senth/home-backlog/issues/184). One-shot read only; note for that issue: the shared half is a safe query (`visibility == 'shared' && blockedBy array-contains <id>`), the private half has no safe query shape, so a reverse list would have to be denormalized there if the view ever needs private cards.
- **The suggestion engine itself**, [#55](https://github.com/Senth/home-backlog/issues/55). This feature hands it `unresolvedBlockers`; it owns the score.
- **Archive interplay**, [#64](https://github.com/Senth/home-backlog/issues/64). An archived blocker still holds its dependents under this spec; #64 decides whether archiving a blocker reads as done. Filed there to keep one owner per lifecycle.
- **Recurring instances as blockers** — no special case. A maintenance instance is a node and may block; the location board surfaces them where they live.
- **Server-side cycle prevention or any Cloud Function** — `PROJECT.md` keeps node operations client-side and offline-capable.

## Phases

Each phase ends green on `yarn lint --write`, `yarn invariants`, `yarn typecheck` and `yarn test`.

- **Phase 1 — model and data.** `unresolvedBlockers` in `models/node.ts` with jest cases (missing blocker, done blocker, done card, empty list); the two search queries + `firestore.indexes.json` composites, with query-shape tests beside the existing query tests; the pick/unpick writes land through `updateNode` as-is, so no data-layer code beyond the queries.
- **Phase 2 — UI.** The face mark's count and derivation; the card menu's *Waiting on…* page; the search dialog; the detail screen's *Waiting on* section; Overview's `RowMeta` mark; all strings in `en-US.json` and `sv-SE.json`.
- **Phase 3 — contract and spec hygiene.** `functions/SKILL.md`'s `blockedBy` row, the `rest-api.md` field note, `overview.md`'s stale out-of-scope line, and the "Nothing in the UI writes `blockedBy` yet" sentences in `boards-and-nodes.md` — the last stays for `/ship` to fold, the first three change here.
- **Phase 4 — e2e.** The eight `[test]` claims as `e2e/` specs titled by claim number.
