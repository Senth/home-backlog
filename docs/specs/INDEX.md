# Index of specs

One spec per **feature area**, describing behaviour as it currently ships, in the present
tense. Specs carry the *why*, the rationale and the alternatives that were rejected, so
decisions are not re-litigated. They are not implementation plans.

A feature does not get its own file. It is written as a temporary per-issue spec under
[`wip/`](wip/) by the [`new-feature`](../../.claude/skills/new-feature/SKILL.md) skill,
and [`/ship`](../../.claude/skills/ship/SKILL.md) folds that content into the area spec
below and deletes the wip file. Folding means rewriting the affected sections, never appending a chapter: an area
spec must read as one description of the app. Everything that matters survives the
rewrite. The *why*, the rejected alternatives, formulas, thresholds, tables.

`wip/` is never listed here.

| Spec | Description | Tags |
| ---- | ----------- | ---- |
| [`platform-offline`](platform-offline.md) | How the app gets onto a device, who it lets in, what language it speaks, and what survives losing the connection. Google redirect sign-in on a same-origin `authDomain`, the splash that holds the router until auth resolves, the account menu and its deliberate sign-out, the service worker and install offer, `en-US` / `sv-SE`. And the app-wide palette: a green brand over neutrals re-hued off Material's violet default at unchanged luminance, so no contrast ratio moves, mapped onto react-navigation's own roles as well so no navigator paints its stock grey. | auth, pwa, offline, i18n, theme |
| [`home-and-members`](home-and-members.md) | The container everything else lives in. Creating a home and moving between several from a `/homes` level above the boards, membership and roles, invitations keyed by a hash of the invitee's address and found with a collection-group query, carrying the one decision a new member's arrival needs — whether they join every shared project or none of them — the last-owner rule, and a deliberately narrow delete. | homes, membership, invites, privacy |
| [`rest-api`](rest-api.md) | What a household's own AI agent drives, and the screens that keep it accountable. A REST API on Cloud Functions under `/api/v1`, authenticated by API keys that are the person rather than the home. Validation is mirrored from `firestore.rules` in TypeScript, because the function writes with the Admin SDK so that a whole subtree commits in one atomic batch. The node verbs, with `PATCH` owning moves and reparents and `DELETE` asking before it cascades. A bulk create that resolves caller-chosen refs, reports errors per index and replays on an `Idempotency-Key`. And a `SKILL.md` the deployment serves, so an agent reads the contract it is talking to. Plus the three screens that make it visible: Automations, the automations a home has been written into by, and a line on every agent-written card. | api, keys, agents, functions, bulk, idempotency |
| [`boards-and-nodes`](boards-and-nodes.md) | The one document every board, project, task and subtask is made of, and every screen that renders it. The field set, the uniform-visibility invariant that makes privacy queryable, the two provably safe queries a board load merges, fractional `rank`, the column set frozen by depth, and board-ness derived from a stored child count rather than flagged. Three separate fields for whose project it is, who is doing the card and who may see it — a root always naming its people rather than an empty list standing for everyone — with a board that hides everyone else's personal projects by default and a subtree visibility flip that writes top-down and can be resumed. The board itself: drill-down, breadcrumbs, the tab press that lands on the root board, a card menu, and a drag that reorders a card or moves it to another column without changing a single document, rule or query. The board's own surfaces, where a card is raised out of a recessed column and one steps glyph says whether a tap drills in. And the node detail screen carrying notes, due date, priority, effort, participants and assignees, its steps, one disclosure that explains who sees what instead of four grey sentences, and notes that save themselves. A card that waits on another carries a *Waiting* mark derived from its blockers' own statuses — durable until a person removes it, a done blocker releasing its dependents and reopening re-blocking them — picked from a menu page that searches the whole home, with the list and its done and gone rows on the detail screen. Renaming a card from the screen that is about it, or from the board you are standing inside. The strip's two weights — a quiet outlined chip at rest, an inverted fill only while a card is in the air — and a FAB capped at a share of the width it floats over, because at 200% text in Swedish it once spanned nearly the whole screen. | nodes, boards, columns, rank, drag and drop, privacy, participants, assignees, indexes, detail, due dates, surfaces, rename |
| [`overview`](overview.md) | The screen the app opens on, answering *what is going on* without picking a board first. Three fixed sections over the nodes that already exist — the roots in progress, everything dated that is late or due soon, and what was completed in the last thirty days — with no new field and no new document. Six listeners, not eight, because the root board's own pair serves both the first section and the root-scoped hide predicate the other two need. Coming up never repeats a row Ongoing projects is showing, Recently done counts nothing and names nobody, and a "nothing here yet" is gated on the home actually holding no root. Plus the tab order, the landing route, the install offer that follows it, and the air between the sections that a board column deliberately does not get. | overview, landing, due dates, sections, listeners |

## Planned areas

Candidate homes for the first specs, from [`../PROJECT.md`](../PROJECT.md). A file is born
when the first feature touching it lands; this list is a naming convention, not a promise.

- `location-tree`. The second hierarchy, `locationId` / `locationAncestorIds[]`,
  inheritance, roll-up views.
- `recurring-maintenance`. Templates, lazy instance materialization, the three rule types,
  one open instance per rule.
- `suggestions`. The on-device weighted score and the reasons it shows.
- `calendar`. The dated view [`overview`](overview.md) deliberately does not navigate to.

_(`platform-offline`, `home-and-members`, `boards-and-nodes`, `rest-api` and `overview`
have landed. See the table above.)_
