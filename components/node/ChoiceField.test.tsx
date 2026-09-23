import { fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native";
import { Provider, Text } from "react-native-paper";
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

function renderChoiceField(
	props: Partial<Parameters<typeof ChoiceField<Level>>[0]> = {},
) {
	return render(
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
	it("renders the values as rows in the given order", () => {
		renderChoiceField();

		const texts = screen.UNSAFE_getAllByType(Text).map((t) => t.props.children);
		expect(texts).toEqual(["Field", "Low", "Normal", "High", "Urgent"]);
	});

	it("tapping an unselected row offers that value", () => {
		const onChange = jest.fn();
		renderChoiceField({ value: "high", onChange });

		fireEvent.press(screen.getByText("Normal"));

		expect(onChange).toHaveBeenCalledWith("normal");
	});

	it("tapping the selected row clears it", () => {
		const onChange = jest.fn();
		renderChoiceField({ value: "high", onChange });

		fireEvent.press(screen.getByText("High"));

		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("the selected row reports aria-pressed, and only it", () => {
		renderChoiceField({ value: "high" });

		const pressed = screen
			.getAllByRole("button")
			.map((row) => row.props["aria-pressed"]);
		expect(pressed).toEqual([false, false, true, false]);
	});

	it("renders the adornment once per row when supplied", () => {
		renderChoiceField({
			adornment: (value) => <View testID={`adornment-${value}`} />,
		});

		for (const value of values) {
			expect(screen.getAllByTestId(`adornment-${value}`)).toHaveLength(1);
		}
	});

	it("renders no adornment when omitted", () => {
		renderChoiceField();

		expect(screen.queryAllByTestId(/adornment-/)).toHaveLength(0);
	});

	it("tapping the selected row does nothing when not clearable", () => {
		const onChange = jest.fn();
		renderChoiceField({ value: "high", onChange, clearable: false });

		fireEvent.press(screen.getByText("High"));

		expect(onChange).not.toHaveBeenCalled();
	});
});
