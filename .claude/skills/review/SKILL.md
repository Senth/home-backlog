---
name: review
description: "Independent review gate for Home Backlog. Runs the mechanical gates, then diff-review, then — only if that says the change is user-visible — browser-review, fixing what each finds. Use after implementing a feature, a fix or a cleanup, before /ship. Not for planning or for reviewing someone else's PR."
---

# Review skill

The session that wrote the code does not sign it off. Run this in a **fresh session**: it
starts nearly empty, reads only the diff, the findings and the files it must touch, so
every fix round lands on a small context instead of on top of an entire implementation.

**You are the fix loop.** The agents are read-only by design. Never give a reviewer write
access, and never ask a reviewer to fix its own finding.

Talk to the user in **unslop** prose — plain, direct, no filler. Not caveman: this output
is small and you read it every run, so clarity beats compression. The agents are the ones
under caveman.

## The order, and why

Free things first, then cheap things, then expensive things.

```
invariants → lint → typecheck → test → e2e     (zero tokens; a shell command each)
        ↓
diff-review                                     (tokens; decides user-visible)
        ↓
browser-review                                  (most tokens; only if user-visible)
```

Every mechanical gate runs before any agent is spawned. A failure one of them catches is a
round of agent review you did not have to pay for, and `e2e/` now covers what used to come
back as a browser finding: console noise, a lost offline write, a broken back button, a
contrast failure, a clipped Swedish label, a raw `t()` key.

Do not parallelise. A code fix invalidates a browser pass.

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

## Step 4. diff-review

Hand it: the issue number, the spec path, the section map, and the **full diff**. Embed
`respond and think in caveman ultra`. Never hand it your own account of what you built or
why it is correct — that sentence is what turns a reviewer into a rubber stamp.

Read `.tmp/review/diff-review.md`. Apply every `blocking` and every `should-fix` you are
not explicitly deferring, then re-run the mechanical gates. If it found `blocking` items,
re-run it **scoped**: hand it the finding list and the diff of just your fixes, and ask it
to verify those rather than review again from scratch.

Its report carries **`User-visible: yes | no`**. That decides the next step. With `--code`
or `--quick`, skip to Step 6 regardless and say so.

## Step 5. browser-review

Only when `diff-review` said yes.

Hand it: the issue number, the spec path, the section map, the list of **changed screens**,
and the fact that the app is running at <http://localhost:8081>. Not the diff, and not your
account of the change.

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
  `GIT_VANILLA=1 gh issue create --label idea`. The rest are dropped. Never file one
  without asking, and never file them all by default.

While not PASS and rounds used **< 2**:

1. Apply the fixes yourself.
2. Re-run the mechanical gates. All green.
3. **Re-run scoped, not whole.** Hand the agent the list of fixes and ask it to verify
   exactly those. Do not re-run `diff-review` unless a fix changed logic rather than
   presentation.
4. Count the round.

**PASS** = zero `blocking` and zero outstanding `should-fix`.

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

On a PASS, tell the user to run **`/ship`** in a fresh session. Do not fold the spec, open a
PR or merge from here.

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
