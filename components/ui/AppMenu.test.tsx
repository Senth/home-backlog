import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Button, Menu, Provider } from "react-native-paper";
import { AppMenu } from "@/components/ui/AppMenu";
import { lightTheme } from "@/theme";

function Harness() {
	const [open, setOpen] = useState(false);

	return (
		<Provider theme={lightTheme}>
			<AppMenu
				visible={open}
				onDismiss={() => setOpen(false)}
				anchor={
					<Button testID="trigger" onPress={() => setOpen(true)}>
						Open
					</Button>
				}
			>
				<Menu.Item title="First item" onPress={() => setOpen(false)} />
				<Menu.Item title="Second item" onPress={() => setOpen(false)} />
			</AppMenu>
		</Provider>
	);
}

describe("AppMenu", () => {
	it("renders the anchor and nothing else before the first open", () => {
		render(<Harness />);

		expect(screen.getByTestId("trigger")).toBeTruthy();
		expect(screen.queryByText("First item")).toBeNull();
		expect(screen.queryByText("Second item")).toBeNull();
	});

	it("mounts the menu and its items once opened", () => {
		render(<Harness />);

		fireEvent.press(screen.getByTestId("trigger"));

		expect(screen.getByText("First item")).toBeTruthy();
		expect(screen.getByText("Second item")).toBeTruthy();
	});

	it("keeps the anchor mounted after the menu closes again", () => {
		render(<Harness />);

		fireEvent.press(screen.getByTestId("trigger"));
		fireEvent.press(screen.getByText("First item"));

		expect(screen.getByTestId("trigger")).toBeTruthy();
	});
});
