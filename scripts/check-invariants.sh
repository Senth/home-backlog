#!/usr/bin/env bash
#
# The grep-shaped half of the CLAUDE.md invariants, run deterministically.
#
# `code-review` used to walk a ten-point checklist by hand on every review. Most
# of those points are a regex, and a regex is cheaper, earlier and more reliable
# run here than by a model that only looks when somebody asks it to. What stays
# with the agent is the half no grep decides: query safety, listener breadth,
# whether a bare string is user-facing, and whether a `Platform.OS` branch should
# have been a file split.
#
# Usage:   yarn invariants [--base <ref>]
# Exit:    0 = all pass, 1 = an invariant failed, 2 = the script could not run
#
# Checks 1-6 and 8 read the whole working tree — tracked files *and* untracked
# ones that git would add, because the moment you most want this run is right
# after writing a new file, and a new file has not been staged yet. A violation
# is a violation whoever wrote it, and the tree being clean today is what makes
# whole-tree scanning affordable.
#
# Check 7 is diff-shaped by nature and needs a base ref. Auto-detected, it
# reports `skip` when there is nothing to diff against; named explicitly with
# `--base` and unresolvable, it is a hard error — a CI expression that evaluates
# to an empty string must never read as a pass.
#
# Requires: git, grep, jq, and bash 4.4+ for `mapfile -d`.
set -uo pipefail

# `sort` orders by codepoint and `comm` compares by LC_COLLATE. Under a UTF-8
# locale those two disagree about `.` versus letters, which made check 6 report
# keys as missing that are present in both files.
export LC_ALL=C

top=$(git rev-parse --show-toplevel 2>/dev/null) || {
	echo "check-invariants: not inside a git repository" >&2
	exit 2
}
cd "$top" || {
	echo "check-invariants: cannot enter $top" >&2
	exit 2
}

BASE=""
BASE_EXPLICIT=0
while [[ $# -gt 0 ]]; do
	case "$1" in
	--base)
		[[ $# -ge 2 ]] || {
			echo "check-invariants: --base needs a ref" >&2
			exit 2
		}
		BASE="$2"
		BASE_EXPLICIT=1
		shift 2
		;;
	-h | --help)
		sed -n '3,26p' "$0" | sed 's/^# \?//'
		exit 0
		;;
	*)
		echo "check-invariants: unknown argument: $1" >&2
		exit 2
		;;
	esac
done

command -v jq >/dev/null 2>&1 || {
	echo "check-invariants: jq not found" >&2
	exit 2
}

# ---------------------------------------------------------------------------
# What is in scope
#
# `theme/` is where the tokens and the palettes live, so it is the one place a
# number or a colour is allowed to be written down. `functions/` is a separate
# TypeScript project with its own module resolution, no `@/` alias and no React
# at all. `dist/` is build output; `scripts/` is not app code.
#
# `--others --exclude-standard` is what makes a brand-new file visible while
# still honouring .gitignore.
# ---------------------------------------------------------------------------
mapfile -t -d '' TREE < <(
	git ls-files -z --cached --others --exclude-standard '*.ts' '*.tsx'
)

SRC=()    # checks 1-3: everything the tokens and the theme apply to
ALL_TS=() # checks 4-5: every app-side file, theme included
for f in "${TREE[@]}"; do
	[[ "$f" =~ ^(functions|dist|node_modules)/ ]] && continue
	ALL_TS+=("$f")
	# `e2e/` and `playwright.config.ts` are excluded from the *style* checks
	# below, not from the alias check above. A viewport of 390x844 and a
	# `minimum: 48` threshold are the numbers under test — the tokens are what
	# they are asserted against, so a token here would be the test grading its
	# own homework.
	[[ "$f" =~ ^(theme|scripts|e2e)/ ]] && continue
	[[ "$f" == "playwright.config.ts" ]] && continue
	SRC+=("$f")
done

if [[ ${#ALL_TS[@]} -eq 0 ]]; then
	echo "check-invariants: no TypeScript sources found — refusing to report a pass" >&2
	exit 2
fi

FAILED=0
declare -a RESULTS

# `-H` because a batch of exactly one file makes grep drop the path prefix, and
# every consumer below parses `path:line:text`. `-r` because an empty list must
# not leave grep reading stdin.
scan() {
	# No files is a pass, and it must not reach xargs: `printf '%s\\0'` with no
	# arguments emits one NUL, which `xargs -0` reads as one empty filename.
	[[ $# -gt 0 ]] || return 0
	printf '%s\0' "$@" | xargs -0 -r grep -HnE "$PATTERN"
}

# Drop lines that are wholly a comment: an issue reference like `#101` and a
# worked example like `9 + 30 + 9 = 48` are not violations. The comment marker
# is what follows the second colon of `path:line:text`.
strip_comments() { grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)' || true; }

# report <number> <name> <status> [detail-blocks...]
report() {
	local num="$1" name="$2" status="$3"
	shift 3
	RESULTS+=("$(printf '%2s|%s|%s' "$num" "$name" "$status")")
	if [[ "$status" == "FAIL" ]]; then
		FAILED=1
		printf '\n\033[31m%s. %s\033[0m\n' "$num" "$name" >&2
		printf '%s\n' "$@" | sed 's/^/    /' >&2
	fi
}

# ---------------------------------------------------------------------------
# 1. No numeric literal in a style prop
#
# Both spellings: `padding: 16` in a style object and `size={24}` on a JSX prop.
# `0` counts — `space.none` and `radius.none` exist precisely so that removing a
# Paper default is still a token.
#
# `flex`, `opacity` and `zIndex` are deliberately absent: they are ratios and
# ordering, not spacing, radii or elevation, and there is no scale for them.
# ---------------------------------------------------------------------------
STYLE_PROPS='padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical'
STYLE_PROPS+='|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical'
STYLE_PROPS+='|gap|rowGap|columnGap'
STYLE_PROPS+='|borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius'
STYLE_PROPS+='|borderWidth|borderTopWidth|borderBottomWidth|borderLeftWidth|borderRightWidth'
STYLE_PROPS+='|elevation|width|height|minWidth|minHeight|maxWidth|maxHeight|flexBasis'
STYLE_PROPS+='|fontSize|lineHeight|letterSpacing|size'

PATTERN="\\b(${STYLE_PROPS})[[:space:]]*(:|=\\{)[[:space:]]*-?[0-9]"
hits=$(scan "${SRC[@]}" | strip_comments)
if [[ -n "$hits" ]]; then
	report 1 "style literals" FAIL "$hits" \
		"Values come from space / radius / elevation / size / icon in theme/tokens.ts — extend the scale, never inline."
else
	report 1 "style literals" ok
fi

# ---------------------------------------------------------------------------
# 2. No colour literal outside theme/
#
# Hex is matched quoted only, because `#101` in prose is an issue reference and
# every real colour in this codebase is written as a string. The named CSS
# colours are matched too — `"white"` is as much a literal as `"#FFFFFF"`, and
# it is the spelling a reflex reaches for first. `transparent` is not on the
# list: it names an absence, and no palette entry could replace it.
# ---------------------------------------------------------------------------
PATTERN="([\"'\`])#[0-9a-fA-F]{3,8}\\1|\\b(rgba?|hsla?)\\(|([\"'\`])(white|black|red|green|blue|grey|gray|silver|yellow|orange|purple|pink|brown|cyan|magenta)\\3"
hits=$(scan "${SRC[@]}" | strip_comments)
if [[ -n "$hits" ]]; then
	report 2 "colour literals" FAIL "$hits" \
		"Read colours from useAppTheme() in @/theme; add the colour to theme/index.ts if it does not exist yet."
else
	report 2 "colour literals" ok
fi

# ---------------------------------------------------------------------------
# 3. useAppTheme(), never Paper's bare useTheme()
#
# Paper's own hook is untyped for `colors.warning` and `colors.success`, so it
# silently hands back the MD3 type for the two colours this app added.
# `theme/index.ts` is the one file allowed to import it, under an alias.
# ---------------------------------------------------------------------------
PATTERN='useTheme'
hits=$(scan "${SRC[@]}" | strip_comments)
if [[ -n "$hits" ]]; then
	report 3 "useAppTheme" FAIL "$hits" \
		"Import { useAppTheme } from \"@/theme\" instead."
else
	report 3 "useAppTheme" ok
fi

# ---------------------------------------------------------------------------
# 4. Imports use the @/ alias, never a relative path
#
# Applies to every app-side file including tests, which is why the rules suite
# has a moduleNameMapper in jest.rules.config.js. `functions/` is out of scope —
# it has no alias.
# ---------------------------------------------------------------------------
PATTERN='(from|import|require\()[[:space:]]*\(?["'\''`]\.\.?/'
hits=$(scan "${ALL_TS[@]}" | strip_comments)
if [[ -n "$hits" ]]; then
	report 4 "@/ alias imports" FAIL "$hits" \
		"Rewrite as @/<path-from-repo-root>."
else
	report 4 "@/ alias imports" ok
fi

# ---------------------------------------------------------------------------
# 5. No StyleSheet.create, no styled-components, no Tailwind / NativeWind
#
# The styling order is a Paper component first, else a style prop built from
# theme/tokens.ts. The rationale for having no utility-class layer at all is in
# docs/PROJECT.md; this check is what keeps it from being reintroduced by
# reflex. package.json is checked as well, because the import always follows the
# dependency.
# ---------------------------------------------------------------------------
PATTERN='StyleSheet\.create|styled-components|nativewind|tailwind|className='
hits=$(scan "${ALL_TS[@]}" | strip_comments)
dep_hits=$(jq -r '
	(.dependencies // {}) + (.devDependencies // {})
	| keys[]
	| select(test("styled-components|nativewind|tailwind"))
	| "package.json: " + .' package.json)
hits=$(printf '%s\n%s' "$hits" "$dep_hits" | grep -v '^$')
if [[ -n "$hits" ]]; then
	report 5 "no StyleSheet/Tailwind" FAIL "$hits" \
		"Use a react-native-paper component, else a style prop built from theme/tokens.ts."
else
	report 5 "no StyleSheet/Tailwind" ok
fi

# ---------------------------------------------------------------------------
# 6. en-US and sv-SE have identical key sets
#
# A key present in one file and not the other is a string that renders as its
# own key path to half the household.
# ---------------------------------------------------------------------------
EN=i18n/locales/en-US.json
SV=i18n/locales/sv-SE.json
if [[ ! -f "$EN" || ! -f "$SV" ]]; then
	echo "check-invariants: $EN or $SV is missing" >&2
	exit 2
fi
keypaths() { jq -r '[paths(scalars) | map(tostring) | join(".")] | sort[]' "$1"; }
only_en=$(comm -23 <(keypaths "$EN") <(keypaths "$SV"))
only_sv=$(comm -13 <(keypaths "$EN") <(keypaths "$SV"))
if [[ -n "$only_en" || -n "$only_sv" ]]; then
	detail=""
	[[ -n "$only_en" ]] && detail+=$'en-US only:\n'"$(sed 's/^/  /' <<<"$only_en")"$'\n'
	[[ -n "$only_sv" ]] && detail+=$'sv-SE only:\n'"$(sed 's/^/  /' <<<"$only_sv")"
	report 6 "en-US / sv-SE parity" FAIL "${detail%$'\n'}" \
		"Every user-facing string goes through t(), and both locale files change together."
else
	report 6 "en-US / sv-SE parity" ok
fi

# ---------------------------------------------------------------------------
# 7. Rules changed ⇒ tests/rules/ changed in the same diff
#
# firestore.rules and storage.rules are the only thing between a household's
# private nodes and everyone else.
# ---------------------------------------------------------------------------
if [[ -z "$BASE" ]]; then
	for candidate in origin/main main; do
		if git rev-parse --verify --quiet "$candidate" >/dev/null; then
			BASE="$candidate"
			break
		fi
	done
fi
merge_base=""
[[ -n "$BASE" ]] && merge_base=$(git merge-base "$BASE" HEAD 2>/dev/null)
if [[ -z "$merge_base" && "$BASE_EXPLICIT" -eq 1 ]]; then
	echo "check-invariants: cannot resolve --base '$BASE' against HEAD" >&2
	exit 2
fi
if [[ -z "$merge_base" ]]; then
	report 7 "rules -> rules tests" "skip (no base ref)"
else
	changed=$(
		git diff --name-only "$merge_base" HEAD
		git diff --name-only HEAD
		git ls-files --others --exclude-standard
	)
	if grep -qE '^(firestore|storage)\.rules$' <<<"$changed" &&
		! grep -q '^tests/rules/' <<<"$changed"; then
		report 7 "rules -> rules tests" FAIL \
			"$(grep -E '^(firestore|storage)\.rules$' <<<"$changed" | sort -u)" \
			"Changed against ${BASE}, with nothing under tests/rules/ in the same diff."
	else
		report 7 "rules -> rules tests" ok
	fi
fi

# ---------------------------------------------------------------------------
# 8. Every module in models/ and utils/ has a sibling test — and so does any
#    hook that hides under components/
#
# These directories are domain logic by definition — nothing that is only a
# one-line wrapper around an SDK call belongs in either. `auth/` is deliberately
# not in the list: auth/redirect.ts really is that one-line wrapper.
#
# The `use-*.ts` clause is the gap this check used to have. A hook is a domain
# module wherever it lives, and `components/board/use-board-drag.ts` — a whole
# drag gesture, its geometry and its write — sat outside the two directories and
# so passed clean. The directory in the middle is optional, or a hook sitting
# directly in `components/` would be the same hole one level up. `.tsx` is out: that is a component, and CLAUDE.md forbids
# tests that only assert layout. `hooks/` is out too, deliberately, because half
# of what is in there is a one-line wrapper around a Firestore listener.
#
# Read from the same TREE as everything else, so an untracked test does not
# satisfy the check locally and then fail in CI, or the reverse.
# ---------------------------------------------------------------------------
declare -A HAVE=()
for f in "${TREE[@]}"; do HAVE["$f"]=1; done
missing=""
for f in "${TREE[@]}"; do
	[[ "$f" =~ ^(models|utils)/ || "$f" =~ ^components/(.*/)?use-[^/]+\.ts$ ]] || continue
	[[ "$f" =~ \.(test|d)\.tsx?$ ]] && continue
	base="${f%.*}"
	[[ -n "${HAVE["$base.test.ts"]:-}${HAVE["$base.test.tsx"]:-}" ]] || missing+="$f"$'\n'
done
if [[ -n "$missing" ]]; then
	report 8 "domain modules tested" FAIL "${missing%$'\n'}" \
		"Add a sibling <name>.test.ts, or move the file out if it has no logic of its own."
else
	report 8 "domain modules tested" ok
fi

# ---------------------------------------------------------------------------
# 9. Only utils/dev-console.ts may replace a console method
#
# That module swallows two react-native-web deprecations, plus the
# useNativeDriver notice on web only, so that the review's
# console gate means something again — see utils/dev-console.ts. The
# whole reason it is safe is that it is *one* narrow, tested, __DEV__-only
# filter that announces itself. A second one somewhere else, or a widening of
# this one to console.error, turns "the console is clean" back into a claim
# nobody can check.
#
# Assignment only: reading console.warn, or calling it, is not a filter. The
# act has more than one spelling, and every one of them counts: dot
# assignment (`console.warn =`), computed assignment (`console["warn"] =`),
# `Object.defineProperty(console, ...)`, React Native's own `LogBox.ignore*`
# and a value written on the line after the `=`. A console alias (`const c =
# console`) is not caught — the next reader can see that one — but everything
# greppable is.
#
# The module's own test is exempt too: it replaces `console.warn` on purpose,
# to prove the replacement works.
# ---------------------------------------------------------------------------
PATTERN='console\.(warn|error|log|info|debug)[[:space:]]*=[[:space:]]*($|[^=])'
PATTERN+='|console\[[^]]*\][[:space:]]*=[[:space:]]*($|[^=])'
PATTERN+='|defineProperty\([[:space:]]*console'
PATTERN+='|LogBox\.ignore'
hits=$(scan "${ALL_TS[@]}" | strip_comments | grep -v '^utils/dev-console\(\.test\)\?\.tsx\?:' || true)
if [[ -n "$hits" ]]; then
	report 9 "one console filter" FAIL "$hits" \
		"utils/dev-console.ts is the only place a console method may be replaced."
else
	report 9 "one console filter" ok
fi

# ---------------------------------------------------------------------------
# 11. functions/SKILL.md declares the contract version functions/src/version.ts
#     is running
#
# An agent decides whether its vendored copy of the contract is stale by
# comparing the `api-version` in that copy's frontmatter against the
# `X-Api-Version` header on any response. The served copy cannot drift, because
# `skill.ts` stamps it from `version.ts` on the way out. The checked-in copy can,
# and it is the one people read on GitHub and the one the next reader copies —
# a frontmatter that names last quarter's version tells a stale reader they are
# current, which is the one failure the whole scheme exists to prevent.
# ---------------------------------------------------------------------------
skill_version=$(sed -n '/^---$/,/^---$/p' functions/SKILL.md 2>/dev/null |
	sed -n 's/^api-version:[[:space:]]*//p' | head -1)
code_version=$(sed -n 's/^export const apiVersion = "\(.*\)";$/\1/p' \
	functions/src/version.ts 2>/dev/null | head -1)
if [[ -z "$skill_version" || -z "$code_version" ]]; then
	report 11 "skill.md version" FAIL \
		"could not read api-version from functions/SKILL.md or apiVersion from functions/src/version.ts" \
		"Keep the frontmatter key \`api-version:\` and the \`export const apiVersion = \"x.y.z\";\` line greppable."
elif [[ "$skill_version" != "$code_version" ]]; then
	report 11 "skill.md version" FAIL \
		"functions/SKILL.md says api-version: $skill_version, functions/src/version.ts says $code_version" \
		"Set the frontmatter api-version in functions/SKILL.md to $code_version."
else
	report 11 "skill.md version" ok
fi

# ---------------------------------------------------------------------------
# 12. No Appbar.BackAction
#
# Paper's BackAction renders its arrow through AppbarBackIcon, which imports
# MaterialCommunityIcon directly instead of going through Icon — so it is the
# one glyph in the app that never reaches settings.icon, and PaperIcon never
# gets to hide it. React Native Web then exposes it as role="img" with no
# accessible name: a WCAG 1.1.1 failure, and the axe rule role-img-alt.
#
# It failed as a flake before it failed as a build, because the glyph only
# enters the DOM once the icon font has loaded. components/ui/BackAction.tsx is
# the same arrow built from Appbar.Action, whose icon is a string and so does
# go through settings.icon.
# ---------------------------------------------------------------------------
PATTERN='<Appbar\.BackAction'
hits=$(scan "${ALL_TS[@]}" | strip_comments)
if [[ -n "$hits" ]]; then
	report 12 "no Appbar.BackAction" FAIL "$hits" \
		"Use <BackAction> from @/components/ui/BackAction."
else
	report 12 "no Appbar.BackAction" ok
fi

# ---------------------------------------------------------------------------
# 13. e2e holds ten spec files or fewer
#
# docs/TESTS.md rations e2e because it is the most expensive thing this repo
# owns: a cap nothing enforces is a suggestion, so the budget is counted here
# and an eleventh spec fails the gate instead of quietly becoming the new
# normal.
#
# Only `*.spec.ts` counts — the setup projects and `support/` are
# infrastructure, not specs. Read from TREE so an untracked eleventh file
# fails here the same way it would fail in CI.
# ---------------------------------------------------------------------------
count=0
for f in "${TREE[@]}"; do
	[[ "$f" =~ ^e2e/[^/]+\.spec\.ts$ ]] && count=$((count + 1))
done
if [[ "$count" -gt 10 ]]; then
	report 13 "e2e spec budget" FAIL \
		"e2e/ holds $count spec files; the cap is 10." \
		"A new spec displaces a named one or it does not get written — see \"Adding one\" in docs/TESTS.md."
else
	report 13 "e2e spec budget" ok
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\ncheck-invariants — %d files\n\n' "${#ALL_TS[@]}"
for row in "${RESULTS[@]}"; do
	IFS='|' read -r num name status <<<"$row"
	if [[ "$status" == "FAIL" ]]; then
		printf '  \033[31m%2s  %-26s %s\033[0m\n' "$num" "$name" "$status"
	else
		printf '  %2s  %-26s %s\n' "$num" "$name" "$status"
	fi
done
echo

if [[ "$FAILED" -eq 1 ]]; then
	echo "check-invariants: FAILED — see CLAUDE.md for the rule behind each." >&2
	exit 1
fi
echo "check-invariants: all pass"
