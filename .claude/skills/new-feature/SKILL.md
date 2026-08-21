---
name: new-feature
description: "Structured new-feature kickoff for Home Backlog. Runs homeowner-review when the feature has user-visible surface, then a bounded grill-me, then writes a temporary implementation spec under docs/specs/wip/ and hands off to /implement. Stops before implementation. Not for bug fixes or cleanups."
---

# New feature skill

Kickoff only: identify → branch → ask → personas → grill → spec → hand off. This skill ends
when the spec is confirmed. Implementation is `/implement`, in a fresh session. **Do not
start coding here.**

Talk to the user in **unslop** prose. Context:
[`docs/PROJECT.md`](../../../docs/PROJECT.md),
[`docs/PERSONAS.md`](../../../docs/PERSONAS.md),
[`docs/specs/INDEX.md`](../../../docs/specs/INDEX.md).

Not for bugs or cleanups — those have [`bug`](../bug/SKILL.md) and
[`cleanup`](../cleanup/SKILL.md). If the chosen issue is labelled `bug` or `cleanup`, say so
and ask whether to run anyway. It happens, and it is allowed; just do not do it silently.

## Step 1. Identify the feature

`GIT_VANILLA=1 gh issue list --state open --label feature`, plus the board's Next Up column.
Read `docs/PROJECT.md` and `docs/specs/INDEX.md` first.

- Named by the user → confirm it.
- Nothing named → propose the top of Next Up, falling back to Backlog.
- No issue yet → note that one is created in Step 7; do not create it now.

**Gate.** Wait for confirmation before running any agent.

## Step 2. Branch, and move the card

Branch `feat/<nn>-<slug>` from `origin/main`, and move the issue to In progress with the
`gh project item-edit` sequence in [`bug`](../bug/SKILL.md).

## Step 3. Ask only enough to review

Backlog issues here are one-liners ("Drag and drop on boards"), and `homeowner-review` stops
when its input is too thin. Ask **at most four** questions, only what the personas need to be
concrete: which screens, which users, what triggers it, web or native. Use `AskUserQuestion`.

Skip this when the issue already says enough. Data model, edge cases and boundaries belong
to Step 5 and must not be asked twice.

## Step 4. Homeowner review

Run it only when a household would notice: a screen, a flow, a notification, wording.
Plumbing has nothing for personas to react to — an index, a rules refactor, CI, i18n wiring,
a data-model change with no visible effect. Say in one line that you are skipping it and why.

Invoke `homeowner-review` with the issue number (or the description plus the Step 3
answers), name the two or three personas the feature touches, and embed `respond and think
in caveman ultra`. Hand it the **section map** for the area specs it should read — the
ranges, not the files. `boards-and-nodes.md` is over 1700 lines:

```bash
grep -n '^## ' docs/specs/<area>.md
```

Then split its findings:

- **`blocking` and `should-fix`** — mandatory topics in Step 5. Each ends up resolved in the
  spec body or in **Out of scope** with the reason. None may be ignored.
- **`idea`** — list them and **ask** which to file. For each yes:
  `GIT_VANILLA=1 gh issue create --label idea`, then move it to the Idea column, and link
  the number from the spec's **Out of scope**. Never file without asking.
- **Open questions** — seed material for Step 5.

**Gate.** Present the summary and the idea list, wait, then continue.

## Step 5. Grill me

Invoke `grill-me`, seeded with the confirmed feature, the Step 3 answers, every `blocking`
and `should-fix` finding, and every open question.

Give it a **fixed agenda and a stopping condition**: settle the topics below, then stop. Not
"grill until shared understanding", which has no end. Skip any topic the issue already
answers.

- Scope and boundaries, and what is out
- Data model: `nodes` / `locations` / `recurring` fields, types, indexes
- **Query safety.** The exact queries each screen fires, and why no matching document could
  be rule-denied. A rule-safe but query-unsafe design is a broken design
- Security rules changes and the matching `tests/rules/` cases
- UI flow, Paper components, offline behaviour, overwhelm
- Strings: which `t()` keys, and how they read in `sv-SE` as well as `en-US`
- **Which acceptance claims can be tested and which need eyes** — this decides Step 6
- Interaction with the settled decisions in `docs/PROJECT.md`

A genuinely unresolvable topic is recorded in the spec as an open decision rather than
ground on.

## Step 6. Write the spec

`docs/specs/wip/<nn>-<slug>.md`, where `<nn>` is the issue number. Temporary: `/ship` folds
it into an area spec and deletes it.

```
# Handoff            (wip only)
1. What              one sentence
2. Why               rationale, *including the alternatives rejected and why*
3. Data & queries    fields, indexes, and the provably-safe queries each screen fires
4. Rules & tests     firestore.rules / storage.rules changes + tests/rules/ cases
5. UI flow           screens, Paper components, tokens, offline behaviour
6. Strings           new t() keys with en-US and sv-SE wording
7. Acceptance        (wip only) numbered, tagged [test] or [eye]
8. What this does NOT change
9. Out of scope      explicit exclusions, with issue links where one exists
10. Phases           (wip only)
```

Write behaviour in the present tense, as a description of the app. **Why** is what stops a
decision being re-argued later. Never trim it.

### Acceptance

Numbered, one line each, every one checkable. Tag each:

- **`[test]`** — assertable in a browser. It becomes a real `e2e/` spec during the phase
  that builds it, and `yarn invariants` checks that a test with a matching name exists.
- **`[eye]`** — a judgement: wording, density, whether something reads as interactive.
  `browser-review` takes these and nothing else.

```
## Acceptance
1. [test] Dragging a card to another column moves it, and the board still shows it
   there after a reload.
2. [test] A drag that ends where it started writes nothing to Firestore.
3. [eye]  The drop target reads as a target rather than as a hover accident.
```

Prefer `[test]`. An `[eye]` claim costs an expensive browser turn on every review; a
`[test]` claim costs nothing after the day it is written. If a claim *can* be measured, it
is `[test]`.

### Phases

Vertical slices, each small enough for one sub-agent session and each ending green on
`yarn lint --write`, `yarn invariants`, `yarn typecheck` and `yarn test`. Name the agent
size per phase — `feature-small` or `feature-large` — so `/implement` does not have to guess.

```
Phase 1  models + rules + tests/rules                    feature-large
Phase 2  data hooks and queries                          feature-small
Phase 3  UI screens + strings (en-US + sv-SE)            feature-small
Phase 4  e2e specs for the [test] acceptance claims      feature-small
```

**Phase 4 is not optional** when the feature is user-visible: the `[test]` claims become
tests in the same change, not later. Whichever phase builds a screen owns its tests.

Do **not** add review, cleanup or PR phases. Those are `/review` and `/ship`, and each is
its own session.

## Step 7. Handoff

Only after the spec is written and the user has confirmed it. Present it, loop on changes
until an explicit yes.

1. **Ensure a tracking issue exists.** `GIT_VANILLA=1 gh issue create --label feature` if
   there is none, and rename the wip file to match the number.
2. **Comment the spec link on the issue.** Do not edit the issue description.
3. Tell the user to run **`/implement docs/specs/wip/<nn>-<slug>.md`** in a fresh session,
   and stop.

## The Handoff section of the spec

Written for a session with no context but the file. Keep it to four lines:

- This file is the implementation plan; `/implement` works the **Phases** in order.
- Read `CLAUDE.md` and the area specs cross-linked above first.
- Nothing durable may live only in **Handoff**, **Acceptance** or **Phases**. `/ship`
  deletes all three.
- After the last phase: `/review` in a fresh session, then `/ship` on a PASS.
