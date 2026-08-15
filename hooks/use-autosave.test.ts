import { act, renderHook } from "@testing-library/react-native";
import { typingPauseMs, useAutosave } from "@/hooks/use-autosave";

/**
 * The failure this hook exists to prevent has no error message: somebody types
 * a note, leaves, and the text is simply not there next time. So every trigger
 * is tested on its own, and so is the case where one of them fires twice.
 */
beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

function autosave(stored = "") {
	const save = jest.fn();
	const view = renderHook(() => useAutosave(stored, save));

	const type = (text: string) => {
		act(() => view.result.current.onChangeText(text));
	};
	const pause = () => {
		act(() => {
			jest.advanceTimersByTime(typingPauseMs);
		});
	};

	return { save, view, type, pause };
}

describe("useAutosave", () => {
	it("shows the stored value until the first keystroke", () => {
		const { view, type } = autosave("Ladder is in the shed");

		expect(view.result.current.value).toBe("Ladder is in the shed");
		type("Ladder is in the garage");
		expect(view.result.current.value).toBe("Ladder is in the garage");
	});

	it("writes once, after the typing stops", () => {
		const { save, type, pause } = autosave();

		type("Sweep");
		type("Sweep sa");
		type("Sweep said 2027");
		expect(save).not.toHaveBeenCalled();

		pause();

		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith("Sweep said 2027");
	});

	it("does not write in the middle of a word", () => {
		const { save, type } = autosave();

		type("Sweep");
		act(() => {
			jest.advanceTimersByTime(typingPauseMs - 1);
		});
		type("Sweep said");
		act(() => {
			jest.advanceTimersByTime(typingPauseMs - 1);
		});

		expect(save).not.toHaveBeenCalled();
	});

	it("writes on blur without waiting for the pause", () => {
		const { save, view, type } = autosave();

		type("Key is under the pot");
		act(() => view.result.current.onBlur());

		expect(save).toHaveBeenCalledWith("Key is under the pot");
	});

	/**
	 * The trigger the other three do not cover. Blur alone loses text: whether it
	 * fires before the screen unmounts on a back-arrow tap is a platform detail,
	 * not a guarantee.
	 */
	it("writes what is outstanding when the screen goes away", () => {
		const { save, view, type } = autosave();

		type("Chimney swept in March");
		view.unmount();

		expect(save).toHaveBeenCalledWith("Chimney swept in March");
	});

	it("writes on the app going to background", () => {
		const { save, view, type } = autosave();

		type("Paint is Falu red");
		act(() => view.result.current.flush());

		expect(save).toHaveBeenCalledWith("Paint is Falu red");
	});

	it("does not write the same text twice, however many triggers fire", () => {
		const { save, view, type, pause } = autosave();

		type("Once");
		pause();
		act(() => view.result.current.onBlur());
		act(() => view.result.current.flush());
		view.unmount();

		expect(save).toHaveBeenCalledTimes(1);
	});

	it("writes nothing at all for a field nobody touched", () => {
		const { save, view } = autosave("Ladder is in the shed");

		act(() => view.result.current.onBlur());
		view.unmount();

		expect(save).not.toHaveBeenCalled();
	});

	it("writes again once there is something new to write", () => {
		const { save, view, type } = autosave();

		type("First");
		act(() => view.result.current.onBlur());
		type("First, then second");
		act(() => view.result.current.onBlur());

		expect(save).toHaveBeenCalledTimes(2);
		expect(save).toHaveBeenLastCalledWith("First, then second");
	});

	/**
	 * Silence reads as "did not take" to anyone who has pressed Save on every
	 * device they have owned, so the line under the field only appears once
	 * something really has been written.
	 */
	it("reports when it wrote, and not before", () => {
		const { view, type, pause } = autosave();

		expect(view.result.current.savedAt).toBeNull();

		type("Something");
		pause();

		expect(view.result.current.savedAt).toBeInstanceOf(Date);
	});
});
