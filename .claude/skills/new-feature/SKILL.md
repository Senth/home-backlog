---
name: new-feature
description: "Use when starting a Home Backlog feature, or picking up an issue labelled feature. Not for bugs, cleanups, or implementing a spec that already exists."
---

# New feature skill

Kickoff only: identify → branch → ask → personas → grill → spec → hand off. This skill ends
when the spec is confirmed. Building it is `/continue-work`, in a fresh session. **Do not
start coding here.**

Talk to the user in **unslop** prose. Context:
[`docs/PROJECT.md`](../../../docs/PROJECT.md),
[`docs/PERSONAS.md`](../../../docs/PERSONAS.md),
[`docs/specs/INDEX.md`](../../../docs/specs/INDEX.md),
[`docs/DESIGN.md`](../../../docs/DESIGN.md).

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

`homeowner-review` is the one agent in this repo that stays an **Opus subagent**, spawned
with the `Task` tool. Everything that writes code is dispatched to GLM through the
global `glm-dispatch` skill; this is not that. A persona pass is
plan-time judgement, and its product is the concreteness — the apple trees, the missed gutter
cleaning, the twenty-minute gap before the kids wake up. That is exactly what a cheap model
flattens back into a generic worry, so it stays where the judgement is, and it stays in
**unslop** prose rather than caveman.

Invoke it with the issue number (or the description plus the Step 3 answers) and name the two
or three personas the feature touches. Hand it the **section map** for the area specs it
should read — the ranges, not the files. `boards-and-nodes.md` is over 1700 lines:

```bash
grep -n '^## ' docs/specs/<area>.md
```

Then split its findings:

- **`blocking` and `should-fix`** — mandatory topics in Step 5. Each ends up resolved in the
  spec body or in **Out of scope** with the reason. None may be ignored.
- **`idea`** — list them and **ask** which to file. For each yes:
  `GIT_VANILLA=1 gh issue create --label idea`, then move it to the Idea column in the same
  step, and link the number from the spec's **Out of scope**. An idea sitting in Backlog is
  an idea that gets picked up by accident. Never file without asking.
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
- **The surface**, when the feature is user-visible: whose job it serves, the one primary
  action, what should be read first. Step 6's Surface brief is written from this
- Strings: which `t()` keys, and how they read in `sv-SE` as well as `en-US`
- **Which acceptance claims can be tested and which need eyes** — this decides Step 6
- Interaction with the settled decisions in `docs/PROJECT.md`

Do not invoke `ponytail` here. It belongs at write time, where an unnecessary abstraction is
still a deletion rather than a rewrite, and `/continue-work` runs it there.

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
5. Surface brief     (wip only) — user-visible work only
6. UI flow           screens, Paper components, tokens, offline behaviour
7. Strings           new t() keys with en-US and sv-SE wording
8. Acceptance        (wip only) numbered, tagged [test] or [eye]
9. What this does NOT change
10. Out of scope     explicit exclusions, with issue links where one exists
11. Phases           (wip only)
```

Query safety lives in **Data & queries**. This repo has no privacy document for a section of
its own to serve, and a safety argument split from the queries it is about is an argument
nobody re-reads.

Write behaviour in the present tense, as a description of the app. **Why** is what stops a
decision being re-argued later. Never trim it.

### Surface brief

**Required whenever the feature is user-visible.** It is the write-time half of the design
contract: `/continue-work` hands it to the implement stage together with
[`docs/DESIGN.md`](../../../docs/DESIGN.md), and that is the whole brief the agent gets. A
phase that has to invent the intent for itself invents a different one each time.

Five lines, no more:

```
## Surface brief
- Job:      Ingrid wants to know what the chimney sweep said, six months later
- Primary:  add a note to a node. Exactly one primary action
- Read:     1st the node title · 2nd the note body · 3rd who wrote it and when
- Not like: a chat thread, a comment feed, anything that invites a reply
- Remove / quiet / sharpen:  remove the author avatar · quiet the timestamp ·
            sharpen the add-note affordance
```

Name the tokens and the Paper components in **UI flow**, not here. This section is intent;
that one is mechanism.

Skip it only for plumbing, and say in the spec's **What** line that the feature has no
surface. `browser-review` reads this section to know what the change was trying to be.

### Acceptance

Numbered, one line each, every one checkable. Tag each:

- **`[test]`** — assertable in a browser. It becomes a real `e2e/` spec during the phase
  that builds it. Its test title **starts with the claim's number**, `test("3: …")`, and
  `yarn invariants` fails until every `[test]` claim has one. The number is the contract;
  matching the claim's wording would break the gate on any edit to the sentence.
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

Vertical slices, each small enough for one dispatched session and each ending green on
`yarn lint --write`, `yarn invariants`, `yarn typecheck` and `yarn test`. **Every phase
goes to GLM**, so no phase carries a routing hint, and least of all the phase that changes
how something looks. Visual work is the one people reach for a bigger model on, and it is
the wrong reach: what a screen should look like is decided in `docs/DESIGN.md` and in the
Surface brief, both of which are written before any phase runs. A phase that needs taste
at dispatch time is a phase whose design was never finished, and finishing it is this
skill's job, here, before the user confirms the spec.

```
Phase 1  models + rules + tests/rules
Phase 2  data hooks and queries
Phase 3  UI screens + strings (en-US + sv-SE)
Phase 4  e2e specs for the [test] acceptance claims
```

**Phase 4 is not optional** when the feature is user-visible: the `[test]` claims become
tests in the same change, not later. Whichever phase builds a screen owns its tests.

Do **not** add review, cleanup or PR phases. Those are stages of `/continue-work`, and it
runs them itself.

## Step 7. Handoff

Only after the spec is written and the user has confirmed it. Present it, loop on changes
until an explicit yes.

1. **Ensure a tracking issue exists.** `GIT_VANILLA=1 gh issue create --label feature` if
   there is none, and rename the wip file to match the number.
2. **Comment the spec link on the issue.** Do not edit the issue description.
3. Tell the user to run **`/continue-work docs/specs/wip/<nn>-<slug>.md`** in a fresh
   session, and stop.

## The Handoff section of the spec

Written for a session with no context but the file. Keep it to four lines:

- This file is the implementation plan; `/continue-work` works the **Phases** in order,
  reviews, and ships.
- Read `CLAUDE.md`, `docs/DESIGN.md` and the area specs cross-linked above first.
- Nothing durable may live only in **Handoff**, **Surface brief**, **Acceptance** or
  **Phases**. `/ship` deletes all four.
- The run stops at a draft PR. The merge is the user's.
