import { render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { CardFooter } from "@/components/board/CardFooter";
import type { Location } from "@/models/locations";
import type { Attachment, Node } from "@/models/node";
import { newNodeData } from "@/models/node";
import { labelHues, lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

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

function aLocation(over: Partial<Location> = {}): Location {
	return {
		id: "place-1",
		title: "Badrummet",
		parentId: null,
		ancestorIds: [],
		rank: "a0",
		icon: "sofa-outline",
		color: "teal",
		createdAt: null,
		createdBy: "me",
		updatedAt: null,
		...over,
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

describe("CardFooter, the location fact", () => {
	it("draws the place's own glyph in its own hue (#338)", () => {
		render(
			<Provider theme={lightTheme}>
				<CardFooter
					node={aNode([])}
					locationId="place-1"
					locations={new Map([["place-1", aLocation()]])}
					waiting={null}
				/>
			</Provider>,
		);

		expect(
			screen.getByTestId("sofa-outline", { includeHiddenElements: true }),
		).toBeOnTheScreen();
		expect(
			screen.getByTestId("sofa-outline", { includeHiddenElements: true }).props
				.style.backgroundColor,
		).toBe(labelHues.teal.light.ink);
	});
});
