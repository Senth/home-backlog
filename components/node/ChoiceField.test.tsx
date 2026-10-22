import {
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react-native";
import { View } from "react-native";
import { Provider } from "react-native-paper";
import { ChoiceField } from "@/components/node/ChoiceField";
import { lightTheme } from "@/theme";

type Level = "low" | "normal" | "high" | "urgent";

const values: readonly Level[] = ["low", "normal", "high", "urgent"];

const labels: Record<Level, string> = {
	low: "Low",
	normal: "Normal",
	high: "High",
	urgent: "Urgent",
};

const labelFor = (value: Level) => labels[value];

async function renderChoiceField(
	props: Partial<Parameters<typeof ChoiceField<Level>>[0]> = {},
) {
	return await render(
		// `Provider`, not `ThemeProvider`: this is the same host the sheet's
		// other fields' tests use — see `NotesField.test.tsx`.
		<Provider theme={lightTheme}>
			<ChoiceField<Level>
				label="Field"
				value={null}
				values={values}
				labelFor={labelFor}
				onChange={() => {}}
				{...props}
			/>
		</Provider>,
	);
}

describe("ChoiceField", () => {
	it("renders the values as rows in the given order", async () => {
		await renderChoiceField();

		const texts = screen.getAllByText(/.+/).map((t) => t.props.children);
		expect(texts).toEqual(["Field", "Low", "Normal", "High", "Urgent"]);
	});

	it("tapping an unselected row offers that value", async () => {
		const onChange = jest.fn();
		await renderChoiceField({ value: "high", onChange });

		await fireEvent.press(screen.getByText("Normal"));

		expect(onChange).toHaveBeenCalledWith("normal");
	});

	it("shows every description inside its selectable row", async () => {
		const onChange = jest.fn();
		await renderChoiceField({
			value: "high",
			onChange,
			descriptionFor: (value) => `${labels[value]} description`,
		});

		for (const value of values) {
			const row = screen.getByRole("button", {
				name: new RegExp(`^${labels[value]}`),
			});
			const description = within(row).getByText(`${labels[value]} description`);
			await fireEvent.press(description);
			expect(onChange).toHaveBeenLastCalledWith(
				value === "high" ? null : value,
			);
		}
	});

	it("tapping the selected row clears it", async () => {
		const onChange = jest.fn();
		await renderChoiceField({ value: "high", onChange });

		await fireEvent.press(screen.getByText("High"));

		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("the selected row reports aria-pressed, and only it", async () => {
		await renderChoiceField({ value: "high" });

		const pressed = screen
			.getAllByRole("button")
			.map((row) => row.props["aria-pressed"]);
		expect(pressed).toEqual([false, false, true, false]);
	});

	it("renders the adornment once per row when supplied", async () => {
		await renderChoiceField({
			adornment: (value) => <View testID={`adornment-${value}`} />,
		});

		for (const value of values) {
			expect(screen.getAllByTestId(`adornment-${value}`)).toHaveLength(1);
		}
	});

	it("renders no adornment when omitted", async () => {
		await renderChoiceField();

		expect(screen.queryAllByTestId(/adornment-/)).toHaveLength(0);
	});

	it("tapping the selected row does nothing when not clearable", async () => {
		const onChange = jest.fn();
		await renderChoiceField({ value: "high", onChange, clearable: false });

		await fireEvent.press(screen.getByText("High"));

		expect(onChange).not.toHaveBeenCalled();
	});

	it("draws the not-set row above the values when given a label", async () => {
		await renderChoiceField({ notSetLabel: "Not set" });

		const texts = screen.getAllByText(/.+/).map((t) => t.props.children);
		expect(texts).toEqual([
			"Field",
			"Not set",
			"Low",
			"Normal",
			"High",
			"Urgent",
		]);
	});

	it("the not-set row is the selected one while the value is null", async () => {
		await renderChoiceField({ notSetLabel: "Not set" });

		const pressed = screen
			.getAllByRole("button")
			.map((row) => row.props["aria-pressed"]);
		expect(pressed).toEqual([true, false, false, false, false]);
	});

	it("tapping the not-set row clears the value", async () => {
		const onChange = jest.fn();
		await renderChoiceField({
			value: "high",
			notSetLabel: "Not set",
			onChange,
		});

		await fireEvent.press(screen.getByText("Not set"));

		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("tapping the already-selected not-set row does nothing", async () => {
		const onChange = jest.fn();
		await renderChoiceField({ value: null, notSetLabel: "Not set", onChange });

		await fireEvent.press(screen.getByText("Not set"));

		expect(onChange).not.toHaveBeenCalled();
	});
});
