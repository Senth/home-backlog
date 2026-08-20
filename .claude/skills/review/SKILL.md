---
name: review
description: "Independent review gate for Home Backlog. Runs code-review first, applies its fixes, then hands the clean change to browser-review in a real browser, then fixes what that finds. Use after implementing a feature, a fix or a cleanup, before opening a PR. Not for planning or for reviewing someone else's PR."
---

# Review Skill

The session that wrote the code does not get to sign it off. This skill hands the change
to agents that did not write it, fixes what they find, and re-runs the narrowest thing
that could still be wrong.

**You are the fix loop.** The agents are read-only by design; you apply every fix
yourself. Never give a reviewer write access, and never ask a reviewer to fix its own
finding.

## The shape, and why

Cheap first, expensive once.

```
code-review  →  fix + lint/typecheck/test  →  browser-review  →  fix  →  done
```

`code-review` is static and cheap, and it catches the things that would otherwise show up
as browser findings — missing `t()` calls, and everything `scripts/check-invariants.sh`
reports when the agent runs `yarn invariants`: style literals, colour literals,
`useAppTheme()`, `en-US`/`sv-SE` key drift. Running it **first** and fixing before the
browser opens is what makes the browser pass run once instead of three times. Do not
parallelise them; a code fix invalidates a browser pass by construction.

Run `yarn invariants` yourself before spawning anything. It is a second of shell, it is
the same gate CI applies, and a failure it catches is a round of `code-review` you did not
have to spend.

Flags: `/review` (auto-scope), `/review --all` (force both), `/review --code` (static
only, no browser), `/review --quick` (`code-review` only, and you smoke-test the primary
path by hand instead of opening a browser agent).

## Step 1 — Scope the run

```bash
GIT_VANILLA=1 git status --porcelain
GIT_VANILLA=1 git diff --name-only main...HEAD
```

Combine committed-on-branch and uncommitted paths, then classify:

| Diff | Run |
|---|---|
| changes what a user sees or does — new/changed screens, components, flows, strings | code + browser |
| `auth/ models/ firestore.rules storage.rules tests/ config/ hooks/`, or a token/theme change with no visible surface change | code only |
| only `docs/ .claude/ scripts/ .github/ README.md TODO.md` | nothing — say so in two lines and stop |

The browser pass is for **user-visible surface**, not for every file under `components/`.
A string-only change, a token added to the scale, a refactor with identical output — those
are `code` only. When genuinely unsure, ask the user rather than defaulting to the
expensive run.

`--all`, `--code` and `--quick` override the table. An empty diff stops the run.

State the scope you chose and why in one line before doing anything else.

## Step 2 — code-review

Hand it: the issue number, the spec path, the **full diff**. Embed `respond in caveman
full`. Never hand it your own account of what you built or why it is correct — that
sentence is what turns a reviewer into a rubber stamp.

Read `.tmp/review/code-review.md`. Apply every `blocking` and every `should-fix` you are
not explicitly deferring, then:

```bash
yarn lint --write && yarn invariants && yarn typecheck && yarn test
```

Green before going further. If `code-review` found `blocking` items, re-run it **scoped** —
hand it the finding list and the new diff of just your fixes, and ask it to verify those,
not to review again from scratch.

If the scope is `code` only, jump to Step 6.

## Step 3 — Bring the app up

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
  fixture.

Record the PID when you start something:

```bash
(yarn emulators:seed > .tmp/emu.log 2>&1 & echo $! > .tmp/emu.pid)
(yarn web            > .tmp/web.log 2>&1 & echo $! > .tmp/web.pid)
```

**Smoke-test yourself before spawning the agent.** Load the app, sign in, walk the
feature's primary path. Spending a browser agent on a white screen is the expensive
failure mode. This is a paragraph of work.

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

Also close the browser session: `playwright-cli -s=review close`.

## Step 4 — browser-review

One agent, one browser session, one walk. It does acceptance and craft together on
pristine fixture data, then the hostile checklist once it is free to mutate. There is no
emulator restart mid-run — nothing screenshots after it.

Hand it: the issue number, the spec path, `git diff --name-only`, and that the app is
running at <http://localhost:8081>. Not the diff, and not your account of the change.

**Note how many turns it took.** The agent runs on `sonnet` because this pass is dominated
by *input* — screenshots, accessibility trees, and the transcript re-sent every turn —
where Sonnet 5 is 1.67x cheaper per token than Opus 5 on an identical tokenizer. What
Sonnet 5 does inflate is turn count, and every extra turn re-sends the accumulated
screenshots. If a run visibly wanders — repeated snapshots of the same screen,
re-verification nobody asked for, far more turns than the walk needs — flip `model:` to
`opus` in `.claude/agents/browser-review.md`. Opus wins the moment Sonnet takes more than
1.67x the tokens. Judge it on an observed run, never in advance.

## Step 5 — The fix loop

Read `.tmp/review/browser-review.md`. Print one severity-ordered table in chat, caveman
full: severity, source, finding, fix.

The bar:

- **`blocking`** — must be fixed. Never deferrable, by anyone.
- **`should-fix`** — fix it, or defer it by writing one line of reason into the merged
  report. A silent skip is not a defer.
- **`idea`** — never acted on here. List them all and **ask the user** which to file:
  `GIT_VANILLA=1 gh issue create --label idea`. The rest are dropped. Never file one
  without asking, never file them all by default.

While not PASS and rounds used **< 2**:

1. Apply the fixes yourself.
2. `yarn lint --write`, `yarn invariants`, `yarn typecheck`, `yarn test` — green.
3. **Re-run scoped, not whole.** Hand `browser-review` the list of fixes and ask it to
   verify exactly those, plus any checklist item they could have broken. Do not re-run the
   full walk, and do not re-run `code-review` unless a fix changed logic rather than
   presentation.
4. Count the round.

**PASS** = zero `blocking` and zero outstanding `should-fix`.

After two rounds without a PASS, **stop**. Print the outstanding findings, say which
rounds were spent, and ask the user how to proceed. Do not keep grinding.

## Step 6 — Report

State plainly: PASS or NOT PASS, rounds used, what was fixed, what was deferred and why,
which ideas were filed as issues, and whether the emulator was pristine. If the run was
`--code`, `--quick` or auto-scoped to code only, say that no browser pass happened and
what you smoke-tested by hand instead.

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
what the Auth emulator's picker offers the browser agent so it never has to create an
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
