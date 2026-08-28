---
name: cleanup
description: "Use when deleting dead code, removing surface, simplifying a flow or polishing UI/UX in Home Backlog, or picking up an issue labelled cleanup. Not for new features or bug fixes."
---

# Cleanup skill

A cleanup is defined by what **dies**, not by what gets built. So the skill opens with two
statements and refuses to move until both are written down:

- **What dies.** Named concretely: this component, that column, those three fields.
- **What must not change.** The behaviour that has to survive, in the user's terms.

Kickoff only: scope → branch → surface check → personas → grill → spec → hand off. This skill
ends when the spec is confirmed. Making the cut is `/continue-work`, in a fresh session.
**Do not delete anything here.**

Talk to the user in **unslop** prose. Work lives in GitHub Issues and the Kanban board
(project 4).

## Cleanup is not automatically invisible

Removing three unused board columns is a cleanup by label and a **feature change** by
effect: a household opens the app and the board is different. Treating "cleanup" as a cheap
track is how a change like that ships without anyone asking whether the columns were
actually unused, or what happens to a card that was sitting in one.

So the label decides nothing. **The surface does**, and Step 3 is where that is decided.

**A field written to Firestore is never invisible.** Documents already exist carrying it.
Removing it from the model does not remove it from the data, and every screen, export and
rules test that reads it is now reading something the code no longer describes. This one has
been nearly shipped as an invisible cleanup before. It is always the visible path.

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

- Yes, if the change touches a screen, a flow, wording, a notification, removes something
  someone could be using, or drops a field that Firestore documents already carry.
- No, if it is a refactor with identical output, dead code nobody reaches, a dependency
  swap, an index, or CI.

Say which, in one line, with the reason. When unsure, treat it as visible — the cost of a
needless persona pass is small next to shipping a surprise.

Both answers end at a spec and a handoff. What changes is how much work the spec is.

### Invisible → the short spec

There is nothing for personas to react to and no surface to brief. The spec is short, and
two of its sections carry everything:

- **Why**, which for a removal means the evidence it is unused. "Nobody uses it" is a claim;
  a query, a date, a screenshot is evidence.
- **Acceptance**, which for an invisible cleanup is the evidence that behaviour is
  unchanged, and it is not "the tests pass". State it as numbered claims: no `t()` key added
  or removed, no screen touched, the same tests green before and after, and for every test
  the cut deletes, what it protected and why nothing needs protecting now.

Omit **Surface brief** and say so in **What**.

### Visible → the same path a feature takes

1. **`homeowner-review`**, with the two statements from Step 1 as its input. It is very good
   at the question a removal actually raises: who was quietly relying on this? Spawn it as an
   **Opus subagent** with the `Task` tool, in **unslop** prose — see
   [`new-feature`](../new-feature/SKILL.md) Step 4 for why the persona pass is the one thing
   this repo does not dispatch to GLM.
2. **`grill-me`**, seeded with every `blocking` and `should-fix` finding and every open
   question. Fixed agenda: what happens to data already in the thing being removed; whether
   anything must be migrated; which strings die and whether `sv-SE` loses a key; what the
   screen looks like afterwards; which settled decision in `docs/PROJECT.md` this touches.
3. **A wip spec**, `docs/specs/wip/<nn>-<slug>.md`, with the same sections as a feature's —
   see [`new-feature`](../new-feature/SKILL.md) — **including the Surface brief**. A removal
   has a surface brief like anything else, and its "remove / quiet / sharpen" line is the
   easiest one in the repo to write: the removal *is* the remove.

## The spec

Same shape either way, from [`new-feature`](../new-feature/SKILL.md). Acceptance claims
tagged `[test]` map to their test by **number** — `test("2: …")` — and `yarn invariants`
fails until each has one. Every phase goes to GLM, so no phase carries a routing hint.

Ideas the personas raised and the cut does not cover: **ask** which to file, then
`GIT_VANILLA=1 gh issue create --label idea` and move each to the Idea column in the same
step. Link them from **Out of scope**. Never file one without asking.

## Ponytail is the lens, not the discovery

You are applying `ponytail`'s question to the **plan**: is this the laziest version of this
cut? Can more die than the issue asked for, or should less? It is not a hunt for things to
delete — the issue already said what it wants gone.

Do not invoke the skill here. Plan time is not where it pays; `/continue-work` runs it at
write time, where an unnecessary abstraction is still a deletion rather than a rewrite.

Use `ponytail-audit` when you want the hunt. That is its own activity, run deliberately, not
bolted onto work that arrived already scoped.

## Deleting a test is a finding about the test

A cleanup that deletes production code usually deletes tests with it, and that is correct
when the tests only ever protected the deleted thing. It is **not** correct when a test was
the only thing asserting behaviour that survives. For every test the spec deletes, say in one
line what it protected and why nothing needs protecting now.

## Handoff

Only after the spec is written and the user has confirmed it.

1. **Ensure a tracking issue exists.** `GIT_VANILLA=1 gh issue create --label cleanup` if
   there is none, and rename the wip file to match the number.
2. **Comment the spec link on the issue.** Do not edit the issue description.
3. Tell the user to run **`/continue-work docs/specs/wip/<nn>-<slug>.md`** in a fresh
   session, and stop.
