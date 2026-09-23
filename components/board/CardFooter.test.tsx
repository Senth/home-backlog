import { render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { CardFooter } from "@/components/board/CardFooter";
import type { Attachment, Node } from "@/models/node";
import { newNodeData } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ name }: { name: string }) => <View testID={name} />,
	};
});

const oneKb = 1024;

function anEntry(over: Partial<Attachment> = {}): Attachment {
	return {
		id: "att-1",
		path: "homes/home/nodes/node/att-1",
		name: "badrum.jpg",
		contentType: "image/jpeg",
		size: oneKb,
		uploadedAt: null,
		uploadedBy: "me",
		...over,
	};
}

function aNode(
	attachments: Attachment[],
	display: Node["attachmentDisplay"] = "count",
): Node {
	return {
		...newNodeData({ title: "Kort", rank: "a0", participantIds: ["me"] }),
		id: "card",
		completedAt: null,
		createdAt: null,
		createdBy: "me",
		updatedAt: null,
		attachments,
		attachmentDisplay: display,
	};
}

describe("CardFooter, the count face", () => {
	it("carries the paperclip fact beside where and how long", () => {
		render(
			<Provider theme={lightTheme}>
				<CardFooter
					node={aNode([anEntry(), anEntry({ id: "att-2", path: "p/2" })])}
					locationId={null}
					waiting={null}
				/>
			</Provider>,
		);

		expect(
			screen.getByText('board.attachedCount:{"count":2}'),
		).toBeOnTheScreen();
	});

	it("says nothing on a card with nothing attached", () => {
		render(
			<Provider theme={lightTheme}>
				<CardFooter node={aNode([])} locationId={null} waiting={null} />
			</Provider>,
		);

		expect(screen.queryByText(/attachedCount/)).toBeNull();
	});

	it("the pictures speak for themselves in thumbnails mode", () => {
		const images = [anEntry(), anEntry({ id: "att-2", path: "p/2" })];
		render(
			<Provider theme={lightTheme}>
				<CardFooter
					node={aNode(images, "thumbnails")}
					locationId={null}
					waiting={null}
				/>
			</Provider>,
		);

		expect(screen.queryByText(/attachedCount/)).toBeNull();
	});

	it("the waiting fact holds one line for the edge fade (#339)", () => {
		render(
			<Provider theme={lightTheme}>
				<CardFooter
					node={aNode([])}
					locationId={null}
					waiting={{
						label: "Waiting on Paint",
						a11yLabel: "Waiting on 1 card",
					}}
				/>
			</Provider>,
		);

		expect(screen.getByText("Waiting on Paint").props.numberOfLines).toBe(1);
	});
});
