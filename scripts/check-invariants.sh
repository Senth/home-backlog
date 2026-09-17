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
# Checks 1-6, 8 and 14 through 19 read the whole working tree — tracked files
# *and* untracked ones that git would add, because the moment you most want
# this run is right after writing a new file, and a new file has not been
# staged yet. A violation is a violation whoever wrote it, and the tree being
# clean today is what makes whole-tree scanning affordable.
#
# Check 7 is diff-shaped by nature and needs a base ref. Auto-detected, it
# reports `skip` when there is nothing to diff against; named explicitly with
# `--base` and unresolvable, it is a hard error — a CI expression that evaluates
# to an empty string must never read as a pass.
#
# Requires: git, grep, awk, jq, node, and bash 4.4+ for `mapfile -d`.
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
# number or a color is allowed to be written down. `functions/` is a separate
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
# not leave grep reading stdin. An optional single grep flag may precede the
# file list; only `-i` (check 2's named colors) uses it.
scan() {
	local -a opts=()
	[[ "${1:-}" == -* ]] && opts=("$1") && shift
	# No files is a pass, and it must not reach xargs: `printf '%s\\0'` with no
	# arguments emits one NUL, which `xargs -0` reads as one empty filename.
	[[ $# -gt 0 ]] || return 0
	printf '%s\0' "$@" | xargs -0 -r grep -HnE "${opts[@]}" "$PATTERN"
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
# 2. No color literal outside theme/
#
# Hex is matched quoted only, because `#101` in prose is an issue reference and
# every real color in this codebase is written as a string. The named CSS
# colors are matched too — `"white"` is as much a literal as `"#FFFFFF"`, and
# it is the spelling a reflex reaches for first. `transparent` is not on the
# list: it names an absence, and no palette entry could replace it.
#
# The named arm runs case-insensitively — React Native parses color names that
# way, so `"White"` is the same literal — and only behind a `color` prop or
# key, and never in a test file. That shape is the exemption story: a quoted
# color word is also what a Firestore field value looks like — `tag: "blue"`,
# or a label mock's `color: "teal"` — and a type union (`type Tag = "red" |
# "green"`) and a test assertion (`toBe("blue")`) read the same. None of those
# is a style. A literal the shape misses is caught by the reviewer, not lost.
# ---------------------------------------------------------------------------
PATTERN="([\"'\`])#[0-9a-fA-F]{3,8}\\1|\\b(rgba?|hsla?)\\("
NAMED="color[a-z]*[[:space:]]*[:=][[:space:]]*[{]?[[:space:]]*([\"'\`])(white|black|red|green|blue|grey|gray|silver|yellow|orange|purple|pink|brown|cyan|magenta|navy|teal|lime|aqua|fuchsia|maroon|olive|violet|gold|coral|crimson|indigo|salmon|lightgray|darkgray)\\1"
hits=$(
	{
		scan "${SRC[@]}"
		PATTERN=$NAMED
		scan -i "${SRC[@]}" | grep -vE '\.test\.tsx?:[0-9]+:' || true
	} | strip_comments
)
if [[ -n "$hits" ]]; then
	report 2 "color literals" FAIL "$hits" \
		"Read colors from useAppTheme() in @/theme; add the color to theme/index.ts if it does not exist yet."
else
	report 2 "color literals" ok
fi

# ---------------------------------------------------------------------------
# 3. useAppTheme(), never Paper's bare useTheme()
#
# Paper's own hook is untyped for `colors.warning` and `colors.success`, so it
# silently hands back the MD3 type for the two colors this app added.
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
# 14. `firebase emulators:start` / `firebase emulators:exec` run only through
#     the two files that own them
#
# A second place that boots emulators is a second port book and a second hub
# locator. scripts/dev-stack.sh is the one owner of boot and teardown, and
# scripts/test-rules.mjs deliberately runs its own project id on its own
# allocated ports. Anything else that names these commands — a package.json
# script, a workflow, a doc's copy-pasteable command, a new helper — is a
# bypass of that owner.
#
# The exclusions are by file, and they are the whole story: the two homes
# above plus this script, whose pattern string spells the commands out. Prose
# mentions elsewhere are already dropped by strip_comments, so no extra
# carve-out is needed for them.
# ---------------------------------------------------------------------------
mapfile -t -d '' ALL_FILES < <(
	git ls-files -z --cached --others --exclude-standard
)
EMULATOR_FILES=()
for f in "${ALL_FILES[@]}"; do
	[[ "$f" == scripts/dev-stack.sh || "$f" == scripts/test-rules.mjs || "$f" == scripts/check-invariants.sh ]] && continue
	EMULATOR_FILES+=("$f")
done
PATTERN='firebase[[:space:]]+emulators:(start|exec)'
hits=$(scan -I "${EMULATOR_FILES[@]}" | strip_comments)
if [[ -n "$hits" ]]; then
	report 14 "emulators via dev-stack" FAIL "$hits" \
		"Emulators boot only through scripts/dev-stack.sh; the rules suite keeps its own run in scripts/test-rules.mjs."
else
	report 14 "emulators via dev-stack" ok
fi

# ---------------------------------------------------------------------------
# 15. Every literal t("…") key exists in en-US.json
#
# The failure e2e/i18n.spec.ts used to be the only catcher of — a
# `t("bord.title")` typo, a key added to no file at all — is greppable, so it
# belongs here at gate speed beside check 6's parity. What stays browser-only
# is the half grep cannot see: keys built at runtime (`t(prefix + x)`,
# `t(map[key])`), and the proof that nothing raw reaches the screen.
#
# A plural key is called by its stem — t("board.assignedTo", { count }) —
# while the files hold the _one/_other leaves, so a stem backed by any i18next
# plural suffix counts as present.
#
# Test files are out: they assert against key strings, and none of them is a
# user-facing surface.
# ---------------------------------------------------------------------------
PATTERN='\bt\(["'\''][^"'\''`]+["'\'']'
T_FILES=()
for f in "${SRC[@]}"; do
	[[ "$f" =~ \.test\.tsx?$ ]] && continue
	T_FILES+=("$f")
done
used=$(
	printf '%s\0' "${T_FILES[@]}" |
		xargs -0 -r grep -HnoE "$PATTERN" |
		sed -E "s/:[[:space:]]*t\\([\"']/:/; s/[\"']\$//"
)
EN_KEYS=$(keypaths "$EN")
missing=""
while IFS= read -r entry; do
	[[ -z "$entry" ]] && continue
	key="${entry##*:}"
	grep -qxF "$key" <<<"$EN_KEYS" && continue
	for suffix in zero one two few many other; do
		grep -qxF "${key}_${suffix}" <<<"$EN_KEYS" && break 2
	done
	missing+="$entry"$'\n'
done < <(printf '%s\n' "$used" | sort -u)
if [[ -n "$missing" ]]; then
	report 15 "t() keys exist" FAIL "${missing%$'\n'}" \
		"Every literal t(\"…\") key must exist in i18n/locales/en-US.json (a plural stem counts when a _one/_other leaf exists); keys built at runtime are the e2e/i18n.spec.ts check."
else
	report 15 "t() keys exist" ok
fi

# ---------------------------------------------------------------------------
# 16. functions/src/icon-names.ts matches the installed glyph map
#
# The label verbs validate `icon` against a set generated from the installed
# @expo/vector-icons (#256). A Renovate bump that adds glyphs must not leave
# the API rejecting an icon the picker offers — the generator regenerates in
# memory and compares, so a stale committed file fails here.
# ---------------------------------------------------------------------------
icon_check=$(node scripts/gen-icon-names.mjs --check 2>&1)
if [[ $? -ne 0 ]]; then
	report 16 "icon names generated" FAIL "$icon_check" \
		"Run yarn icon-names and commit the regenerated functions/src/icon-names.ts."
else
	report 16 "icon names generated" ok
fi

# ---------------------------------------------------------------------------
# 17. Button hierarchy — no surface renders two contained buttons
#
# docs/DESIGN.md § Components: `contained` is the one primary action on a
# surface. A screen file is one surface and each `AppDialog` / `AppSheet`
# region is another, so the count is per region, not per file — the same
# screen may legitimately hold one on the page and one inside a dialog
# (app/(app)/automations.tsx does exactly that).
#
# The FAB half of the rule — a screen with a FAB has no contained button — is
# the half no grep decides: the FAB legitimately stands down while an empty
# state's button is up (locations.tsx, labels.tsx), and whether two renders
# are mutually exclusive is not a text fact. The reviewer owns that half,
# like every part of the rule that is wider than this regex.
# ---------------------------------------------------------------------------
button_hits=$(
	for f in "${SRC[@]}"; do
		[[ "$f" =~ \.test\.tsx?$ ]] && continue
		awk -v re="mode=[\"']contained[\"']" '
			function flush() {
				if (n_dialog > 1) print hits_dialog
				if (n_bare > 1) print hits_bare
				dialog = 0; n_dialog = 0; hits_dialog = ""
				n_bare = 0; hits_bare = ""
			}
			FNR == 1 { flush() }
			# A wholly-comment line is not a render, same as strip_comments.
			/^[[:space:]]*(\/\/|\*|\/\*)/ { next }
			/<AppDialog/ || /<AppSheet/ { dialog = 1 }
			/<\/AppDialog>/ || /<\/AppSheet>/ {
				if (n_dialog > 1) print hits_dialog
				dialog = 0; n_dialog = 0; hits_dialog = ""
			}
			$0 ~ re {
				line = FILENAME ":" FNR ":" $0
				if (dialog) {
					n_dialog++
					hits_dialog = hits_dialog (n_dialog > 1 ? "\n" line : line)
				} else {
					n_bare++
					hits_bare = hits_bare (n_bare > 1 ? "\n" line : line)
				}
			}
			END { flush() }
		' "$f"
	done
)
if [[ -n "$button_hits" ]]; then
	report 17 "button hierarchy" FAIL "$button_hits" \
		"contained is the one primary action on a surface — one per screen, one per dialog, never two (docs/DESIGN.md § Components). The FAB is that action wherever it exists; whether a FAB and a contained button stand down for each other is the reviewer's call, not a grep's."
else
	report 17 "button hierarchy" ok
fi

# ---------------------------------------------------------------------------
# 18. DueChip renders due in warning and nothing else
#
# § Token roles: `warning` is status, always carried with words, and
# components/board/DueChip.tsx is where the due date implements that — the
# calendar glyph and the words, both warning, no prop to change it. A second
# color in that file is the first step of a card whose lateness is a hue;
# no `warning` at all means the words lost the color the contract gives them.
# ---------------------------------------------------------------------------
PATTERN='colors\.'
hits=$(scan components/board/DueChip.tsx | grep -v 'colors\.warning' | strip_comments)
if ! grep -q 'colors\.warning' components/board/DueChip.tsx; then
	report 18 "DueChip warning-only" FAIL \
		"components/board/DueChip.tsx no longer reads colors.warning" \
		"Due keeps the calendar glyph and the words in warning and nothing else — docs/DESIGN.md § Token roles."
elif [[ -n "$hits" ]]; then
	report 18 "DueChip warning-only" FAIL "$hits" \
		"Due is warning beside the words and nothing else — docs/DESIGN.md § Token roles."
else
	report 18 "DueChip warning-only" ok
fi

# ---------------------------------------------------------------------------
# 19. The label glyph never renders without a named wrapper
#
# § Labels: an icon-only label carries its title as the accessible name on
# its wrapper. PaperIcon hides every glyph from the accessibility tree on
# purpose, so a LabelGlyph whose name lives on the glyph has no name at all.
#
# The glyph may render only where the control around it provably carries the
# name, and the exclusions are by file because that is the whole story:
# LabelDot's own Pressable, LabelPicker's CheckRow, LabelRow's TouchableRipple
# (whose content is the title itself), the labels DetailRow on a node's
# details, the labels List.Item on a home — the last two name the group,
# and their dots are decoration inside a named control, not marks of their
# own — and the board filter's two files, where the stack is a row's value
# or a pill whose accessible wrapper names the group (the sheet's own use is
# LabelPicker's CheckRow again). A LabelGlyph anywhere else is a dot nobody
# named — the same shape as check 12's Appbar.BackAction, with the same
# answer: render it inside a wrapper that names it, or extend the canonical
# LabelDot.
# ---------------------------------------------------------------------------
GLYPH_FILES=()
for f in "${SRC[@]}"; do
	[[ "$f" =~ \.test\.tsx?$ ]] && continue
	# Quoted right-hand sides: these paths hold literal brackets and parens,
	# and [[ == treats a quoted pattern as the string itself.
	[[ "$f" == "components/board/LabelDot.tsx" ||
		"$f" == "components/label/LabelPicker.tsx" ||
		"$f" == "components/board/BoardFilterRow.tsx" ||
		"$f" == "components/board/BoardFilterSheet.tsx" ||
		"$f" == "app/(app)/homes/[homeId]/labels.tsx" ||
		"$f" == "app/(app)/homes/[homeId].tsx" ||
		"$f" == "app/(app)/(tabs)/projects/[nodeId]/details.tsx" ]] && continue
	GLYPH_FILES+=("$f")
done
PATTERN='<LabelGlyph'
hits=$(scan "${GLYPH_FILES[@]}" | strip_comments)
if [[ -n "$hits" ]]; then
	report 19 "label glyph named" FAIL "$hits" \
		"LabelGlyph is silent — PaperIcon hides the glyph from the accessibility tree. Wrap it in LabelDot, or put the name on the row that carries it (see LabelPicker's CheckRow)."
else
	report 19 "label glyph named" ok
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
