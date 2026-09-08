import { fireEvent, render } from "@testing-library/react-native";
import { Avatar, ThemeProvider } from "react-native-paper";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { lightTheme } from "@/theme";

function renderAvatar(photoURL: string | null) {
	return render(
		<ThemeProvider theme={lightTheme}>
			<PersonAvatar name="Marcus" photoURL={photoURL} px={32} />
		</ThemeProvider>,
	);
}

// The initials are the observable fallback: visible until the photo loads,
// back after a failure, and — the point of the suite — back again when the
// photoURL changes, because an account switch reuses this component.
describe("PersonAvatar", () => {
	it("hides the initials once the photo loads and shows them again when the URL changes", () => {
		const screen = renderAvatar("https://example.com/a.png");
		expect(screen.queryByText("M")).toBeTruthy();

		fireEvent(screen.UNSAFE_getByType(Avatar.Image), "onLoad");
		expect(screen.queryByText("M")).toBeNull();

		screen.rerender(
			<ThemeProvider theme={lightTheme}>
				<PersonAvatar
					name="Marcus"
					photoURL="https://example.com/b.png"
					px={32}
				/>
			</ThemeProvider>,
		);
		expect(screen.queryByText("M")).toBeTruthy();
	});

	it("recovers the image attempt when a failed URL is swapped for another", () => {
		const screen = renderAvatar("https://example.com/a.png");

		fireEvent(screen.UNSAFE_getByType(Avatar.Image), "onError");
		expect(screen.UNSAFE_queryByType(Avatar.Image)).toBeNull();

		screen.rerender(
			<ThemeProvider theme={lightTheme}>
				<PersonAvatar
					name="Marcus"
					photoURL="https://example.com/b.png"
					px={32}
				/>
			</ThemeProvider>,
		);
		expect(screen.UNSAFE_queryByType(Avatar.Image)).toBeTruthy();
	});
});
