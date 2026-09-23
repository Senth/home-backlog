import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react-native";
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

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "me" } }),
}));

jest.mock("@/data/attachments", () => ({
	uploadAttachment: jest.fn(),
	deleteAttachment: jest.fn(async () => undefined),
}));

import { getDownloadURL } from "firebase/storage";
import { deleteAttachment } from "@/data/attachments";

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

function aNode(attachments: Attachment[], over: Partial<Node> = {}): Node {
	return {
		...newNodeData({ title: "Badrummet", rank: "a0", participantIds: ["me"] }),
		id: "card",
		completedAt: null,
		createdAt: null,
		createdBy: "me",
		updatedAt: null,
		attachments,
		attachmentCount: attachments.length,
		...over,
	};
}

function renderSection(node: Node) {
	return render(
		<Provider theme={lightTheme}>
			<AttachmentsSection homeId="home" node={node} onSave={() => {}} />
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
		expect(screen.getByText("3 megabytes")).toBeOnTheScreen();
	});

	it("asks Storage for a missing thumbnail once, and leaves no slot for it", async () => {
		// A unique path, because `urlOf`'s cache is module-level and outlives
		// a test.
		const missingThumb = "homes/home/nodes/node/trasig.jpg_thumb.jpg";
		(getDownloadURL as jest.Mock).mockImplementation(
			async (target: { path: string }) => {
				if (target.path === missingThumb) {
					throw Object.assign(new Error("No such object"), {
						code: "storage/object-not-found",
					});
				}
				return "https://files.test/object";
			},
		);
		const images = [
			anAttachment({
				id: "ett",
				path: "homes/home/nodes/node/ett.jpg",
				name: "ett.jpg",
			}),
			anAttachment({
				id: "trasig",
				path: "homes/home/nodes/node/trasig.jpg",
				name: "trasig.jpg",
			}),
		];
		const view = renderSection(aNode(images));

		await waitFor(() => {
			expect(screen.getByLabelText("ett.jpg")).toBeOnTheScreen();
		});
		// The drawable one grids; the one whose thumbnail has no object takes
		// no slot at all, the way the card face draws it.
		expect(screen.queryByLabelText("trasig.jpg")).toBeNull();

		const askedFor = () =>
			(getDownloadURL as jest.Mock).mock.calls.filter(
				([target]) => target.path === missingThumb,
			).length;
		expect(askedFor()).toBe(1);

		// A node write re-runs the fetch, but the shared cache keeps the
		// not-found rejection — one 404 per session, not one per write.
		view.rerender(
			<Provider theme={lightTheme}>
				<AttachmentsSection
					homeId="home"
					node={aNode(images)}
					onSave={() => {}}
				/>
			</Provider>,
		);
		await waitFor(() => {
			expect(screen.getByLabelText("ett.jpg")).toBeOnTheScreen();
		});
		expect(askedFor()).toBe(1);

		(getDownloadURL as jest.Mock).mockImplementation(
			async () => "https://files.test/object",
		);
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

	it("opens the viewer from a tap, with every action in its bar", async () => {
		const images = [anAttachment({ id: "bild", name: "badrum.jpg" })];
		renderSection(aNode(images));

		await waitFor(() => {
			expect(screen.getByLabelText("badrum.jpg")).toBeOnTheScreen();
		});
		fireEvent.press(screen.getByLabelText("badrum.jpg"));
		await act(async () => {});

		// The bar is where the actions live — the gesture menu is only the
		// shortcut, so the tap route carries all of it, plus the way out.
		expect(
			screen.getByLabelText("detail.attachmentsDownload"),
		).toBeOnTheScreen();
		expect(screen.getByLabelText("detail.attachmentsHero")).toBeOnTheScreen();
		expect(screen.getByLabelText("detail.attachmentsDelete")).toBeOnTheScreen();
		expect(screen.getByLabelText("detail.attachmentsClose")).toBeOnTheScreen();

		fireEvent.press(screen.getByLabelText("detail.attachmentsClose"));
		expect(screen.queryByLabelText("detail.attachmentsDelete")).toBeNull();
	});

	it("offers no hero action for the image that is already the hero", async () => {
		const images = [anAttachment({ id: "bild", name: "badrum.jpg" })];
		renderSection(aNode(images, { heroAttachmentId: "bild" }));

		await waitFor(() => {
			expect(screen.getByLabelText("badrum.jpg")).toBeOnTheScreen();
		});
		fireEvent.press(screen.getByLabelText("badrum.jpg"));
		await act(async () => {});

		expect(screen.queryByLabelText("detail.attachmentsHero")).toBeNull();
		expect(
			screen.getByLabelText("detail.attachmentsDownload"),
		).toBeOnTheScreen();
	});

	it("asks before deleting, naming the file, then deletes", async () => {
		const entry = anAttachment({ id: "bild", name: "badrum.jpg" });
		renderSection(aNode([entry]));

		await waitFor(() => {
			expect(screen.getByLabelText("badrum.jpg")).toBeOnTheScreen();
		});
		fireEvent.press(screen.getByLabelText("badrum.jpg"));
		await act(async () => {});
		fireEvent.press(screen.getByLabelText("detail.attachmentsDelete"));

		expect(
			screen.getByText('detail.attachmentsDeleteTitle:{"name":"badrum.jpg"}'),
		).toBeOnTheScreen();

		fireEvent.press(screen.getByText("detail.attachmentsDelete"));
		expect(deleteAttachment).toHaveBeenCalledWith("home", "card", entry);
		await act(async () => {});
	});
});
