import { render, screen, waitFor } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { AttachmentsSection } from "@/components/node/AttachmentsSection";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
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

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "me" } }),
}));

jest.mock("@/data/attachments", () => ({
	uploadAttachment: jest.fn(),
}));

jest.mock("@/config/firebase", () => ({ db: {}, storage: {} }));

jest.mock("firebase/storage", () => ({
	getDownloadURL: jest.fn(async () => "https://files.test/object"),
	ref: jest.fn((_storage: unknown, path: string) => ({ path })),
}));

let mockOnline = true;
jest.mock("@/hooks/use-online-status", () => ({
	useOnlineStatus: () => mockOnline,
}));

const oneMb = 1024 * 1024;
const photoBytes = 3 * oneMb;

function anAttachment(over: Partial<Attachment> = {}): Attachment {
	return {
		id: "att-1",
		path: "homes/home/nodes/node/att-1",
		name: "badrum.jpg",
		contentType: "image/jpeg",
		size: photoBytes,
		uploadedAt: null,
		uploadedBy: "me",
		...over,
	};
}

function aNode(attachments: Attachment[]): Node {
	return {
		...newNodeData({ title: "Badrummet", rank: "a0", participantIds: ["me"] }),
		id: "card",
		completedAt: null,
		createdAt: null,
		createdBy: "me",
		updatedAt: null,
		attachments,
		attachmentCount: attachments.length,
	};
}

function renderSection(node: Node) {
	return render(
		<Provider theme={lightTheme}>
			<AttachmentsSection homeId="home" node={node} />
		</Provider>,
	);
}

describe("AttachmentsSection", () => {
	beforeEach(() => {
		mockOnline = true;
	});

	it("reads as a quiet section with its one way in", () => {
		renderSection(aNode([]));

		expect(screen.getByText("detail.attachments")).toBeOnTheScreen();
		expect(screen.getByText("detail.attachmentsAdd")).toBeOnTheScreen();
		expect(screen.queryByText("detail.attachmentsOffline")).toBeNull();
	});

	it("leads with the first image and grids the rest three across", async () => {
		const images = ["ett", "två", "fyra", "fem"].map((id) =>
			anAttachment({
				id,
				path: `homes/home/nodes/node/${id}`,
				name: `${id}.jpg`,
			}),
		);
		const documents = [
			anAttachment({
				id: "kalkyl",
				name: "kalkyl.pdf",
				contentType: "application/pdf",
			}),
		];
		renderSection(aNode([...images, ...documents]));

		// Four images: the lead full width, then one row of three — a shorter
		// row keeps the tile size, never stretching. The tiles arrive when the
		// download URLs have resolved.
		await waitFor(() => {
			expect(screen.getByLabelText("ett.jpg")).toBeOnTheScreen();
		});
		expect(screen.getByLabelText("fyra.jpg")).toBeOnTheScreen();
		expect(screen.getByLabelText("fem.jpg")).toBeOnTheScreen();

		// A document is a row of its own, named and sized — not a tile.
		expect(screen.getByText("kalkyl.pdf")).toBeOnTheScreen();
		expect(screen.getByText("3 MB")).toBeOnTheScreen();
	});

	it("disables the way in offline, and says why", () => {
		mockOnline = false;
		renderSection(aNode([]));

		expect(screen.getByText("detail.attachmentsAdd")).toBeDisabled();
		expect(screen.getByText("detail.attachmentsOffline")).toBeOnTheScreen();
	});

	it("carries the heading and the explanation in both locales", () => {
		expect(enUS.detail.attachments.length).toBeGreaterThan(0);
		expect(svSE.detail.attachments.length).toBeGreaterThan(0);
		expect(enUS.detail.attachmentsOffline.length).toBeGreaterThan(0);
		expect(svSE.detail.attachmentsOffline.length).toBeGreaterThan(0);
	});
});
