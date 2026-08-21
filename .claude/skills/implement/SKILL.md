---
name: implement
description: "Works a Home Backlog spec's phases to green, one sub-agent per phase, verifying each phase itself rather than trusting the agent's word. Use in a fresh session after /new-feature, /cleanup or /bug has written a spec. Stops before review. Not for planning and not for shipping."
---

# Implement skill

Runs the **Phases** of a spec, in order, and nothing else. Planning happened in
`/new-feature`, `/cleanup` or `/bug`. Review happens in `/review`. Shipping happens in
`/ship`. Each is a fresh session, and that is the point: this one holds the spec, the phase
list and a section map, not five phases of accumulated implementation.

Talk to the user in **unslop** prose.

## Why sub-agents

One session working five phases carries every earlier phase into every later turn, so its
cost grows with roughly the square of the phase count. Handing each phase to its own agent
flattens that, at the price of one context re-load per phase. Break-even is around three
phases.

**Below three phases, do the work yourself.** The handoff costs more than it saves, and a
two-phase spec is one sitting.

## Step 0: input

A spec path, usually `docs/specs/wip/<nn>-<slug>.md`. Read it whole — it is short, it is
the contract, and it is the only thing you are carrying.

Confirm the branch is the feature's own, not `main`:

```bash
GIT_VANILLA=1 git branch --show-current
```

If it is `main`, stop and say so. Pushing to `main` deploys to production.

## Step 1: the section map

Build it once and hand the same map to every phase agent, so no agent reads a 1700-line
area spec to change forty lines:

```bash
grep -n '^## ' docs/specs/<area>.md
```

Pair each heading with the next heading's line to get ranges, keep the ones this spec
touches, and pass them as `<file> <start>-<end> <heading>`.

## Step 2: the phase loop

For each phase, in order:

1. **Dispatch.** `feature-small` for a tightly-scoped slice, `feature-large` for a
   multi-file one with real design in it; `bug-small` / `bug-large` when the spec came from
   `/bug`. The spec says which per phase; if it does not, judge from the phase's scope and
   say what you chose. Hand over: the spec path, **which phase**, the section map, and the
   instruction to respond and think in **caveman ultra**.

2. **Verify it yourself.** Never take the agent's word for green:

   ```bash
   yarn lint --write && yarn invariants && yarn typecheck && yarn test
   ```

   A phase that touches user-visible surface also owes its `e2e/` tests — the spec's
   Acceptance claims tagged `[test]` become real specs in the phase that builds the screen,
   not later. Run them when the phase adds them:

   ```bash
   scripts/dev-stack.sh up && yarn e2e
   ```

3. **Red?** Send the failure back to the **same agent** with the output, and let it fix its
   own phase. Two rounds. Still red after that, stop and report — do not start fixing
   another agent's phase yourself, and do not move to the next phase on red.

4. **Commit.** One commit per phase, once it is green. The agent commits its own phase; if
   it did not, do it:

   ```bash
   GIT_VANILLA=1 git commit -m "<type>(<scope>): <phase summary>"
   ```

5. Report the phase in one line and move on.

## Step 3: stop

When the last implementation phase is green and committed, **stop**. Do not review your own
work, do not fold the spec, do not open a PR.

Tell the user: run **`/review`** in a fresh session. Say which phases landed, which commits,
and anything the spec left as an open decision.

## What does not belong here

- **Reviewing.** The session that wrote the code never signs it off, and dispatching agents
  still counts as writing it.
- **Folding the wip spec into `docs/specs/`.** That is `/ship`, after a PASS.
- **Deciding scope.** If a phase turns out to be wrong or the spec is ambiguous, stop and
  ask. Do not redesign mid-run; a spec changed silently during implementation is a spec
  nobody agreed to.
- **Committing anything outside the phase list.** Drive-by fixes belong in their own issue.
