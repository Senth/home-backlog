#!/usr/bin/env bash
#
# The local stack — Firebase emulators plus the Expo web dev server — brought up
# and torn down by one owner instead of by every caller that needs it.
#
# Three callers share it: you, `playwright.config.ts` (which points `yarn e2e`
# here), and browser review. Each of them used to know how to boot a stack
# and, more importantly, how to kill one. That knowledge is now in one file,
# along with the two traps that cost real time to find:
#
#   1. `pkill -f "firebase emulators:start"` matches the shell running it, so the
#      command kills itself before it ever reaches the emulator.
#   2. `yarn` is a wrapper. Killing its pid leaves the `firebase` child holding
#      the ports, and the next run fails on an address already in use.
#
# Both are avoided the same way: every process is started under `setsid`, so it
# gets a process group of its own whose id equals its pid, and `down` signals the
# whole group rather than the wrapper at the top of it.
#
# Ports are not literals any more. Every `up` that actually boots something
# allocates a free block in 7000-7999 through `scripts/alloc-ports.mjs` —
# bind-probed, then claimed by atomic mkdirs in the main repo's registry, so
# two worktrees can never hold the same ports. The allocation lands in this
# worktree's `.tmp/dev-stack/stack.json`, and the emulators run against a
# generated copy of the committed `firebase.json` at the worktree root — the
# committed one's `emulators` block rewritten onto the allocated ports,
# everything else byte-identical. The generated copy has to sit at the root,
# not beside stack.json, because the CLI pins the project root to the
# --config file's directory: rules paths, `.firebaserc` deploy targets and the
# functions predeploy all resolve from there, and gitignored
# `firebase.dev-stack.json` is the one name at the root that stays out of git.
#
# `up` is idempotent and never adopts a foreign stack. What it trusts is this
# worktree's own `stack.json` and the pids recorded in it, and nothing else —
# the old `port_open` check treated *any* listening port as "already up",
# which is how a second worktree once ran its whole e2e suite against the
# first worktree's emulator without either of them noticing. Today a port that
# is listening without a live recorded pid is somebody else's problem: `up`
# allocates its own block around it, and `down` still only ever stops what
# this worktree started.
#
# Usage:
#   scripts/dev-stack.sh up [--no-web] [--fresh]
#   scripts/dev-stack.sh down
#   scripts/dev-stack.sh status
#   scripts/dev-stack.sh export
#
#   --no-web   emulators only; for rules tests and for seeding
#   --fresh    boot the emulators empty rather than importing .emulator-seed
#   export     write the running stack's data out to .emulator-seed

set -euo pipefail

cd "$(dirname "$0")/.."

command -v node >/dev/null 2>&1 || {
	echo "dev-stack: node is required" >&2
	exit 2
}
command -v jq >/dev/null 2>&1 || {
	echo "dev-stack: jq is required" >&2
	exit 2
}

STATE=".tmp/dev-stack"
# The registry lives next to the main worktree's .git, so every worktree of
# this repository shares one book of port claims. The path is derived once, in
# scripts/alloc-ports.mjs, and read through its `registry` subcommand — which
# also honours DEV_STACK_REGISTRY (tests and sandboxed smoke runs only).
REG="$(node scripts/alloc-ports.mjs registry)"
# The generated emulator config must be at the worktree root — see the header.
GENERATED_CONFIG="firebase.dev-stack.json"
mkdir -p "$STATE"

# `nc` is not installed here, and /dev/tcp is a bash feature that the default
# zsh does not have — hence the explicit `bash -c` even though this is a bash
# script, since the redirect is what does the probing. This is only ever used
# to *wait* for a port we just asked for and to *verify* after a stop; it is
# never used to adopt a listening port.
port_open() { timeout 1 bash -c "</dev/tcp/localhost/$1" 2>/dev/null; }

# A stack is ours when our own state file records a live pid for it — never
# inferred from a listening port.
running() {
	[ -f "$STATE/stack.json" ] || return 1
	local pid
	pid=$(jq -r --arg k "$1" '.pids[$k] // 0' "$STATE/stack.json")
	[ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null
}

# setsid gives the child its own process group, so its pid is also its pgid and
# `down` can signal the group without reaching back up into this script.
start_bg() {
	local name=$1
	shift
	setsid "$@" >"$STATE/$name.log" 2>&1 &
	echo $! >"$STATE/$name.pid"
}

wait_for_port() {
	local port=$1 label=$2 tries=${3:-120}
	for _ in $(seq "$tries"); do
		port_open "$port" && return 0
		sleep 1
	done
	echo "dev-stack: $label did not answer on $port within ${tries}s" >&2
	echo "dev-stack: last lines of $STATE/$label.log" >&2
	tail -n 20 "$STATE/$label.log" >&2 2>/dev/null || true
	return 1
}

stop_group() {
	local name=$1
	running "$name" || return 0
	local pid pgid
	pid=$(cat "$STATE/$name.pid")
	pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
	if [ -n "$pgid" ]; then
		kill -TERM -"$pgid" 2>/dev/null || true
		for _ in $(seq 10); do
			kill -0 "$pid" 2>/dev/null || break
			sleep 1
		done
		kill -KILL -"$pgid" 2>/dev/null || true
	fi
	rm -f "$STATE/$name.pid"
	echo "dev-stack: stopped $name"
}

# Point the claim dirs at the process that now actually holds the ports: the
# allocator could only record the caller at claim time, and a claim is meant
# to live exactly as long as the stack. A claim that vanished under us (dead
# pid reclaimed mid-boot) is simply left alone.
adopt_claims() {
	local pid=$1
	shift
	local port
	for port in "$@"; do
		if [ -d "$REG/$port" ]; then
			echo "$pid" >"$REG/$port/pid"
		fi
	done
}

# The emulators read a generated copy of the committed firebase.json with only
# the `emulators` block rebuilt on the allocated ports. Everything above that
# block is spliced through byte for byte — jq would happily reflow the rest,
# and "the functions predeploy came along untouched" must not depend on a
# formatter's idea of where a short array breaks.
generate_firebase_config() {
	local ports_json=$1 out=$2
	awk '/^\t"emulators": \{/{exit} {print}' firebase.json >"$out"
	jq -n --argjson p "$ports_json" --tab '
		{
			ui: {enabled: true, port: $p.ui},
			auth: {port: $p.auth},
			firestore: {port: $p.firestore},
			storage: {port: $p.storage},
			functions: {port: $p.functions},
			hub: {port: $p.hub},
			logging: {port: $p.logging},
			singleProjectMode: true
		}' | sed -e '1s/^/	"emulators": /' -e '2,$s/^/\t/' >>"$out"
	echo "}" >>"$out"
	jq empty "$out" || {
		echo "dev-stack: generated $out does not parse" >&2
		exit 1
	}
}

cmd_up() {
	local web=1 import=1
	for arg in "$@"; do
		case "$arg" in
		--no-web) web=0 ;;
		--fresh) import=0 ;;
		*)
			echo "dev-stack: unknown option $arg" >&2
			exit 2
			;;
		esac
	done

	local ports_json=""
	if running emulators; then
		echo "dev-stack: emulators already up (ours)"
	else
		# A web that outlived its emulators is stopped here, before the rewrite
		# below drops .pids.web: its bundle points at the old, now-dead ports.
		stop_group web
		# `--import` will not create the directory, so a missing fixture fails
		# here rather than silently booting empty.
		if [ "$import" = 1 ] && [ ! -d .emulator-seed ]; then
			echo "dev-stack: .emulator-seed is missing; recover with 'scripts/dev-stack.sh up --fresh' then 'scripts/dev-stack.sh export'" >&2
			exit 1
		fi
		echo "dev-stack: allocating ports"
		ports_json=$(node scripts/alloc-ports.mjs alloc ui auth firestore storage functions hub logging)
		local firestore_port
		firestore_port=$(jq -r .firestore <<<"$ports_json")

		generate_firebase_config "$ports_json" "$GENERATED_CONFIG"

		local target="emulators"
		if [ "$import" = 1 ]; then
			target="emulators:seed"
		fi
		echo "dev-stack: starting emulators ($target on :$firestore_port)"
		# The CLI writes its hub locator to $TMPDIR/hub-<projectId>.json, so the
		# shared /tmp makes the last booted worktree's stack the one every bare
		# `firebase` command resolves to. A per-worktree TMPDIR gives this stack
		# a locator of its own — same trick as scripts/test-rules.mjs — and the
		# CLI does not create the directory itself.
		mkdir -p "$STATE/tmp"
		local start_cmd="yarn --cwd functions build && firebase emulators:start --project home-backlog --config '$GENERATED_CONFIG'"
		if [ "$import" = 1 ]; then
			start_cmd+=" --import .emulator-seed"
		fi
		start_bg emulators env \
			TMPDIR="$PWD/$STATE/tmp" TMP="$PWD/$STATE/tmp" TEMP="$PWD/$STATE/tmp" \
			bash -c "$start_cmd"
		wait_for_port "$firestore_port" emulators

		local emu_pid
		emu_pid=$(cat "$STATE/emulators.pid")
		jq -n --argjson ports "$ports_json" --argjson pid "$emu_pid" \
			'{ports: $ports, pids: {emulators: $pid}}' >"$STATE/stack.json"
		adopt_claims "$emu_pid" $(jq -r 'to_entries[] | .value' <<<"$ports_json")
		echo "dev-stack: emulators up"
	fi

	[ "$web" = 1 ] || return 0

	if running web; then
		echo "dev-stack: web already up (ours)"
		return 0
	fi

	# Either the stack was booted with --no-web, or a previous web died: either
	# way no live web exists here. Drop any stale web record — its claim may
	# have been reclaimed while it was gone — and claim a fresh port.
	ports_json=$(node scripts/alloc-ports.mjs alloc web)
	jq 'del(.ports.web, .pids.web)' "$STATE/stack.json" >"$STATE/stack.json.tmp"
	mv "$STATE/stack.json.tmp" "$STATE/stack.json"
	jq --argjson port "$(jq -r .web <<<"$ports_json")" \
		'.ports.web = $port' "$STATE/stack.json" >"$STATE/stack.json.tmp"
	mv "$STATE/stack.json.tmp" "$STATE/stack.json"
	local web_port
	web_port=$(jq -r '.ports.web' "$STATE/stack.json")

	echo "dev-stack: starting web on :$web_port"
	start_bg web env \
		"EXPO_PUBLIC_EMULATOR_AUTH=$(jq -r '.ports.auth' "$STATE/stack.json")" \
		"EXPO_PUBLIC_EMULATOR_FIRESTORE=$(jq -r '.ports.firestore' "$STATE/stack.json")" \
		"EXPO_PUBLIC_EMULATOR_STORAGE=$(jq -r '.ports.storage' "$STATE/stack.json")" \
		"EXPO_PUBLIC_EMULATOR_FUNCTIONS=$(jq -r '.ports.functions' "$STATE/stack.json")" \
		yarn web --port "$web_port"
	wait_for_port "$web_port" web

	local web_pid
	web_pid=$(cat "$STATE/web.pid")
	adopt_claims "$web_pid" "$web_port"
	jq --argjson pid "$web_pid" '.pids.web = $pid' "$STATE/stack.json" >"$STATE/stack.json.tmp"
	mv "$STATE/stack.json.tmp" "$STATE/stack.json"
	echo "dev-stack: web up at http://localhost:$web_port"
}

cmd_down() {
	stop_group web
	stop_group emulators

	if [ ! -f "$STATE/stack.json" ]; then
		echo "dev-stack: nothing was started here (no stack state)"
		return 0
	fi

	# Free the claims this stack holds. A claim is only removed while it still
	# names one of our recorded pids — if our stack crashed and its ports were
	# reclaimed by another worktree, their claim is theirs.
	local svc port key claim_pid
	while read -r svc port; do
		key=emulators
		if [ "$svc" = web ]; then
			key=web
		fi
		if [ ! -d "$REG/$port" ]; then
			continue
		fi
		claim_pid=$(cat "$REG/$port/pid" 2>/dev/null || true)
		if [ "$claim_pid" = "$(jq -r --arg k "$key" '.pids[$k] // 0' "$STATE/stack.json")" ]; then
			rm -rf "$REG/$port"
		fi
	done < <(jq -r '.ports | to_entries[] | "\(.key) \(.value)"' "$STATE/stack.json")

	# A silent orphan poisons the next run, so the ports are checked rather than
	# assumed. Anything still listening was not ours, and is left alone.
	local leftover=() port_number
	for port_number in $(jq -r '.ports | to_entries[] | .value' "$STATE/stack.json"); do
		port_open "$port_number" && leftover+=("$port_number")
	done
	if [ ${#leftover[@]} -gt 0 ]; then
		echo "dev-stack: still listening (not started by us): ${leftover[*]}"
	else
		echo "dev-stack: all ports clear"
	fi
	rm -f "$STATE/stack.json"
}

cmd_status() {
	if [ ! -f "$STATE/stack.json" ]; then
		echo "dev-stack: nothing running (this worktree has no stack state)"
		return 0
	fi
	local svc port pid owner any=0
	while read -r svc port; do
		pid=$(jq -r --arg s "$svc" \
			'(if $s == "web" then .pids.web else .pids.emulators end) // 0' "$STATE/stack.json")
		owner="external"
		if [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; then
			owner="ours"
		fi
		if port_open "$port"; then
			any=1
			echo "  $port  listening  ($owner)  $svc"
		else
			echo "  $port  free  $svc"
		fi
	done < <(jq -r '.ports | to_entries[] | "\(.key) \(.value)"' "$STATE/stack.json")
	[ "$any" = 1 ] || echo "dev-stack: nothing running"
}

cmd_export() {
	if [ ! -f "$STATE/stack.json" ] || ! running emulators; then
		echo "dev-stack: no running stack here — run 'scripts/dev-stack.sh up' first" >&2
		exit 1
	fi
	# Export goes to this stack's own hub port from stack.json — no project-id
	# discovery, which is how an export once attached to a foreign stack on the
	# same project. The hub resolves the path against its own cwd, so it is sent
	# absolute. `curl -f` catches a 5xx (the hub answers 500 with a JSON message
	# on failure), and the body check rejects any 200 that is not the hub's
	# `{message: "OK"}`.
	local hub seed
	hub=$(jq -r '.ports.hub' "$STATE/stack.json")
	seed="$PWD/.emulator-seed"
	if ! jq -n --arg p "$seed" '{path: $p}' |
		curl -fsS -X POST "localhost:$hub/_admin/export" \
			-H "Content-Type: application/json" \
			-d @- | jq -e '.message == "OK"' >/dev/null; then
		echo "dev-stack: export to $seed failed — hub on :$hub did not export (see error above)" >&2
		exit 1
	fi
	echo "dev-stack: exported .emulator-seed"
}

case "${1:-}" in
up)
	shift
	cmd_up "$@"
	;;
down) cmd_down ;;
status) cmd_status ;;
export) cmd_export ;;
*)
	echo "usage: scripts/dev-stack.sh up [--no-web] [--fresh] | down | status | export" >&2
	exit 2
	;;
esac
