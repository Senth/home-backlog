# Index of specs

One spec per **feature area**, describing behaviour as it currently ships, in the present
tense. Specs carry the *why* — the rationale and the alternatives that were rejected — so
decisions are not re-litigated. They are not implementation plans.

A feature does not get its own file. It is written as a temporary per-issue spec under
[`wip/`](wip/) by the [`new-feature`](../../.claude/skills/new-feature/SKILL.md) skill,
and its cleanup phase folds that content into the area spec below and deletes the wip
file. Folding means **rewriting the affected sections**, never appending a chapter: an
area spec must read as one description of the app. Everything that matters survives the
rewrite — the *why*, the rejected alternatives, formulas, thresholds, tables.

`wip/` is never listed here.

| Spec | Description | Tags |
| ---- | ----------- | ---- |
| [`platform-offline`](platform-offline.md) | How the app gets onto a device, who it lets in, what language it speaks, and what survives losing the connection. Google redirect sign-in on a same-origin `authDomain`, the splash that holds the router until auth resolves, the account menu and its deliberate sign-out, the service worker and install offer, `en-US` / `sv-SE`. | auth, pwa, offline, i18n |
| [`home-and-members`](home-and-members.md) | The container everything else lives in. Creating a home and moving between several from a `/homes` level above the boards, membership and roles, invitations keyed by a hash of the invitee's address and found with a collection-group query, the last-owner rule, and a deliberately narrow delete. | homes, membership, invites, privacy |
| [`boards-and-nodes`](boards-and-nodes.md) | The one document every board, project, task and subtask is made of, and every screen that renders it. The field set, the uniform-visibility invariant that makes privacy queryable, the two provably safe queries a board load merges, fractional `rank`, the column set frozen by depth, and board-ness derived from a stored child count rather than flagged. Three separate fields for whose project it is, who is doing the card and who may see it — with a board that hides everyone else's personal projects by default and a subtree visibility flip that writes top-down and can be resumed. The board itself — drill-down, breadcrumbs, and a card menu — and the node detail screen carrying notes, due date, priority, effort, participants and assignees, its steps, and notes that save themselves. | nodes, boards, columns, rank, privacy, participants, assignees, indexes, detail, due dates |

## Planned areas

Candidate homes for the first specs, from [`../PROJECT.md`](../PROJECT.md). A file is born
when the first feature touching it lands; this list is a naming convention, not a promise.

- `location-tree` — the second hierarchy, `locationId` / `locationAncestorIds[]`,
  inheritance, roll-up views.
- `recurring-maintenance` — templates, lazy instance materialization, the three rule types,
  one open instance per rule.
- `rest-api` — Cloud Functions surface, hashed API keys, the agent-facing `SKILL.md`.
- `suggestions` — the on-device weighted score and the reasons it shows.
_(`platform-offline`, `home-and-members` and `boards-and-nodes` have landed — see the table
above.)_
