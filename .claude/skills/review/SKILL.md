---
name: review
description: "Use to review a Home Backlog change before /ship, standalone rather than through /continue-work. Not for planning, implementing, or reviewing someone else's PR."
---

# Review skill

The session that wrote the code does not sign it off. Run this in a **fresh session**: it
starts nearly empty, reads only the diff, the findings and the files it must touch, so
every fix round lands on a small context instead of on top of an entire implementation.

Normally you get here through [`/continue-work`](../continue-work/SKILL.md), which runs
implement, review and ship in one session against a checkpoint. This skill is the same stage
on its own.

**You are the fix loop.** The reviewers are read-only by design. Never give one write access,
and never ask a reviewer to fix its own finding. The fixes themselves are dispatched like any
other write — see the global **`glm-dispatch`** skill for the call shape, the report
contract, the escalation ladder and the parallelism rules.

Talk to the user in **unslop** prose — plain, direct, no filler. Not caveman: this output
is small and you read it every run, so clarity beats compression. The agents are the ones
under caveman.

## The order, and why

Free things first, then cheap things, then expensive things.

```
lint --write → invariants → typecheck → test → e2e   (zero tokens; a shell command each)
        ↓
diff-review  ‖  ponytail-review                      (tokens; diff-review decides visible)
        ↓
browser-review                                       (most tokens; only if user-visible)
```

That is the order of the shell command in Step 3, and the two must never drift apart.

Every mechanical gate runs before any agent is dispatched. A failure one of them catches is a
round of agent review you did not have to pay for, and `e2e/` now covers what used to come
back as a browser finding: console noise, a lost offline write, a broken back button, a
contrast failure, a clipped Swedish label, a raw `t()` key.

The two read-only reviews run **in parallel** — they touch nothing. Everything else is
serial: one writing process against this working tree, ever, and a code fix invalidates a
browser pass.

Flags: `/review` (auto), `/review --code` (no browser pass, whatever `diff-review` says),
`/review --quick` (mechanical gates plus `diff-review`, and you smoke-test the primary path
by hand). No other flags. If you disagree with the auto scope, say so in the prompt.

## Step 1. Scope

```bash
GIT_VANILLA=1 git status --porcelain
GIT_VANILLA=1 git diff --name-only main...HEAD
```

Only `docs/ .claude/ scripts/ .github/ README.md` changed → say so in two lines and stop.
An empty diff stops the run. Everything else continues; `diff-review` decides whether the
browser pass happens, not you and not a path table.

## Step 2. The section map

The agents must not read whole area specs — `boards-and-nodes.md` alone is over 1700
lines. Work out which sections this diff touches and hand over exact ranges:

```bash
grep -n '^## ' docs/specs/<area>.md
```

Pair each heading with the next heading's line number to get a range, pick the ones the
diff actually touches, and pass them as `<file> <start>-<end> <heading>`. State the map in
chat so it is auditable.

## Step 3. The mechanical gates

```bash
yarn lint --write && yarn invariants && yarn typecheck && yarn test
scripts/dev-stack.sh up && yarn e2e
```

All green before an agent is spawned. `dev-stack.sh up` is idempotent — it reuses a stack
you already had running and reports whether the emulator is pristine or carrying whatever
a previous session left in it. Say which in the final report.

An `e2e` failure is a `blocking` finding you fix yourself, right here. It is also the
cheapest signal in the whole run, so never skip it to save wall-clock time.

## Step 4. diff-review and ponytail-review, in parallel

```bash
oc-task diff-review ~/git/home-backlog .tmp/prompts/diff-review.md &
oc-task review      ~/git/home-backlog .tmp/prompts/ponytail-review.md &
wait
```

`diff-review` gets the issue number, the spec path, the section map and the **full diff**.
The `review` agent gets the diff and one instruction: run the `ponytail-review` skill against
it and report only over-engineering. Never hand either one your own account of what you built
or why it is correct — that sentence is what turns a reviewer into a rubber stamp.

Read `.tmp/review/diff-review.md` and the `review` agent's report. Take the findings into
Step 6's fix loop. If `diff-review` found `blocking` items, re-run it **scoped**: hand it the
finding list and the diff of just your fixes, and ask it to verify those rather than review
again from scratch.

`diff-review`'s report carries **`User-visible: yes | no`**. That decides the next step. With
`--code` or `--quick`, skip to Step 6 regardless and say so.

## Step 5. browser-review

Only when `diff-review` said yes.

```bash
scripts/dev-stack.sh up          # prints the web URL; today that is http://localhost:8081
oc-task browser-review ~/git/home-backlog .tmp/prompts/browser-review.md
```

Take the URL from what `up` prints, never from memory — `dev-stack.sh status` lists the ports
too, and a hardcoded port breaks the first time a second checkout runs.

Hand it: the issue number, the spec path, the section map, the list of **changed screens**,
and that URL. Not the diff, and not your account of the change.

It judges what a test cannot: whether it looks right, whether the wording sounds like a
person in both locales, whether an empty state is honest, whether the density overwhelms.
It has a 15-turn budget. If it comes back having spent that on something `e2e/` already
covers, that is a bug in the agent file, not a finding — say so.

## Step 6. The fix loop

Read the reports. Print one severity-ordered table: severity, source, finding, fix.

- **`blocking`.** Must be fixed. Never deferrable, by anyone.
- **`should-fix`.** Fix it, or defer it by writing one line of reason into the report. A
  silent skip is not a defer.
- **`idea`.** Never acted on here. List them and **ask** which to file with
  `GIT_VANILLA=1 gh issue create --label idea`, then move each to the Idea column in the
  same step — an idea sitting in Backlog is an idea that gets picked up by accident. The
  rest are dropped. Never file one without asking, and never file them all by default.

While not PASS and rounds used **< 2**:

1. Dispatch the fixes as one unit. One writer at a time.
2. Re-run the mechanical gates. All green.
3. **Commit the round**, with a message naming the finding it closes. Not "review fixes" —
   the finding, so `git log` says which review caught what.
4. **Re-run scoped, not whole.** Hand the agent the list of fixes and ask it to verify
   exactly those. Do not re-run `diff-review` unless a fix changed logic rather than
   presentation.
5. Count the round.

**PASS** = zero `blocking` and zero outstanding `should-fix`, and it is yours to declare. A
green report is a claim, not a verdict.

> Never reach the `idea` question with a dirty tree. Fixes made, gates green, nothing
> committed, next session inherits a mess — that is the known failure step 3 exists to close.

After two rounds without a PASS, **stop**. Print what is outstanding, say which rounds were
spent, ask how to proceed. Do not keep grinding.

## Step 7. Report, and tear down

State plainly: PASS or NOT PASS, rounds used, what was fixed, what was deferred and why,
which ideas were filed, and whether the emulator was pristine. If no browser pass happened,
say why — `diff-review` said not user-visible, or a flag — and what you smoke-tested by hand
instead.

```bash
scripts/dev-stack.sh down
playwright-cli -s=review close
```

Only if you started the stack. `down` stops what it started and leaves anything else alone.

Reports and screenshots stay in `.tmp/review/`. Gitignored, never committed, nothing posted
to GitHub.

On a PASS, tell the user to run **`/ship`**, or **`/continue-work`** to pick the arc back
up. Do not fold the spec, open a PR or merge from here.

## The seed fixture

`.emulator-seed/` is committed and produced **by the app**, never hand-written:

```bash
scripts/dev-stack.sh up      # boots with --import .emulator-seed
# ...use the app to create the state worth keeping...
yarn emulators:export        # overwrite .emulator-seed from the running suite
```

It holds two Google-provider accounts — **Marcus / marcus@example.com**, which the suite and
the browser agent sign in as, and **Anna Maria Berg / anna@example.com** — two homes,
**Huset** and **Stugan**, and sixteen nodes under Huset. `e2e/` depends on those names:
`auth.setup.ts` signs in as Marcus and opens Huset, and the readiness markers in
`e2e/support/app.ts` wait for seeded titles. **Regenerating the fixture means re-checking
those.**

Two traps:

- `--import` will not create a missing directory, so `scripts/dev-stack.sh up` fails
  outright if `.emulator-seed/` is gone. Recover with `up --fresh`, then
  `yarn emulators:export`.
- `biome.json` excludes `.emulator-seed/**`. Without that, `yarn lint --write`
  pretty-prints the export and the next export minifies it back, forever.

A feature's `/ship` refreshes it when the feature adds data worth having in every future
review. A stale fixture is a `blocking` finding on the feature that broke it.
