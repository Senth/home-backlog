---
name: bug
description: "Structured bug fix for Home Backlog. Reproduces the defect as a failing test first, then fixes it, then checks whether the spec was wrong too. Use when picking up an issue labelled bug, or when something is broken. Not for new features or cleanups."
---

# Bug skill

**The failing test is the repro.** Write it before the fix, watch it go red, then make it
green. One artifact does three jobs: it proves you reproduced the thing that was actually
reported, it is the acceptance criterion, and it stops the bug coming back silently.

That ordering is the whole skill. A fix written first is a fix you cannot prove, and the
bugs that recur are exactly the ones where nobody wrote the test.

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

Missing project scope → `gh auth refresh -s project` and retry; still failing → say so and
ask the user to move the card by hand.

## Step 3. Reproduce it as a failing test

Pick the cheapest level that actually reproduces it:

| The bug is in | Test |
|---|---|
| logic, a model, a util, a hook | `jest`, a sibling `*.test.ts` |
| a security rule | `tests/rules/` |
| behaviour across a screen, a write, offline, navigation | `e2e/*.spec.ts` |
| **purely visual** — misalignment, a wrong colour in dark mode, a clipped label | no test; see below |

Run it. **It must fail, and it must fail for the reported reason.** A test that passes
before the fix is testing something else, and a test that fails with a different error is
reproducing a different bug. Say which you saw.

**The visual exception.** A bug you can only see cannot be usefully asserted. Skip the test,
capture a screenshot of the defect into `.tmp/review/shots/` as the repro, and verify by
eye after the fix. Say in the report that this bug ships without a regression guard, and
why. Do not stretch a geometry assertion around something that is really a judgement — if
it *can* be measured, it belongs in `e2e/craft.spec.ts` and it is not this exception.

## Step 4. Fix it

Smallest change that makes the test pass. Invoke `ponytail` in `full` mode: the fix for a
bug is rarely a new abstraction, and a refactor smuggled in beside a fix is how a one-line
regression becomes unbisectable.

Fix the **cause**, not the symptom. If the real cause is out of scope, say so plainly,
fix the symptom deliberately, and open an issue for the cause rather than leaving it
implied.

Then the gates:

```bash
yarn lint --write && yarn invariants && yarn typecheck && yarn test
scripts/dev-stack.sh up && yarn e2e
```

## Step 5. Did the spec lie?

A bug is often a spec that was wrong, or a spec that described behaviour nobody built.
Check the area spec in `docs/specs/` for what you just fixed:

- **Spec described the correct behaviour, code disagreed** → the code was the bug. Nothing
  to change.
- **Spec described the broken behaviour** → fix the spec in this change. It is now
  documentation of a bug.
- **Spec said nothing** → add a line where it belongs, if the behaviour is worth stating.

Bugs do not get a wip spec of their own. They edit the area spec directly, or nothing.

## Step 6. Review

Run **`/review`** in a fresh session. `diff-review` decides whether the browser pass
happens; a logic fix usually will not need one, a fix to a screen will.

On a PASS, run **`/ship`** in a fresh session.

## Step 7. What to say

- The one-line restatement from Step 1
- The test that reproduces it, and where it lives
- The cause, in one sentence — not the diff, the cause
- Whether the spec was wrong too
- Anything you deliberately did not fix, and the issue number if you filed one
