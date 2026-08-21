---
name: new-feature
description: "Structured new-feature kickoff for Home Backlog. Use when starting a feature from the Kanban board, picking up a backlog issue, or planning the next feature. Runs the homeowner-review agent when the feature has user-visible surface, then a bounded grill-me, then writes a temporary implementation spec under docs/specs/wip/ and hands it off. Stops before implementation. Not for bug fixes or cleanups."
---

# New feature skill

Kickoff only: identify → branch → ask → homeowner review → grill → spec → handoff. The skill
ends when the spec is confirmed. Implementation happens in a
separate session that reads the spec. Do not start coding here.

Work lives in GitHub Issues and the Kanban board (project 4, columns Backlog / Next Up /
In progress / Done). Context:
[`docs/PROJECT.md`](../../../docs/PROJECT.md),
[`docs/PERSONAS.md`](../../../docs/PERSONAS.md),
[`docs/specs/INDEX.md`](../../../docs/specs/INDEX.md).

Not for bug fixes, cleanups or chores. If the chosen issue is labelled `bug` or
`cleanup`, say so and ask whether to run anyway; only continue on an explicit yes. It
happens rarely and is allowed. Do not refuse it.

## Step 1. Identify the feature

`GIT_VANILLA=1 gh issue list --state open --label feature` plus the board's Next Up
column. Read `docs/PROJECT.md` and `docs/specs/INDEX.md` first.

- Feature named by the user → confirm it.
- Nothing named → propose the top of Next Up, falling back to Backlog.
- No issue exists yet → note that one will be created in Step 6; do not create it now.

**Gate.** Wait for confirmation before running any agent.

## Step 2. Switch to a new branch based on origin/main

- Branch `<feat|bug|cleanup>/<nn>-<slug>`.
- Move issue to In Progress.

  ```bash
  NN=<issue-number>
  P=$(GIT_VANILLA=1 gh project view 4 --owner Senth --format json | jq -r .id)
  F=$(GIT_VANILLA=1 gh project field-list 4 --owner Senth --format json \
      | jq -r '.fields[] | select(.name=="Status") | .id')
  O=$(GIT_VANILLA=1 gh project field-list 4 --owner Senth --format json \
      | jq -r '.fields[] | select(.name=="Status") | .options[]
               | select(.name=="In progress") | .id')
  I=$(GIT_VANILLA=1 gh project item-list 4 --owner Senth --format json --limit 500 \
      | jq -r --arg n "$NN" '.items[] | select(.content.number == ($n|tonumber)) | .id')
  GIT_VANILLA=1 gh project item-edit --project-id "$P" --id "$I" \
      --field-id "$F" --single-select-option-id "$O"
  ```

  If the project scope is missing, `gh auth refresh -s project` and retry; if it still
  fails, say so and ask the user to move the card by hand.

## Step 3. Ask only enough to review

Backlog issues here are one-liners ("Drag and drop on boards"). The `homeowner-review`
agent stops when its input is too thin, so ask at most four questions, only the ones
the personas need to be concrete: which screens, which users, what triggers it, web or
native. Use `AskUserQuestion`.

Skip this step when the issue already says enough. Everything else belongs to Step 4 and
must not be asked twice: data model, edge cases, boundaries.

## Step 4. Homeowner review

Run it only when the feature adds or changes something a household notices: a screen,
a flow, a notification, wording. Plumbing has nothing for personas to react to. An index,
a rules refactor, CI, i18n wiring, a data-model change with no visible effect. Say in one
line that you are skipping it and why, then go to Step 4.

When it does run, invoke the `homeowner-review` agent with the issue number (or the
description plus the Step 2 answers), and name the personas the feature touches, usually
two or three. The rest answer in one line each.

Summarise its report, then split the findings:

- **`blocking` and `should-fix`.** Mandatory topics in Step 4. Each one ends
  up either resolved in the spec body or in **Out of scope** with the reason it was
  dropped. None may be ignored.
- **`idea`.** List them and ask which to file as GitHub issues. For each yes:
  `GIT_VANILLA=1 gh issue create --label idea`, and link the number from the spec's
  **Out of scope**. Never file them without asking.
- **Open questions.** Seed material for Step 4.

**Gate.** Present the summary and the idea list, wait, then continue.

## Step 5. Grill me

Invoke the `grill-me` skill, seeded with:

1. The feature as confirmed in Step 1 and the Step 2 answers
2. Every `blocking` and `should-fix` finding
3. Every open question the review emitted

Give it a fixed agenda and a stopping condition: settle the topics below, then stop.
Not "grill until shared understanding", which has no end. Do not ask about a topic the
issue already answers. Topics:

- Scope and boundaries, and what is out
- Data model: `nodes` / `locations` / `recurring` fields, types, indexes
- **Query safety.** The exact queries each screen fires, and why no matching document
  could be rule-denied. A rule-safe but query-unsafe design is a broken design.
- Security rules changes and the matching `tests/rules/` cases
- UI flow, Paper components, offline behaviour, overwhelm
- Strings: which `t()` keys, and how they read in `sv-SE` as well as `en-US`
- Interaction with the settled decisions in `docs/PROJECT.md`. Never re-open one by
  accident

When every topic has an answer, stop and write the spec. If one topic is genuinely
unresolvable, record it in the spec as an open decision rather than grinding on it.

## Step 6. Write the spec

Write `docs/specs/wip/<nn>-<slug>.md`, where `<nn>` is the issue number and `<slug>` a
short kebab title. This file is temporary. It belongs to one issue and may reference
existing area specs by relative path. The cleanup phase deletes it once its content is
folded into a permanent area spec in `docs/specs/`.

Sections, in order:

```
# Handoff            (wip only, deleted by cleanup)
1. What              one sentence
2. Why               rationale, *including the alternatives rejected and why*
3. Data & queries    fields, indexes, and the provably-safe queries each screen fires
4. Rules & tests     firestore.rules / storage.rules changes + tests/rules/ cases
5. UI flow           screens, Paper components, tokens, offline behaviour
6. Strings           new t() keys with en-US and sv-SE wording
7. What this does NOT change
8. Out of scope      explicit exclusions, with issue links where one exists
9. Phases            (wip only, deleted by cleanup)
```

Write behaviour in the present tense, as a description of the app. **Why** is the section
that stops a decision being re-argued later. Never trim it.

### Phases

Vertical slices, each small enough for one sub-agent session and each ending green on
`yarn lint --write`, `yarn invariants`, `yarn typecheck` and `yarn test`. Typical shape:

```
Phase 1  models + rules + tests/rules
Phase 2  data hooks and queries
Phase 3  UI screens + strings (en-US + sv-SE)
...
Phase N-1  review: /review until PASS
Phase N    cleanup (below) + commit, PR, merge
```

The last two phases are mandatory. `CLAUDE.md` forbids component render tests that only
assert layout, so the browser pass is how visuals get checked, and an agent that did not
write the code runs it.

Phase N-1 is `/review`. `code-review` runs first, its fixes applied and green, then
`browser-review` against the clean change, then the fix loop, capped at two rounds. The
skill smoke-tests the primary path itself before opening a browser agent.

**PASS required.** `blocking` findings are never deferrable; a `should-fix` may be
deferred only with a stated reason. Show `idea` findings to the user, who decides which
become issues.

A feature with no user-visible surface takes `/review --code` and says so.

### The cleanup phase

The final phase folds the wip spec into `docs/specs/`:

- Choose the home. Extend an existing area spec whenever the work changes behaviour
  that spec already describes. Write a new area spec only for a new area with
  its own data model and screens. Spanning two areas means updating both and
  cross-linking, never a third file that reads as a diff against the others.
- **Rewrite, never append.** The area spec must read as one description of current
  behaviour, not as a stack of feature chapters. Delete what is no longer true. Keep every
  important thing: the _why_, the rejected alternatives, formulas, thresholds, tables.
- Delete `docs/specs/wip/<nn>-<slug>.md`. Git history keeps it.
- Add or update the row in `docs/specs/INDEX.md`.
- **Refresh `.emulator-seed/`** when the feature adds data every future review should
  see. Create it through the app, then `yarn emulators:export`. The fixture is generated,
  never hand-written.

## Step 7. Handoff

Only after the spec is written and the user has confirmed it. Present it, loop on changes
until an explicit yes.

1. **Ensure a tracking issue exists.** `GIT_VANILLA=1 gh issue create --label feature`
   if there is none. Rename the wip file to match the number.
2. **Comment the spec link on the issue.** Do not edit the issue description.
3. Tell the user the spec is ready and that a fresh session should implement it, then stop.

## The Handoff section of the spec

Written for a session with no context but the file. It states:

- This file is the implementation plan; work the **Phases** section in order.
- Read `CLAUDE.md`, `docs/PROJECT.md` and the area specs it cross-links first.
- Nothing durable may live only in **Handoff** or **Phases**. The cleanup phase deletes
  both.
- One commit per phase, once that phase is green on
  `yarn lint --write`, `yarn invariants`, `yarn typecheck` and `yarn test`.
- **After the cleanup phase**, and only then:

  ```bash
  GIT_VANILLA=1 gh pr create --fill --body "Closes #<nn>"
  GIT_VANILLA=1 gh pr checks --watch
  GIT_VANILLA=1 gh pr merge --squash --delete-branch
  ```

  Any check failing means stop, report, and do not merge.

- Committing, opening the PR and merging are an explicit, user-authorized exception to
  the global "never commit without being asked" rule. The exception covers this flow and
  this feature's branch only. Nothing else may be committed or pushed without asking, and
  nothing is ever pushed straight to `main`, which deploys to production.
