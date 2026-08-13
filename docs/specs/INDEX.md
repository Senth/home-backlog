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

## Planned areas

Candidate homes for the first specs, from [`../PROJECT.md`](../PROJECT.md). A file is born
when the first feature touching it lands; this list is a naming convention, not a promise.

- `boards-and-nodes` — the unified node, nesting and drill-down, statuses and board column
  sets, rank ordering, effort, blocked-by.
- `location-tree` — the second hierarchy, `locationId` / `locationAncestorIds[]`,
  inheritance, roll-up views.
- `recurring-maintenance` — templates, lazy instance materialization, the three rule types,
  one open instance per rule.
- `rest-api` — Cloud Functions surface, hashed API keys, the agent-facing `SKILL.md`.
- `suggestions` — the on-device weighted score and the reasons it shows.
_(`platform-offline` and `home-and-members` have landed — see the table above. Node
`visibility` and the participant model still belong to `boards-and-nodes`.)_
