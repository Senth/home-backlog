import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { Appbar, Provider } from "react-native-paper";
import { AppHeader } from "@/components/ui/AppHeader";
import { BackAction } from "@/components/ui/BackAction";
import { lightTheme } from "@/theme";

const viewportHeight = 844;

describe("AppHeader", () => {
	it.each([195, 360, 390, 1280])(
		"names the home and keeps navigation and actions usable at %ipx",
		(width) => {
			Dimensions.set({
				window: { width, height: viewportHeight, scale: 1, fontScale: 1 },
			});
			const onBack = jest.fn();
			const onAction = jest.fn();
			render(
				<Provider theme={lightTheme}>
					<AppHeader
						title="Sommarstugan vid Vättern"
						leading={<BackAction accessibilityLabel="Homes" onPress={onBack} />}
					>
						<Appbar.Action
							icon="tune"
							accessibilityLabel="Settings"
							onPress={onAction}
						/>
					</AppHeader>
				</Provider>,
			);

			expect(
				screen.getByRole("header", { name: "Sommarstugan vid Vättern" }),
			).toBeOnTheScreen();
			fireEvent.press(screen.getByRole("button", { name: "Homes" }));
			fireEvent.press(screen.getByRole("button", { name: "Settings" }));
			expect(onBack).toHaveBeenCalledTimes(1);
			expect(onAction).toHaveBeenCalledTimes(1);
		},
	);
});
