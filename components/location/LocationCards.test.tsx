import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Provider } from "react-native-paper";
import { LocationCards } from "@/components/location/LocationCards";
import type { Location } from "@/models/locations";
import type { Node } from "@/models/node";
import { lightTheme } from "@/theme";

let mockWidth = 1440;
let mockHeight = 0;

jest.mock("expo-router", () => ({
	router: { push: jest.fn(), setParams: jest.fn() },
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({ width: mockWidth, height: mockHeight }),
}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@/components/board/BoardCard", () => ({
	BoardCard: ({ node, onOpen }: { node: Node; onOpen: () => void }) => {
		const React = require("react") as typeof import("react");
		const { Pressable, Text } =
			require("react-native") as typeof import("react-native");
		return React.createElement(
			Pressable,
			{ onPress: onOpen },
			React.createElement(Text, null, node.title),
		);
	},
}));

const card = {
	id: "card-1",
	title: "Repair light",
	status: "execution",
	rank: "a0",
	childCount: 0,
	ancestorIds: [],
	locationId: "place-1",
	locationAncestorIds: [],
	priority: null,
} as unknown as Node;

function renderCards() {
	return render(
		<Provider theme={lightTheme}>
			<LocationCards
				location={{ id: "place-1", title: "Study" } as Location}
				pool={[card]}
				locationTitles={new Map()}
				onMore={() => {}}
			/>
		</Provider>,
	);
}

beforeEach(() => {
	mockWidth = 1440;
	jest.clearAllMocks();
});

it("opens card details in the Locations pane on desktop", () => {
	renderCards();
	fireEvent.press(screen.getByText("Repair light"));

	expect(router.setParams).toHaveBeenCalledWith({ card: "card-1" });
	expect(router.push).not.toHaveBeenCalled();
});

it("keeps the Locations details page on phones", () => {
	mockWidth = 390;
	renderCards();
	fireEvent.press(screen.getByText("Repair light"));

	expect(router.push).toHaveBeenCalledWith({
		pathname: "/projects/[nodeId]/details",
		params: { nodeId: "card-1", from: "locations" },
	});
	expect(router.setParams).not.toHaveBeenCalled();
});
