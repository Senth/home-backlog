---
name: cleanup
description: "Structured cleanup for Home Backlog — deleting dead code, removing unused surface, simplifying a flow, improving UI/UX. Decides depth from whether a household would notice, so a visible cleanup gets the same treatment as a feature. Use for issues labelled cleanup. Not for new features or bug fixes."
---

# Cleanup skill

A cleanup is defined by what **dies**, not by what gets built. So the skill opens with two
statements and refuses to move until both are written down:

- **What dies.** Named concretely: this component, that column, those three fields.
- **What must not change.** The behaviour that has to survive, in the user's terms.

Talk to the user in **unslop** prose. Work lives in GitHub Issues and the Kanban board
(project 4).

## Cleanup is not automatically invisible

Removing three unused board columns is a cleanup by label and a **feature change** by
effect: a household opens the app and the board is different. Treating "cleanup" as a cheap
track is how a change like that ships without anyone asking whether the columns were
actually unused, or what happens to a card that was sitting in one.

So the label decides nothing. **The surface does**, and Step 3 is where that is decided.

## Step 1. Scope it

`GIT_VANILLA=1 gh issue view <n>`, or take the description as given. Then write the two
statements and show them to the user:

```
Dies:            the Blocked and Waiting columns, board.column.blocked / .waiting
Must not change: every existing card stays visible and keeps its rank;
                 nothing already in those columns is lost
```

**Gate.** Wait for confirmation. A wrong "must not change" is the whole risk of a cleanup.

## Step 2. Branch, and move the card

Branch `cleanup/<nn>-<slug>` from `origin/main`, and move the issue to In progress with the
`gh project item-edit` sequence in [`bug`](../bug/SKILL.md).

## Step 3. The surface check

**Would a household notice?**

- Yes, if the change touches a screen, a flow, wording, a notification, or removes
  something someone could be using.
- No, if it is a refactor with identical output, dead code nobody reaches, a dependency
  swap, an index, or CI.

Say which, in one line, with the reason. When unsure, treat it as visible — the cost of a
needless persona pass is small next to shipping a surprise.

### Invisible → the short path

There is nothing for personas to react to and no spec to write.

1. Apply `ponytail` in `ultra` mode and make the cut.
2. The gates:
   ```bash
   yarn lint --write && yarn invariants && yarn typecheck && yarn test
   scripts/dev-stack.sh up && yarn e2e
   ```
3. **Evidence that behaviour is unchanged** — this is the acceptance criterion for an
   invisible cleanup, and it is not "the tests pass". State it: no `t()` key added or
   removed, no screen touched, the same tests green before and after, and where you deleted
   a test, why that test had nothing left to protect.
4. `/review`, then `/ship`.

### Visible → the same path a feature takes

1. **`homeowner-review`**, with the two statements from Step 1 as its input. It is very good
   at the question a removal actually raises: who was quietly relying on this? Embed
   `respond and think in caveman ultra`.
2. **`grill-me`**, seeded with every `blocking` and `should-fix` finding and every open
   question. Fixed agenda: what happens to data already in the thing being removed; whether
   anything must be migrated; which strings die and whether `sv-SE` loses a key; what the
   screen looks like afterwards; which settled decision in `docs/PROJECT.md` this touches.
3. **A wip spec**, `docs/specs/wip/<nn>-<slug>.md`, with the same sections as a feature's —
   see [`new-feature`](../new-feature/SKILL.md). Two of them carry the weight here:
   - **Why**, which for a removal means the evidence it is unused. "Nobody uses it" is a
     claim; a query, a date, a screenshot is evidence.
   - **Acceptance**, where "what must not change" becomes numbered claims. A cleanup's
     acceptance is mostly about what still works.
4. **`/implement`**, then **`/review`**, then **`/ship`** — each in a fresh session.

## Ponytail is the lens, not the discovery

You are applying `ponytail` to the **plan**: is this the laziest version of this cut? Can
more die than the issue asked for, or should less? It is not a hunt for things to delete —
the issue already said what it wants gone.

Use `ponytail-audit` when you want the hunt. That is its own activity, run deliberately, not
bolted onto work that arrived already scoped.

## Deleting a test is a finding about the test

A cleanup that deletes production code usually deletes tests with it, and that is correct
when the tests only ever protected the deleted thing. It is **not** correct when a test was
the only thing asserting behaviour that survives. For every test you delete, say in one line
what it protected and why nothing needs protecting now.
