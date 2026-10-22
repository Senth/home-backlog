import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button, Provider } from "react-native-paper";
import { Row } from "@/components/ui/Row";
import { lightTheme } from "@/theme";

describe("Row", () => {
	it("pressing the title calls onPress", async () => {
		const onPress = jest.fn();
		await render(
			<Provider theme={lightTheme}>
				<Row
					title="Home"
					description="Description"
					onPress={onPress}
					testID="home-row"
				/>
			</Provider>,
		);

		expect(screen.getByRole("button", { name: /Home/ })).toBeEnabled();
		await fireEvent.press(screen.getByText("Home"));

		expect(onPress).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("home-row")).toBeOnTheScreen();
	});

	it("right controls stay enabled outside the lead button and do not press the row", async () => {
		const onPress = jest.fn();
		const onControl = jest.fn();
		await render(
			<Provider theme={lightTheme}>
				<Row
					title="Home"
					onPress={onPress}
					right={
						<Button mode="text" onPress={onControl}>
							Edit
						</Button>
					}
				/>
			</Provider>,
		);

		const control = screen.getByRole("button", { name: "Edit" });
		const lead = screen.getByRole("button", { name: "Home" });
		expect(control).toBeEnabled();
		for (let node = control.parent; node; node = node.parent) {
			expect(node.props["aria-disabled"]).not.toBe(true);
			expect(node.props.accessibilityState?.disabled).not.toBe(true);
			expect(node).not.toBe(lead);
		}
		await fireEvent.press(control);

		expect(onControl).toHaveBeenCalledTimes(1);
		expect(onPress).not.toHaveBeenCalled();
	});

	it("without onPress renders no button", async () => {
		await render(
			<Provider theme={lightTheme}>
				<Row title="Home" />
			</Provider>,
		);

		expect(screen.getByText("Home")).toBeOnTheScreen();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
