#!/usr/bin/env bash
#
# The local stack — Firebase emulators plus the Expo web dev server — brought up
# and torn down by one owner instead of by every caller that needs it.
#
# Three callers share it: you, `playwright.config.ts` (which points its
# `webServer` here), and the `/review` skill. Each of them used to know how to
# boot a stack and, more importantly, how to kill one. That knowledge is now in
# one file, along with the two traps that cost real time to find:
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
# `up` is idempotent, and deliberately asymmetric with `down`: a port that is
# already listening is left completely alone, and `down` only ever stops what
# this script started. Reusing a stack you did not start is normal — it is your
# `yarn emulators` in another terminal — but it means the data in it is whatever
# that session left there, not the committed fixture. `status` says which case
# you are in, and `/review` reports it, because a review run against a
# non-pristine emulator has seen different data than the next one will.
#
# Usage:
#   scripts/dev-stack.sh up [--no-web] [--fresh]
#   scripts/dev-stack.sh down
#   scripts/dev-stack.sh status
#
#   --no-web   emulators only; for rules tests and for seeding
#   --fresh    boot the emulators empty rather than importing .emulator-seed

set -euo pipefail

cd "$(dirname "$0")/.."

STATE=".tmp/dev-stack"
mkdir -p "$STATE"

# The emulator ports come from `firebase.json`; 8081 is Expo's web default.
# Offset from the sibling project's 8050-8052 so both suites can run at once.
EMULATOR_PORTS=(8060 8061 8062 8063 8064)
FIRESTORE_PORT=8062
WEB_PORT=8081

# `nc` is not installed here, and /dev/tcp is a bash feature that the default
# zsh does not have — hence the explicit `bash -c` even though this is a bash
# script, since the redirect is what does the probing.
port_open() { timeout 1 bash -c "</dev/tcp/localhost/$1" 2>/dev/null; }

started_by_us() { [ -f "$STATE/$1.pid" ] && kill -0 "$(cat "$STATE/$1.pid")" 2>/dev/null; }

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
	started_by_us "$name" || return 0
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

	if port_open "$FIRESTORE_PORT"; then
		if started_by_us emulators; then
			echo "dev-stack: emulators already up (ours)"
		else
			echo "dev-stack: emulators already up (not ours — data is whatever that session left)"
		fi
	else
		# `emulators:seed` imports .emulator-seed, which is the committed review
		# fixture. `--import` will not create the directory, so a missing fixture
		# fails here rather than silently booting empty.
		if [ "$import" = 1 ] && [ ! -d .emulator-seed ]; then
			echo "dev-stack: .emulator-seed is missing; recover with 'scripts/dev-stack.sh up --fresh' then 'yarn emulators:export'" >&2
			exit 1
		fi
		local target=emulators:seed
		[ "$import" = 1 ] || target=emulators
		echo "dev-stack: starting emulators ($target)"
		start_bg emulators yarn "$target"
		wait_for_port "$FIRESTORE_PORT" emulators
		echo "dev-stack: emulators up"
	fi

	[ "$web" = 1 ] || return 0

	if port_open "$WEB_PORT"; then
		if started_by_us web; then
			echo "dev-stack: web already up (ours)"
		else
			echo "dev-stack: web already up (not ours)"
		fi
	else
		echo "dev-stack: starting web"
		start_bg web yarn web
		wait_for_port "$WEB_PORT" web
		echo "dev-stack: web up at http://localhost:$WEB_PORT"
	fi
}

cmd_down() {
	stop_group web
	stop_group emulators

	# A silent orphan poisons the next run, so the ports are checked rather than
	# assumed. Anything still listening was not ours, and is left alone.
	local leftover=()
	for port in "${EMULATOR_PORTS[@]}" "$WEB_PORT"; do
		port_open "$port" && leftover+=("$port")
	done
	if [ ${#leftover[@]} -gt 0 ]; then
		echo "dev-stack: still listening (not started by us): ${leftover[*]}"
	else
		echo "dev-stack: all ports clear"
	fi
}

cmd_status() {
	# Ownership is per *service*, not per port: one `firebase emulators:start`
	# owns all five emulator ports, so asking about 8061 alone would report the
	# suite we started as somebody else's.
	local emu_owner="external" web_owner="external" any=0
	started_by_us emulators && emu_owner="ours"
	started_by_us web && web_owner="ours"

	for port in "${EMULATOR_PORTS[@]}"; do
		if port_open "$port"; then
			any=1
			echo "  $port  listening  ($emu_owner)  emulators"
		else
			echo "  $port  free"
		fi
	done
	if port_open "$WEB_PORT"; then
		any=1
		echo "  $WEB_PORT  listening  ($web_owner)  web"
	else
		echo "  $WEB_PORT  free"
	fi
	[ "$any" = 1 ] || echo "dev-stack: nothing running"
}

case "${1:-}" in
up)
	shift
	cmd_up "$@"
	;;
down) cmd_down ;;
status) cmd_status ;;
*)
	echo "usage: scripts/dev-stack.sh up [--no-web] [--fresh] | down | status" >&2
	exit 2
	;;
esac
