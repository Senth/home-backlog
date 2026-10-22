import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import {
	type CheckItem,
	CheckListPicker,
} from "@/components/ui/CheckListPicker";
import { lightTheme } from "@/theme";
import { radius } from "@/theme/tokens";

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — `LabelPicker.test.tsx` for the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

const item = (id: string, title = `Item ${id}`): CheckItem => ({ id, title });

async function renderPicker(
	items: CheckItem[],
	value: string[],
	onChange = jest.fn(),
	onDismiss = jest.fn(),
) {
	return await render(
		<Provider theme={lightTheme}>
			<CheckListPicker
				onDismiss={onDismiss}
				testID="check-picker"
				searchLabel="search"
				items={items}
				value={value}
				onChange={onChange}
			/>
		</Provider>,
	);
}

describe("CheckListPicker", () => {
	it("lists the items and marks the checked ones", async () => {
		await renderPicker([item("a"), item("b")], ["b"]);

		expect(
			screen.getByRole("checkbox", { name: "Item a" }).props.accessibilityState,
		).toMatchObject({ checked: false });
		expect(
			screen.getByRole("checkbox", { name: "Item b" }).props.accessibilityState,
		).toMatchObject({ checked: true });
	});

	it("folds the search, so Trädgård is found from trad", async () => {
		await renderPicker([item("a", "Trädgård"), item("b", "Garden")], []);

		await fireEvent.changeText(
			screen.getByTestId("check-picker-search"),
			"trad",
		);

		expect(
			screen.getByRole("checkbox", { name: "Trädgård" }),
		).toBeOnTheScreen();
		expect(screen.queryByRole("checkbox", { name: "Garden" })).toBeNull();
	});

	it("hands the toggle to onChange as the whole next selection", async () => {
		const onChange = jest.fn();
		await renderPicker([item("a"), item("b")], ["a"], onChange);

		await fireEvent.press(screen.getByLabelText("Item b"));

		expect(onChange).toHaveBeenCalledWith(["a", "b"]);
	});

	it("Clear empties the selection without dismissing", async () => {
		const onChange = jest.fn();
		const onDismiss = jest.fn();
		await renderPicker([item("a"), item("b")], ["a", "b"], onChange, onDismiss);

		await fireEvent.press(screen.getByText("common.clear"));

		expect(onChange).toHaveBeenCalledWith([]);
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("Done dismisses", async () => {
		const onDismiss = jest.fn();
		await renderPicker([item("a")], [], jest.fn(), onDismiss);

		await fireEvent.press(screen.getByText("common.done"));

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("keeps a caller's disabled rows untickable", async () => {
		await render(
			<Provider theme={lightTheme}>
				<CheckListPicker
					onDismiss={() => {}}
					testID="check-picker"
					searchLabel="search"
					items={[item("a"), item("b")]}
					value={["a"]}
					onChange={() => {}}
					disabled={(each) => each.id === "b"}
				/>
			</Provider>,
		);

		expect(
			screen.getByRole("checkbox", { name: "Item b" }).props.accessibilityState,
		).toMatchObject({ disabled: true });
	});

	it("says when the list is empty and when the search matches nothing", async () => {
		const { rerender } = await render(
			<Provider theme={lightTheme}>
				<CheckListPicker
					onDismiss={() => {}}
					testID="check-picker"
					searchLabel="search"
					items={[]}
					value={[]}
					onChange={() => {}}
					emptySentence="empty-sentence"
					searchEmptySentence="search-empty-sentence"
				/>
			</Provider>,
		);

		expect(screen.getByText("empty-sentence")).toBeOnTheScreen();
		expect(screen.queryByText("search-empty-sentence")).toBeNull();

		await rerender(
			<Provider theme={lightTheme}>
				<CheckListPicker
					onDismiss={() => {}}
					testID="check-picker"
					searchLabel="search"
					items={[item("a")]}
					value={[]}
					onChange={() => {}}
					emptySentence="empty-sentence"
					searchEmptySentence="search-empty-sentence"
				/>
			</Provider>,
		);
		await fireEvent.changeText(
			screen.getByTestId("check-picker-search"),
			"nope",
		);

		expect(screen.getByText("search-empty-sentence")).toBeOnTheScreen();
		expect(screen.queryByText("empty-sentence")).toBeNull();
	});

	it("a picker without fill still draws its checkboxes", async () => {
		await renderPicker([item("a"), item("b")], ["b"]);

		expect(
			screen.getAllByTestId("checkbox-marked", {
				includeHiddenElements: true,
			}),
		).toHaveLength(1);
		expect(
			screen.getAllByTestId("checkbox-blank-outline", {
				includeHiddenElements: true,
			}),
		).toHaveLength(1);
	});

	it("fill draws the selection as the fill, not a checkbox, and keeps the checkbox state", async () => {
		const onChange = jest.fn();
		await render(
			<Provider theme={lightTheme}>
				<CheckListPicker
					onDismiss={() => {}}
					testID="check-picker"
					searchLabel="search"
					items={[item("a"), item("b")]}
					value={["a"]}
					onChange={onChange}
					fill
				/>
			</Provider>,
		);

		const selected = screen.getByRole("checkbox", { name: "Item a" });
		expect(selected.props.accessibilityState).toMatchObject({ checked: true });
		expect(selected.props.style).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					backgroundColor: lightTheme.colors.secondaryContainer,
					borderRadius: radius.sm,
				}),
			]),
		);
		// Paper composes the label's style as nested arrays; flatten and look
		// for the fill treatment the row's own style carries.
		expect(
			screen.getByText("Item a").props.style.flat(Infinity),
		).toContainEqual(
			expect.objectContaining({
				color: lightTheme.colors.onSecondaryContainer,
				fontWeight: "500",
			}),
		);

		// No tick drawn on any row: the fill and the a11y state are the only
		// selected signals, and both are asserted above.
		expect(
			screen.queryAllByTestId("checkbox-marked", {
				includeHiddenElements: true,
			}),
		).toHaveLength(0);
		expect(
			screen.queryAllByTestId("checkbox-blank-outline", {
				includeHiddenElements: true,
			}),
		).toHaveLength(0);

		// Still a multi-select: the next pick joins the selection.
		await fireEvent.press(screen.getByLabelText("Item b"));
		expect(onChange).toHaveBeenCalledWith(["a", "b"]);
	});
});
