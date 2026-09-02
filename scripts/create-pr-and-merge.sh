#!/usr/bin/env bash
#
# Watch the run, then merge. Never `gh pr merge --auto`.
#
# Reuses the branch's open PR (a draft from /ship counts) or opens one, polls
# for the CI run — it is not registered the instant the PR exists, and an empty
# id makes `gh run watch` open an interactive picker that hangs forever — then
# watches it. Without --no-merge it marks a draft ready and squashes.
#
# Usage:
#   scripts/create-pr-and-merge.sh [--base <ref>] [--title <text>] [--body <text>] [--no-merge]
#
#   --base <ref>    the PR's base branch (default main)
#   --title/--body  PR title and body; they override what --fill takes from the
#                   commit message. On a reused PR they edit it instead.
#   --no-merge      stop once CI is green: leave the PR draft, the merge is yours.

set -euo pipefail

base=main
title=""
body=""
merge=1
while [[ $# -gt 0 ]]; do
	case "$1" in
	--base)
		[[ $# -ge 2 ]] || {
			echo "create-pr-and-merge: --base needs a value" >&2
			exit 2
		}
		base=$2
		shift 2
		;;
	--title)
		[[ $# -ge 2 ]] || {
			echo "create-pr-and-merge: --title needs a value" >&2
			exit 2
		}
		title=$2
		shift 2
		;;
	--body)
		[[ $# -ge 2 ]] || {
			echo "create-pr-and-merge: --body needs a value" >&2
			exit 2
		}
		body=$2
		shift 2
		;;
	--no-merge)
		merge=0
		shift
		;;
	*)
		echo "create-pr-and-merge: unknown argument: $1" >&2
		exit 2
		;;
	esac
done

branch=$(git rev-parse --abbrev-ref HEAD)

create_args=(--base "$base" --head "$branch" --draft --fill)
if [ -n "$title" ]; then
	create_args+=(--title "$title")
fi
if [ -n "$body" ]; then
	create_args+=(--body "$body")
fi

pr=$(GIT_VANILLA=1 gh pr list --head "$branch" --state open --json number --jq '.[0].number')
if [ -z "$pr" ]; then
	url=$(GIT_VANILLA=1 gh pr create "${create_args[@]}")
	pr=${url##*/}
elif [ -n "$title$body" ]; then
	edit_args=()
	if [ -n "$title" ]; then
		edit_args+=(--title "$title")
	fi
	if [ -n "$body" ]; then
		edit_args+=(--body "$body")
	fi
	GIT_VANILLA=1 gh pr edit "$pr" "${edit_args[@]}"
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

if [ "$merge" -eq 1 ]; then
	if [ "$(GIT_VANILLA=1 gh pr view "$pr" --json isDraft --jq .isDraft)" = true ]; then
		GIT_VANILLA=1 gh pr ready "$pr"
	fi
	GIT_VANILLA=1 gh pr merge "$pr" --squash
else
	GIT_VANILLA=1 gh pr view "$pr" --json url,isDraft --jq '"\(.url) — draft: \(.isDraft)"'
fi
