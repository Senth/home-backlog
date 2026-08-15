import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A text field that saves itself, because there is no Save button to fail to
 * press.
 *
 * **Blur alone loses text.** Somebody types what the chimney sweep said, taps
 * the app-bar back arrow, and the screen unmounts; whether blur fires first is a
 * platform detail, not a guarantee. There is no warning and no snackbar in that
 * case — they simply conclude the app does not keep things, and do not report
 * it. So the write happens on a pause in typing, on blur *and* on unmount, and
 * the caller adds the fourth trigger, the app going to background.
 *
 * The `savedAt` line matters as much as the writes: a write that succeeds says
 * nothing, and silence reads as "did not take" to anyone who has pressed Save on
 * every device they have owned. It reports the *local* write, which is durable
 * immediately — `OfflineBar` says the rest, and nothing here blocks on the
 * server.
 */
export interface Autosave {
	/** What the field shows. */
	value: string;
	onChangeText: (next: string) => void;
	/** Hand this to the field's `onBlur`. */
	onBlur: () => void;
	/** Write whatever is outstanding now — the background trigger's way in. */
	flush: () => void;
	/** When the last local write happened, or null if nothing has been written. */
	savedAt: Date | null;
}

/** Long enough not to write on every keystroke, short enough to beat a tap away. */
export const typingPauseMs = 800;

export function useAutosave(
	stored: string,
	save: (value: string) => void,
	pauseMs: number = typingPauseMs,
): Autosave {
	// Uncontrolled until the first keystroke, so an edit by another member
	// arrives on the listener — but never overwrites what is being typed. The
	// two-person case is ordinary, not exotic.
	const [draft, setDraft] = useState<string | null>(null);
	const [savedAt, setSavedAt] = useState<Date | null>(null);

	// Refs, not state: the unmount cleanup runs with whatever these hold at that
	// moment, where a closure over state would carry the value from the render
	// that registered it — which is exactly the text that would be lost.
	const pending = useRef<string | null>(null);
	const written = useRef(stored);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveRef = useRef(save);

	useEffect(() => {
		saveRef.current = save;
	});

	const flush = useCallback(() => {
		if (timer.current !== null) {
			clearTimeout(timer.current);
			timer.current = null;
		}

		const next = pending.current;
		// Nothing typed, or nothing new: a write that changes nothing still costs
		// a document write and still moves `updatedAt`, which #55 reads.
		if (next === null || next === written.current) return;

		written.current = next;
		saveRef.current(next);
		setSavedAt(new Date());
	}, []);

	const onChangeText = useCallback(
		(next: string) => {
			setDraft(next);
			pending.current = next;

			if (timer.current !== null) clearTimeout(timer.current);
			timer.current = setTimeout(flush, pauseMs);
		},
		[flush, pauseMs],
	);

	// The unmount trigger. Deliberately not keyed on anything: it must run when
	// the screen goes away, which is the case blur does not cover.
	useEffect(() => flush, [flush]);

	return {
		value: draft ?? stored,
		onChangeText,
		onBlur: flush,
		flush,
		savedAt,
	};
}
