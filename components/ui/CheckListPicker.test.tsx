import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import {
	type CheckItem,
	CheckListPicker,
} from "@/components/ui/CheckListPicker";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — `LabelPicker.test.tsx` for the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

const item = (id: string, title = `Item ${id}`): CheckItem => ({ id, title });

function renderPicker(
	items: CheckItem[],
	value: string[],
	onChange = jest.fn(),
	onDismiss = jest.fn(),
) {
	return render(
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
	it("lists the items and marks the checked ones", () => {
		renderPicker([item("a"), item("b")], ["b"]);

		expect(
			screen.getByRole("checkbox", { name: "Item a" }).props.accessibilityState,
		).toMatchObject({ checked: false });
		expect(
			screen.getByRole("checkbox", { name: "Item b" }).props.accessibilityState,
		).toMatchObject({ checked: true });
	});

	it("folds the search, so Trädgård is found from trad", () => {
		renderPicker([item("a", "Trädgård"), item("b", "Garden")], []);

		fireEvent.changeText(screen.getByTestId("check-picker-search"), "trad");

		expect(
			screen.getByRole("checkbox", { name: "Trädgård" }),
		).toBeOnTheScreen();
		expect(screen.queryByRole("checkbox", { name: "Garden" })).toBeNull();
	});

	it("hands the toggle to onChange as the whole next selection", () => {
		const onChange = jest.fn();
		renderPicker([item("a"), item("b")], ["a"], onChange);

		fireEvent.press(screen.getByLabelText("Item b"));

		expect(onChange).toHaveBeenCalledWith(["a", "b"]);
	});

	it("Clear empties the selection without dismissing", () => {
		const onChange = jest.fn();
		const onDismiss = jest.fn();
		renderPicker([item("a"), item("b")], ["a", "b"], onChange, onDismiss);

		fireEvent.press(screen.getByText("common.clear"));

		expect(onChange).toHaveBeenCalledWith([]);
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("Done dismisses", () => {
		const onDismiss = jest.fn();
		renderPicker([item("a")], [], jest.fn(), onDismiss);

		fireEvent.press(screen.getByText("common.done"));

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("keeps a caller's disabled rows untickable", () => {
		render(
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

	it("says when the list is empty and when the search matches nothing", () => {
		const { rerender } = render(
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

		rerender(
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
		fireEvent.changeText(screen.getByTestId("check-picker-search"), "nope");

		expect(screen.getByText("search-empty-sentence")).toBeOnTheScreen();
		expect(screen.queryByText("empty-sentence")).toBeNull();
	});
});
