---
name: implement
description: "Use to build the phases of a confirmed Home Backlog spec, standalone rather than through /continue-work. Not for planning, reviewing or shipping."
---

# Implement skill

Runs the **Phases** of a spec, in order, and nothing else. Planning happened in
`/new-feature`, `/cleanup` or `/bug`. Review happens in `/review`. Shipping happens in
`/ship`.

Normally you get here through [`/continue-work`](../continue-work/SKILL.md), which runs all
three in one session against a checkpoint. This skill is the same stage on its own: use it
when you want the implementation and nothing after it.

Talk to the user in **unslop** prose.

## You dispatch; you do not write

Every phase goes to GLM through `oc-task`. The call shape, the report contract, the
escalation ladder and the parallelism rules live in the global **`glm-dispatch`** skill —
read it, and do not restate it here.

One session working five phases carries every earlier phase into every later turn, so its
cost grows with roughly the square of the phase count. One dispatch per phase flattens that,
and a dispatched round costs cents.

**One writing process against this working tree, ever.** Two agents editing it corrupt each
other's diffs and each other's commits.

## Step 0: input

A spec path, usually `docs/specs/wip/<nn>-<slug>.md`. Read it whole — it is short, it is
the contract, and it is the only thing you are carrying.

Confirm the branch is the work's own, not `main`:

```bash
GIT_VANILLA=1 git branch --show-current
```

If it is `main`, stop and say so. Pushing to `main` deploys to production.

## Step 1: the section map

Build it once and hand the same map to every phase, so no agent reads a 1700-line area spec
to change forty lines:

```bash
grep -n '^## ' docs/specs/<area>.md
```

Pair each heading with the next heading's line to get ranges, keep the ones this spec
touches, and pass them as `<file> <start>-<end> <heading>`.

## Step 2: the phase loop

For each phase, in order:

1. **Write the prompt to a file** under `.tmp/prompts/`, stable part first so a retry hits
   the prompt cache. It carries the spec path and **which phase**, the section map, the
   gate commands by pointing at `.ai/config.toml`'s `[gates]`, and:

   - **`ponytail` in `full` mode. Always** — on the largest phase and on a two-phase spec
     alike. The short path is not an exemption. Catching an unnecessary abstraction at
     write time is a deletion; catching it in `diff-review` is a rewrite.
   - **When the phase touches `[review] visible_paths`:** `docs/DESIGN.md` and the spec's
     **Surface brief**, plus design-apply's `references/principles.md`,
     `references/anti-patterns.md` and `references/checklist.md`. Steps 1, 2 and 5 of
     design-apply are skipped — discovery is answered by the contract, the mode is always
     **conform**, and verification belongs to the gates and to `browser-review`. **The
     phase never boots a browser.**

   Not the spec's contents, not a file's contents, not your reasoning. The agent reads the
   repo itself, and every line you paste is a line paid for twice.

2. **Dispatch.** The spec names a routing hint per phase:

   ```bash
   oc-task implement ~/git/home-backlog .tmp/prompts/phase-<n>.md
   ```

   `GLM` is the default and takes almost everything. A phase hinted `Opus` goes to an Opus
   subagent inside Claude Code with the same prompt. If the spec names neither, take GLM and
   say so.

3. **Verify it yourself.** Never take the agent's word for green:

   ```bash
   yarn lint --write && yarn invariants && yarn typecheck && yarn test
   ```

   `yarn invariants` fails until every `[test]` claim in the spec's Acceptance has a test
   whose title **starts with its number** — `test("3: …")`. That failure is the feedback,
   not an obstacle: the fix is to write the test, never to reword the claim.

   A phase that touches user-visible surface also owes its `e2e/` tests — the `[test]`
   claims become real specs in the phase that builds the screen, not later:

   ```bash
   scripts/dev-stack.sh up && yarn e2e
   ```

4. **Red?** Take the escalation ladder in `glm-dispatch`: round 2 with `--continue` and the
   failing gate's real output, then round 3 only if round 2 moved forward, then an Opus
   subagent on the same unit, then stop and ask. Never restart at round 1 with a reworded
   prompt, and never move to the next phase on red.

5. **Commit.** One commit per phase, once it is green. The agent commits its own phase; if
   it did not, the phase is not done — do it yourself and say the agent skipped it:

   ```bash
   GIT_VANILLA=1 git commit -m "<type>(<scope>): <phase summary>"
   ```

6. Report the phase in one line and move on.

## Step 3: stop

When the last implementation phase is green and committed, **stop**. Do not review your own
work, do not fold the spec, do not open a PR.

Tell the user to run **`/review`**, or **`/continue-work`** to pick the arc back up. Say
which phases landed, which commits, and anything the spec left as an open decision.

## What does not belong here

- **Reviewing.** The session that wrote the code never signs it off, and dispatching agents
  still counts as writing it.
- **Folding the wip spec into `docs/specs/`.** That is `/ship`, after a PASS.
- **Deciding scope.** If a phase turns out to be wrong or the spec is ambiguous, stop and
  ask. Do not redesign mid-run; a spec changed silently during implementation is a spec
  nobody agreed to.
- **Committing anything outside the phase list.** Drive-by fixes belong in their own issue.
