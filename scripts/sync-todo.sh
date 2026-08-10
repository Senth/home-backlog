#!/usr/bin/env bash
#
# Regenerate TODO.md from GitHub Issues (+ Kanban Project board status when available).
#
# Source of truth = GitHub Issues + the Project board.
# TODO.md is a GENERATED MIRROR — do not hand-edit it; change the issue or board instead.
#
# Usage:    scripts/sync-todo.sh
# Requires: gh (authenticated) and jq.
# Optional: export TODO_PROJECT_NUMBER=<n> to group issues by board column
#           (Backlog / Next Up / In Progress). Needs the `project` gh scope:
#               gh auth refresh -s project
#           Without it, every open issue is listed under "Backlog".
set -euo pipefail

REPO="Senth/home-backlog"
PROJECT_OWNER="Senth"
PROJECT_NUMBER="${TODO_PROJECT_NUMBER:-4}"  # "Home Backlog" board
OUT="$(git rev-parse --show-toplevel)/TODO.md"

command -v gh >/dev/null 2>&1 || { echo "sync-todo: gh not found; skipping" >&2; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "sync-todo: jq not found; skipping" >&2; exit 0; }
gh auth status >/dev/null 2>&1 || { echo "sync-todo: gh not authenticated; skipping" >&2; exit 0; }

issues_json="$(gh issue list --repo "$REPO" --state open --limit 200 \
  --json number,title,labels 2>/dev/null || echo '[]')"

# issue number -> board status (only if the project is reachable)
declare -A STATUS
if [[ -n "$PROJECT_NUMBER" ]]; then
  if items_json="$(gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" \
      --format json --limit 500 2>/dev/null)"; then
    while IFS=$'\t' read -r num st; do
      [[ -n "$num" ]] && STATUS["$num"]="$st"
    done < <(echo "$items_json" | jq -r '
      .items[]? | select(.content.type=="Issue")
      | [(.content.number|tostring), (.status // "Backlog")] | @tsv')
  fi
fi

# number \t type-tag \t title   (type-tag = first of bug/feature/cleanup/idea)
rows="$(echo "$issues_json" | jq -r '
  def tag: [.labels[].name] as $l
    | (first(("bug","feature","cleanup","idea") | select(. as $t | $l|index($t))) // "");
  .[] | [(.number|tostring), tag, .title] | @tsv')"

emit() {  # $1 = wanted board status
  local want="$1" num tag title st
  while IFS=$'\t' read -r num tag title; do
    [[ -z "$num" ]] && continue
    st="${STATUS[$num]:-Backlog}"
    [[ "$st" == "$want" ]] || continue
    if [[ -n "$tag" ]]; then printf -- '- [ ] #%s `%s` %s\n' "$num" "$tag" "$title"
    else                     printf -- '- [ ] #%s %s\n' "$num" "$title"; fi
  done <<< "$rows"
}

{
  echo "# TODO"
  echo
  echo "> **Generated mirror — do not edit by hand.** Source of truth = [GitHub Issues](https://github.com/$REPO/issues) + the Kanban board."
  echo "> Regenerate with \`scripts/sync-todo.sh\`. Last synced: $(date -u '+%Y-%m-%d %H:%M UTC')."
  echo
  echo "## Working On"
  echo
  out="$(emit 'In progress')"; [[ -n "$out" ]] && echo "$out" || echo "_nothing in progress_"
  echo
  echo "## Next Up"
  echo
  out="$(emit 'Next Up')"; [[ -n "$out" ]] && echo "$out" || echo "_nothing queued_"
  echo
  echo "## Backlog"
  echo
  out="$(emit 'Backlog')"; [[ -n "$out" ]] && echo "$out" || echo "_empty_"
} > "$OUT"

echo "sync-todo: wrote $OUT"
