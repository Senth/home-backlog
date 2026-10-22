import { act, render } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import { Avatar, ThemeProvider } from "react-native-paper";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import type { RecordedComponent } from "@/tests/support/record-props";
import { lightTheme } from "@/theme";

jest.mock("react-native-paper", () => {
	const { recordProps } = require("@/tests/support/record-props");
	const actual = jest.requireActual("react-native-paper");
	return {
		...actual,
		Avatar: {
			...actual.Avatar,
			Image: recordProps(actual.Avatar.Image),
		},
	};
});

const mockAvatarImage = Avatar.Image as unknown as RecordedComponent<
	ComponentProps<typeof Avatar.Image>
>;

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

		act(() => mockAvatarImage.getProps()[0].onLoad?.({} as never));
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

		act(() => mockAvatarImage.getProps()[0].onError?.({} as never));
		expect(mockAvatarImage.getProps()).toHaveLength(0);

		screen.rerender(
			<ThemeProvider theme={lightTheme}>
				<PersonAvatar
					name="Marcus"
					photoURL="https://example.com/b.png"
					px={32}
				/>
			</ThemeProvider>,
		);
		expect(mockAvatarImage.getProps()).toHaveLength(1);
	});
});
