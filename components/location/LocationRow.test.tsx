import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactTestInstance } from "react-test-renderer";
import { LocationRow } from "@/components/location/LocationRow";
import type { Location } from "@/models/locations";
import { lightTheme } from "@/theme";
import { space } from "@/theme/tokens";

jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	const Mock = ({ name }: { name: string }) => <View testID={name} />;
	const withGlyphMap = Mock as unknown as { glyphMap: Record<string, number> };
	withGlyphMap.glyphMap = { home: 0x0f2d };
	return { __esModule: true, default: Mock };
});

jest.mock("@/contexts/AuthContext", () => ({
	// LocationDialog reads the uid on save; the row's render never saves.
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — `CheckListPicker.test.tsx` for the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

jest.mock("@/data/locations", () => ({
	deleteLocation: jest.fn(),
	moveLocation: jest.fn(),
	reorderLocation: jest.fn(),
	locationErrorKey: () => "error.saveFailed",
}));

// `LocationRow` draws the real `BoardCard` inside its card list, and
// `BoardCard` reads the home's labels off `activeHome`.
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: null }),
}));

const house: Location = {
	id: "house",
	title: "House",
	parentId: null,
	ancestorIds: [],
	rank: "a0",
	icon: "home",
	color: "teal",
	createdAt: null,
	createdBy: "uid-me",
	updatedAt: null,
};

function renderRow(overrides: Partial<Parameters<typeof LocationRow>[0]> = {}) {
	const onToggle = jest.fn();
	const onOpen = jest.fn();
	const tree = render(
		// Paper's `Menu` reads the safe-area insets through its portal, so the
		// row renders inside the provider every screen mounts it under. The
		// metric values themselves are read by nothing under test.
		<SafeAreaProvider
			initialMetrics={{
				insets: { top: 0, bottom: 0, left: 0, right: 0 },
				frame: { x: 0, y: 0, width: space.none, height: space.none },
			}}
		>
			<ThemeProvider theme={lightTheme}>
				<LocationRow
					homeId="home-1"
					location={house}
					hasChildren
					expanded
					counts={new Map([["house", 2]])}
					onToggle={onToggle}
					onOpen={onOpen}
					onAddUnder={jest.fn()}
					onMoveUnder={jest.fn()}
					locations={[house]}
					online
					onError={jest.fn()}
					{...overrides}
				/>
			</ThemeProvider>
		</SafeAreaProvider>,
	);
	return { ...tree, onToggle, onOpen };
}

/**
 * Every host element in the tree that carries a button role. Composite layers
 * (Paper's `IconButton`, RN's `Pressable`) each forward one host `View` with
 * the role on it, so counting hosts counts the buttons a user sees — once.
 */
function buttons(root: ReactTestInstance): ReactTestInstance[] {
	const found: ReactTestInstance[] = [];
	const walk = (node: ReactTestInstance) => {
		if (
			typeof node.type === "string" &&
			node.props.accessibilityRole === "button"
		)
			found.push(node);
		node.children.forEach((child) => {
			if (typeof child !== "object") return;
			walk(child as ReactTestInstance);
		});
	};
	walk(root);
	return found;
}

describe("LocationRow", () => {
	it("renders the three sibling controls: chevron, name, menu", () => {
		const { getByLabelText } = renderRow();

		// Three buttons by their names — the chevron, the name, the menu — and
		// none of them inside another, which is what the old
		// TouchableRipple-wrapping-an-IconButton got wrong (#205).
		expect(
			getByLabelText(`locations.toggle:${JSON.stringify({ name: "House" })}`),
		).toBeTruthy();
		expect(
			getByLabelText(`locations.open:${JSON.stringify({ name: "House" })}`),
		).toBeTruthy();
		expect(getByLabelText("locations.actions")).toBeTruthy();
	});

	it("nests no control inside another", () => {
		const { root } = renderRow();
		const controls = buttons(root);
		expect(controls).toHaveLength(3);
		for (const control of controls) {
			for (const inner of buttons(control)) {
				// The only button a button may contain is itself.
				expect(inner).toBe(control);
			}
		}
	});

	it("toggles through the chevron, and only the chevron", () => {
		const { getByLabelText, onToggle } = renderRow();

		fireEvent.press(getByLabelText(/locations.toggle/));
		expect(onToggle).toHaveBeenCalledWith("house");
	});

	it("opens the place's work through the name, and only the name", () => {
		const { getByLabelText, onOpen, onToggle } = renderRow();

		fireEvent.press(getByLabelText(/locations.open/));
		expect(onOpen).toHaveBeenCalledWith(house);
		expect(onToggle).not.toHaveBeenCalled();
	});

	it("keeps a chevron out of a childless row, but keeps the names aligned", () => {
		const { queryByLabelText } = renderRow({ hasChildren: false });

		expect(queryByLabelText(/locations.toggle/)).toBeNull();
		expect(queryByLabelText(/locations.open/)).toBeTruthy();
	});

	it("draws the rolled-up count, and nothing at zero", () => {
		const { getByText, queryByText, rerender } = renderRow();

		// Two open cards at or under House — the number the row's tap delivers.
		expect(getByText("2")).toBeTruthy();

		rerender(
			<SafeAreaProvider
				initialMetrics={{
					insets: { top: 0, bottom: 0, left: 0, right: 0 },
					frame: { x: 0, y: 0, width: space.none, height: space.none },
				}}
			>
				<ThemeProvider theme={lightTheme}>
					<LocationRow
						homeId="home-1"
						location={house}
						hasChildren
						expanded
						counts={new Map()}
						onToggle={jest.fn()}
						onOpen={jest.fn()}
						onAddUnder={jest.fn()}
						onMoveUnder={jest.fn()}
						locations={[house]}
						online
						onError={jest.fn()}
					/>
				</ThemeProvider>
			</SafeAreaProvider>,
		);

		expect(queryByText("0")).toBeNull();
	});
});
