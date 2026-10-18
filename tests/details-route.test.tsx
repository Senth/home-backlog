import { render, screen } from "@testing-library/react-native";
import NodeDetails from "@/app/(app)/(tabs)/projects/[nodeId]/details";
import { useNode } from "@/hooks/use-node";

let mockWidth = 719;
const mockHeight = 900;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({ width: mockWidth, height: mockHeight }),
}));
jest.mock("expo-router", () => ({
	useLocalSearchParams: () => ({ nodeId: "card-1" }),
	Redirect: ({ href }: { href: unknown }) => {
		const { Text } = require("react-native");
		return <Text>{JSON.stringify(href)}</Text>;
	},
}));
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: { id: "home-1" } }),
}));
jest.mock("@/hooks/use-node", () => ({ useNode: jest.fn() }));
jest.mock("@/components/node/DetailsView", () => ({
	DetailsView: ({ nodeId }: { nodeId: string }) => {
		const { Text } = require("react-native");
		return <Text>{`Phone details ${nodeId}`}</Text>;
	},
}));

it("keeps the phone page without another document read", () => {
	mockWidth = 719;
	render(<NodeDetails />);
	expect(screen.getByText("Phone details card-1")).toBeTruthy();
	expect(useNode).not.toHaveBeenCalled();
});

it.each([null, "project-1"])(
	"replaces an old desktop URL with its parent board %s and selected card",
	(parentId) => {
		mockWidth = 720;
		jest.mocked(useNode).mockReturnValue({
			node: { id: "card-1", parentId },
			loading: false,
			gone: false,
		} as ReturnType<typeof useNode>);
		render(<NodeDetails />);
		expect(useNode).toHaveBeenCalledWith("home-1", "card-1");
		expect(
			screen.getByText(
				JSON.stringify(
					parentId === null
						? { pathname: "/projects", params: { card: "card-1" } }
						: {
								pathname: "/projects/[nodeId]",
								params: { nodeId: parentId, card: "card-1" },
							},
				),
			),
		).toBeTruthy();
		expect(screen.queryByText("Phone details card-1")).toBeNull();
	},
);

it("waits for the parent and sends a missing desktop card to the root board", () => {
	mockWidth = 1440;
	jest
		.mocked(useNode)
		.mockReturnValue({ node: null, loading: true, gone: false });
	const view = render(<NodeDetails />);
	expect(view.toJSON()).toBeNull();
	jest
		.mocked(useNode)
		.mockReturnValue({ node: null, loading: false, gone: true });
	view.rerender(<NodeDetails />);
	expect(
		screen.getByText(JSON.stringify({ pathname: "/projects" })),
	).toBeTruthy();
});
