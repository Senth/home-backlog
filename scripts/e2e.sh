#!/usr/bin/env bash
#
# The Playwright half of `yarn e2e`, run after `dev-stack.sh up` has brought
# the stack. All arguments pass straight through to `playwright test`, so
# `yarn e2e --last-failed` and `yarn e2e <spec path>` reach the runner.
#
# Why this file exists: Playwright's `--last-failed` silently runs the whole
# suite when no last-run data exists (#244) — a fresh worktree, a cleaned
# `.tmp`, or a failure first seen in CI. The only symptom is twenty lost
# minutes, so the guard below turns that case into a loud error instead.
#
# Usage:
#   scripts/e2e.sh [playwright test args...]

set -euo pipefail

cd "$(dirname "$0")/.."

for arg in "$@"; do
	if [ "$arg" = "--last-failed" ] && [ ! -f .tmp/e2e/results/.last-run.json ]; then
		echo "e2e: --last-failed has no last-run data (.tmp/e2e/results/.last-run.json is missing) — run the full suite first: yarn e2e" >&2
		exit 1
	fi
done

exec ./node_modules/.bin/playwright test "$@"
