import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { IconQuickPicks } from "@/components/label/IconQuickPicks";
import { labelIconPicks } from "@/models/label";
import { locationIconPicks } from "@/models/locations";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

function renderPicks(
	props: Partial<Parameters<typeof IconQuickPicks>[0]> = {},
) {
	const onChange = jest.fn();
	const onOpenPicker = jest.fn();
	render(
		<Provider theme={lightTheme}>
			<IconQuickPicks
				value="sofa"
				color="stone"
				picks={locationIconPicks}
				variant="location"
				onChange={onChange}
				onOpenPicker={onOpenPicker}
				{...props}
			/>
		</Provider>,
	);
	return { onChange, onOpenPicker };
}

describe("IconQuickPicks", () => {
	it("chooses a pick and reports the chosen pick selected", () => {
		const { onChange } = renderPicks();
		expect(
			screen.getByRole("button", { name: "icons.pick.sofa" }).props
				.accessibilityState,
		).toEqual({ selected: true });
		fireEvent.press(screen.getByRole("button", { name: "icons.pick.bed" }));
		expect(onChange).toHaveBeenCalledWith("bed");
	});

	it("selects only the search slot for a place glyph outside the picks", () => {
		renderPicks({ value: "fridge" });
		expect(
			screen.getByRole("button", { name: "icons.more" }).props
				.accessibilityState,
		).toEqual({ selected: true });
		for (const name of locationIconPicks) {
			expect(
				screen.getByRole("button", { name: `icons.pick.${name}` }).props
					.accessibilityState,
			).toEqual({ selected: false });
		}
	});

	it("opens the full picker from the search slot for a label", () => {
		const { onOpenPicker } = renderPicks({
			value: "format-paint",
			color: "teal",
			variant: "label",
			picks: labelIconPicks,
		});
		fireEvent.press(screen.getByRole("button", { name: "icons.more" }));
		expect(onOpenPicker).toHaveBeenCalledTimes(1);
		expect(
			screen.getByRole("button", { name: "icons.pick.format-paint" }).props
				.accessibilityState,
		).toEqual({ selected: true });
	});

	it("keeps an off-list label glyph in the selected search slot", () => {
		const { onOpenPicker } = renderPicks({
			value: "fridge",
			color: "teal",
			variant: "label",
			picks: labelIconPicks,
		});
		expect(
			screen.getByRole("button", { name: "icons.more" }).props
				.accessibilityState,
		).toEqual({ selected: true });
		for (const name of labelIconPicks) {
			expect(
				screen.getByRole("button", { name: `icons.pick.${name}` }).props
					.accessibilityState,
			).toEqual({ selected: false });
		}
		fireEvent.press(screen.getByRole("button", { name: "icons.more" }));
		expect(onOpenPicker).toHaveBeenCalledTimes(1);
	});
});
