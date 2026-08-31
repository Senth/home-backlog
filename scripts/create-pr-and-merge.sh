#!/usr/bin/env bash
#
# Watch the run, then merge. Never `gh pr merge --auto`.
#
# Reuses the branch's open PR (a draft from /ship counts) or opens one, polls
# for the CI run — it is not registered the instant the PR exists, and an empty
# id makes `gh run watch` open an interactive picker that hangs forever — then
# watches it and squashes.

set -euo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)

pr=$(GIT_VANILLA=1 gh pr list --head "$branch" --state open --json number --jq '.[0].number')
if [ -z "$pr" ]; then
	url=$(GIT_VANILLA=1 gh pr create --base main --head "$branch" --draft --fill)
	pr=${url##*/}
fi

for _ in $(seq 30); do
	RUN=$(GIT_VANILLA=1 gh run list --branch "$branch" \
		--workflow "PR - Lint, typecheck, test and build" \
		--limit 1 --json databaseId --jq '.[0].databaseId')
	[ -n "$RUN" ] && break || sleep 2
done
[ -n "$RUN" ] || {
	echo "create-pr-and-merge: no CI run found for $branch" >&2
	exit 1
}

GIT_VANILLA=1 gh run watch "$RUN" --exit-status

if [ "$(GIT_VANILLA=1 gh pr view "$pr" --json isDraft --jq .isDraft)" = true ]; then
	GIT_VANILLA=1 gh pr ready "$pr"
fi
GIT_VANILLA=1 gh pr merge "$pr" --squash
