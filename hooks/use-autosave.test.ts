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

async function autosave(stored = "") {
	const save = jest.fn();
	const view = await renderHook(() => useAutosave(stored, save));

	const type = async (text: string) => {
		await act(() => view.result.current.onChangeText(text));
	};
	const pause = async () => {
		await act(() => {
			jest.advanceTimersByTime(typingPauseMs);
		});
	};

	return { save, view, type, pause };
}

describe("useAutosave", () => {
	it("shows the stored value until the first keystroke", async () => {
		const { view, type } = await autosave("Ladder is in the shed");

		expect(view.result.current.value).toBe("Ladder is in the shed");
		await type("Ladder is in the garage");
		expect(view.result.current.value).toBe("Ladder is in the garage");
	});

	it("writes once, after the typing stops", async () => {
		const { save, type, pause } = await autosave();

		await type("Sweep");
		await type("Sweep sa");
		await type("Sweep said 2027");
		expect(save).not.toHaveBeenCalled();

		await pause();

		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith("Sweep said 2027");
	});

	it("does not write in the middle of a word", async () => {
		const { save, type } = await autosave();

		await type("Sweep");
		await act(() => {
			jest.advanceTimersByTime(typingPauseMs - 1);
		});
		await type("Sweep said");
		await act(() => {
			jest.advanceTimersByTime(typingPauseMs - 1);
		});

		expect(save).not.toHaveBeenCalled();
	});

	it("writes on blur without waiting for the pause", async () => {
		const { save, view, type } = await autosave();

		await type("Key is under the pot");
		await act(() => view.result.current.onBlur());

		expect(save).toHaveBeenCalledWith("Key is under the pot");
	});

	/**
	 * The trigger the other three do not cover. Blur alone loses text: whether it
	 * fires before the screen unmounts on a back-arrow tap is a platform detail,
	 * not a guarantee.
	 */
	it("writes what is outstanding when the screen goes away", async () => {
		const { save, view, type } = await autosave();

		await type("Chimney swept in March");
		await view.unmount();

		expect(save).toHaveBeenCalledWith("Chimney swept in March");
	});

	it("writes on the app going to background", async () => {
		const { save, view, type } = await autosave();

		await type("Paint is Falu red");
		await act(() => view.result.current.flush());

		expect(save).toHaveBeenCalledWith("Paint is Falu red");
	});

	it("does not write the same text twice, however many triggers fire", async () => {
		const { save, view, type, pause } = await autosave();

		await type("Once");
		await pause();
		await act(() => view.result.current.onBlur());
		await act(() => view.result.current.flush());
		await view.unmount();

		expect(save).toHaveBeenCalledTimes(1);
	});

	it("writes nothing at all for a field nobody touched", async () => {
		const { save, view } = await autosave("Ladder is in the shed");

		await act(() => view.result.current.onBlur());
		await view.unmount();

		expect(save).not.toHaveBeenCalled();
	});

	it("writes again once there is something new to write", async () => {
		const { save, view, type } = await autosave();

		await type("First");
		await act(() => view.result.current.onBlur());
		await type("First, then second");
		await act(() => view.result.current.onBlur());

		expect(save).toHaveBeenCalledTimes(2);
		expect(save).toHaveBeenLastCalledWith("First, then second");
	});

	/**
	 * Silence reads as "did not take" to anyone who has pressed Save on every
	 * device they have owned, so the line under the field only appears once
	 * something really has been written.
	 */
	it("reports when it wrote, and not before", async () => {
		const { view, type, pause } = await autosave();

		expect(view.result.current.savedAt).toBeNull();

		await type("Something");
		await pause();

		expect(view.result.current.savedAt).toBeInstanceOf(Date);
	});
});
