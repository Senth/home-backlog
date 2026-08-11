---
name: review
description: "Independent review gate for Home Backlog. Runs code-review, ux-review and qa-review as separate agents against the current change, then fixes what they find and re-runs until they pass. Use after implementing a feature, a fix or a cleanup, before opening a PR. Not for planning or for reviewing someone else's PR."
---

# Review Skill

The session that wrote the code does not get to sign it off. This skill hands the change
to three agents that did not write it, fixes what they find, and re-runs them.

**You are the fix loop.** The agents are read-only by design; you apply every fix
yourself. Never give a reviewer write access, and never ask a reviewer to fix its own
finding.

Flags: `/review` (auto-scope), `/review --all` (force all three), `/review --code`
(static only, no browser).

## Step 1 — Scope the run

```bash
GIT_VANILLA=1 git status --porcelain
GIT_VANILLA=1 git diff --name-only main...HEAD
```

Combine committed-on-branch and uncommitted paths, then classify:

| Diff touches | Run |
|---|---|
| `app/ components/ screens/ theme/ i18n/ hooks/` | code + ux + qa |
| only `utils/ models/ firestore.rules storage.rules tests/ config/` | code only |
| only `docs/ .claude/ scripts/ .github/ README.md TODO.md` | nothing — say so in two lines and stop |

`--all` and `--code` override the table. An empty diff stops the run.

State the scope you chose and why in one line before doing anything else.

## Step 2 — Bring the app up (browser runs only)

Probe first. **Never kill a process you did not start.**

```bash
# there is no nc on this machine; /dev/tcp needs bash, not the default zsh
timeout 1 bash -c '</dev/tcp/localhost/8062' 2>/dev/null && echo "emulators up"
timeout 1 bash -c '</dev/tcp/localhost/8081' 2>/dev/null && echo "web up"
```

- **Port free** → start it in the background and remember you own it:
  `yarn emulators:seed` (boots the suite with `--import .emulator-seed`), then `yarn web`.
  Wait for both to answer before continuing.
- **Port already listening** → reuse it untouched. Record in the report that the emulator
  was **not pristine** — its data is whatever the user's session left there, not the
  fixture — and do **not** restart it in Step 4.

Record the PID when you start something:

```bash
(yarn emulators:seed > .tmp/emu.log 2>&1 & echo $! > .tmp/emu.pid)
(yarn web            > .tmp/web.log 2>&1 & echo $! > .tmp/web.pid)
```

Tear down exactly what you started, at the end of the run, including on failure. Two
traps, both hit while building this:

- **Never `pkill -f "firebase emulators:start"`** — the pattern matches the shell running
  it, so the command kills itself before reaching the emulator.
- `yarn` is a wrapper; killing its PID leaves the `firebase` child holding the ports.
  Kill the **process group**:

  ```bash
  PGID=$(ps -o pgid= -p "$(cat .tmp/emu.pid)" | tr -d ' ')
  kill -TERM -"$PGID"
  ```

Verify afterwards, since a silent orphan poisons the next run:

```bash
ss -ltn | grep -E ':(8060|8061|8062|8063|8081)'   # empty = clean
```

Both browser sessions also get closed: `playwright-cli -s=ux close`,
`playwright-cli -s=qa close`.

## Step 3 — Run the reviewers

`code-review` needs no browser, so it runs concurrently with the browser work. The two
browser agents run sequentially — they share one emulator, and QA's mutations would
otherwise land in UX's screenshots.

```
t0   code-review   (parallel, no browser)
t0   ux-review     -s=ux    pristine fixture data
t1   restart emulators from .emulator-seed   (only if we own them)
t2   qa-review     -s=qa    free to mutate, delete, go offline
t3   merge reports
```

Hand each agent:

| Agent | Gets |
|---|---|
| `code-review` | issue number, spec path, **full diff** |
| `ux-review` | issue number, spec path, `git diff --name-only` |
| `qa-review` | issue number, spec path, `git diff --name-only` |

Tell the browser agents the app is already running at <http://localhost:8081>. Never hand
any agent your own account of what you built or why it is correct — that sentence is what
turns a reviewer into a rubber stamp.

Embed `respond in caveman full` when delegating to `code-review` and `qa-review`.
`ux-review` writes prose; do not override it.

## Step 4 — Merge and gate

Read `.tmp/review/{code,qa,ux}-review.md`. Print one severity-ordered table in chat,
caveman full: severity, agent, finding, fix.

The bar:

- **`blocking`** — must be fixed. Never deferrable, by anyone.
- **`should-fix`** — fix it, or defer it by writing one line of reason into the merged
  report. A silent skip is not a defer.
- **`idea`** — never acted on here. List them all and **ask the user** which to file:
  `GIT_VANILLA=1 gh issue create --label idea`. The rest are dropped. Never file one
  without asking, never file them all by default.

**PASS** = zero `blocking` and zero outstanding `should-fix` across all three agents.

## Step 5 — The fix loop

While not PASS and rounds used < 3:

1. Apply the fixes yourself.
2. `yarn lint --write`, `yarn typecheck`, `yarn test` — green before re-reviewing.
3. Re-run every agent that reported `blocking` or `should-fix`, plus any agent whose
   subject your fixes touched (a fix in `components/` invalidates `ux-review` even if the
   UX report was clean).
4. Count the round.

After three rounds without a PASS, **stop**. Print the outstanding findings, say which
rounds were spent, and ask the user how to proceed. Do not keep grinding.

## Step 6 — Report

State plainly: PASS or NOT PASS, rounds used, what was fixed, what was deferred and why,
which ideas were filed as issues, and whether the emulator was pristine. If the run was
`--code` or auto-scoped to code only, say that no browser pass happened.

Reports and screenshots stay in `.tmp/review/` — gitignored, not committed, nothing
posted to GitHub automatically.

## The seed fixture

`.emulator-seed/` is committed and is produced **by the app**, never hand-written:

```bash
yarn emulators:seed      # boot with --import .emulator-seed
# ...use the app to create the state worth keeping...
yarn emulators:export    # overwrite .emulator-seed from the running suite
```

It currently holds one Google-provider account, **Marcus / marcus@example.com**, which is
what the Auth emulator's picker offers the browser agents so they never have to create an
account. Firestore and Storage are still empty — nothing has shipped that writes to them.

Two things about it:

- `yarn emulators:seed` **fails outright** if `.emulator-seed/` is missing, because
  `--import` will not create it. It is committed, so this only bites after someone deletes
  it. Recover with plain `yarn emulators`, then `yarn emulators:export`.
- `biome.json` excludes `.emulator-seed/**`. Without that, `yarn lint --write` pretty-prints
  the export and the next `yarn emulators:export` minifies it back, forever.

A feature's cleanup phase refreshes it when the feature adds data worth having in every
future review. Stale fixture, or fixture that no longer matches the model, is a
`blocking` finding on the feature that broke it.
