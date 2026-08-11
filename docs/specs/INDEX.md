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

_Empty — nothing has shipped yet._

## Planned areas

Candidate homes for the first specs, from [`../PROJECT.md`](../PROJECT.md). A file is born
when the first feature touching it lands; this list is a naming convention, not a promise.

- `boards-and-nodes` — the unified node, nesting and drill-down, statuses and board column
  sets, rank ordering, effort, blocked-by.
- `location-tree` — the second hierarchy, `locationId` / `locationAncestorIds[]`,
  inheritance, roll-up views.
- `recurring-maintenance` — templates, lazy instance materialization, the three rule types,
  one open instance per rule.
- `home-and-members` — homes, membership, participants, `visibility`, and the
  provably-safe query pairs that privacy depends on.
- `rest-api` — Cloud Functions surface, hashed API keys, the agent-facing `SKILL.md`.
- `suggestions` — the on-device weighted score and the reasons it shows.
- `platform-offline` — PWA install, service worker, offline persistence, the pending photo
  upload queue, auth and i18n.
