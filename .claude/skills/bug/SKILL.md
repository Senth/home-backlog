---
name: bug
description: "Use when something in Home Backlog is broken, or when picking up an issue labelled bug. Not for new features, cleanups, or fixing a defect that already has a spec."
---

# Bug skill

Kickoff only: restate → branch → locate → spec → hand off. This skill ends when the spec is
confirmed. Fixing it is `/continue-work`, in a fresh session. **Do not write the fix here,
and do not write the test here.**

**The failing test is the repro**, and it is Phase 1 of every spec this skill writes. Write
it before the fix, watch it go red, then make it green. One artifact does three jobs: it
proves the thing that was actually reported got reproduced, it is the acceptance criterion,
and it stops the bug coming back silently. A fix written first is a fix nobody can prove, and
the bugs that recur are exactly the ones where nobody wrote the test.

What this skill owes the next session is a spec precise enough that the failing test is
obvious: which level it lives at, what it does, and what its failure must say.

Talk to the user in **unslop** prose. Work lives in GitHub Issues and the Kanban board
(project 4).

## Step 1. Understand the defect

`GIT_VANILLA=1 gh issue view <n> --comments`, or take the description as given.

Restate it in **one line**: what someone did, what they expected, what happened. Show the
user that line. If you cannot write it, you do not have a repro yet — ask for the missing
piece rather than guessing. The most expensive bug fix is the one aimed at the wrong bug.

**Gate.** Wait for confirmation of the restatement before touching anything.

## Step 2. Branch, and move the card

Branch `bug/<nn>-<slug>` from `origin/main`. Move the issue to In progress:

```bash
NN=<issue-number>
P=$(GIT_VANILLA=1 gh project view 4 --owner Senth --format json | jq -r .id)
F=$(GIT_VANILLA=1 gh project field-list 4 --owner Senth --format json \
    | jq -r '.fields[] | select(.name=="Status") | .id')
O=$(GIT_VANILLA=1 gh project field-list 4 --owner Senth --format json \
    | jq -r '.fields[] | select(.name=="Status") | .options[] | select(.name=="In progress") | .id')
I=$(GIT_VANILLA=1 gh project item-list 4 --owner Senth --format json --limit 500 \
    | jq -r --arg n "$NN" '.items[] | select(.content.number == ($n|tonumber)) | .id')
GIT_VANILLA=1 gh project item-edit --project-id "$P" --id "$I" \
    --field-id "$F" --single-select-option-id "$O"
```

**This block is the repo's only copy.** `/new-feature` and `/cleanup` point here rather than
carry their own; three copies drifted last time, and one of them had never worked.

Missing project scope → `gh auth refresh -s project` and retry; still failing → say so and
ask the user to move the card by hand.

## Step 3. Find the cause

Read the code. Do not change it. You are working out two things: where the defect actually
lives, and how wide it is.

**Fix the cause, not the symptom.** If the real cause turns out to be out of scope, say so
plainly, scope the spec to the symptom deliberately, and open an issue for the cause rather
than leaving it implied.

**Grep every caller of the function you are about to touch.** One guard in a shared helper
beats a guard per caller, and a fix that lands on the path someone reported while its three
siblings stay broken is a fix that comes back with a new issue number. Name the callers in
the spec, and say for each whether it is in scope.

Watch for the two shapes this codebase produces:

- A listener that is never unsubscribed, or one constrained on the screen that reported the
  bug and unconstrained on a sibling.
- A query that is rule-safe but not provably safe. One deniable document rejects the whole
  query, so the symptom is an empty screen rather than an error.

## Step 4. Pick the test level

The cheapest level that actually reproduces it. This goes in the spec, and Phase 1 builds it:

| The bug is in | Test |
|---|---|
| logic, a model, a util, a hook | `jest`, a sibling `*.test.ts` |
| a security rule | `tests/rules/` |
| behaviour across a screen, a write, offline, navigation | `e2e/*.spec.ts` |
| **purely visual** — misalignment, a wrong colour in dark mode, a clipped label | no test; see below |

Say in the spec what the test asserts and **what its failure message must say**. It must
fail, and it must fail for the reported reason: a test that passes before the fix is testing
something else, and a test that fails with a different error is reproducing a different bug.
Phase 1 reports which it saw.

**The visual exception.** A bug you can only see cannot be usefully asserted. Skip the test,
capture a screenshot of the defect into `.tmp/review/shots/` as the repro, and verify by
eye after the fix. Say in the report that this bug ships without a regression guard, and
why. Do not stretch a geometry assertion around something that is really a judgement — if
it *can* be measured, it belongs in `e2e/craft.spec.ts` and it is not this exception.

## Step 5. Did the spec lie?

A bug is often a spec that was wrong, or a spec that described behaviour nobody built.
Check the area spec in `docs/specs/` for what you are about to fix:

- **Spec described the correct behaviour, code disagreed** → the code was the bug. Nothing
  to change.
- **Spec described the broken behaviour** → the wip spec says which lines of the area spec
  the fix corrects. It is now documentation of a bug, and `/ship` folds the correction in.
- **Spec said nothing** → add a line where it belongs, if the behaviour is worth stating.

## Step 6. Write the spec

`docs/specs/wip/<nn>-<slug>.md`, the same shape as
[`new-feature`](../new-feature/SKILL.md)'s, minus the sections a fix has nothing to put in.
A bug spec is usually one screen of text:

```
# Handoff            (wip only)
1. What              the one-line restatement from Step 1
2. Why               the cause, in one sentence — not the diff, the cause
3. Data & queries    only when the fix touches a query or a listener
4. Rules & tests     only when firestore.rules or storage.rules changes
5. Surface brief     (wip only) — one line, or omitted
6. UI flow           only when a screen changes
7. Strings           only when a t() key changes
8. Acceptance        (wip only) numbered, tagged [test] or [eye]
9. What this does NOT change   the callers from Step 3 that stay as they are
10. Out of scope     the cause you deliberately did not fix, with its issue number
11. Phases           (wip only) — Phase 1 is the failing test, always
```

**Surface brief.** One line when the fix changes what a household sees — "the drop target
keeps its meaning; only the hit area changes". Omit it entirely when nothing visible moves,
and say so in **What**. The full five-line form is in
[`new-feature`](../new-feature/SKILL.md), and a fix that genuinely redesigns a surface should
be using that skill instead.

Acceptance claims tagged `[test]` map to their test by **number** — `test("1: …")` — and
`yarn invariants` fails until each has one.

Phases carry a routing hint, **GLM** or **Opus**. A bug fix is GLM by default:

```
Phase 1  the failing test, red for the reported reason        GLM
Phase 2  the fix, and the test goes green                     GLM
```

Do not invoke `ponytail` here. `/continue-work` runs it at write time, where a needless
abstraction is still a deletion.

## Step 7. Handoff

Only after the spec is written and the user has confirmed it.

1. **Ensure a tracking issue exists.** `GIT_VANILLA=1 gh issue create --label bug` if there
   is none, and rename the wip file to match the number.
2. **Comment the spec link on the issue.** Do not edit the issue description.
3. Tell the user to run **`/continue-work docs/specs/wip/<nn>-<slug>.md`** in a fresh
   session, and stop.

## What to say

- The one-line restatement from Step 1
- The cause, in one sentence
- The test that will reproduce it, and where it lives
- Every caller you grepped, and which are in scope
- Whether the spec was wrong too
- Anything you deliberately scoped out, and the issue number if you filed one
