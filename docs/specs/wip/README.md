# Work-in-progress specs

Temporary. One file per in-flight issue, `<nn>-<slug>.md`, written by the
[`new-feature`](../../../.claude/skills/new-feature/SKILL.md) skill.

Each file carries `Handoff`, `Acceptance` and `Phases` sections that a permanent spec must
not have. `Acceptance` is scaffolding: its `[test]` claims become real `e2e/` specs during
implementation — `yarn invariants` checks that each one has a test named for it — and its
`[eye]` claims are what `browser-review` judges. By the time the spec is folded, the tests
are the record.
[`/ship`](../../../.claude/skills/ship/SKILL.md) folds the content into an area spec in
[`../`](../), updates [`../INDEX.md`](../INDEX.md) and deletes the file. Git history keeps
it. Nothing here is listed in the index, and nothing durable may live only here.
