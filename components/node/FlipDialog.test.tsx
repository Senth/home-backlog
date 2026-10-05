import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { FlipDialog, useFlip } from "@/components/node/FlipDialog";
import { PeopleSection } from "@/components/node/PeopleSection";
import { VisibilityField } from "@/components/node/VisibilityField";
import { flipVisibility } from "@/data/nodes";
import type { OutboxIntent } from "@/data/outbox-store";
import type { Member } from "@/models/home";
import { type Node, newNodeData } from "@/models/node";
import { enqueue, removeIntent } from "@/models/outbox";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en-US" },
	}),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/data/nodes", () => ({ flipVisibility: jest.fn() }));
let mockOnline = false;
let mockIntents: OutboxIntent[] = [];
const mockSubmit = jest.fn();
const mockUndo = jest.fn();
jest.mock("@/contexts/OutboxContext", () => ({
	useOutbox: () => ({
		intents: mockIntents,
		submit: mockSubmit,
		undo: mockUndo,
	}),
}));
jest.mock("@/hooks/use-online-status", () => ({
	useOnlineStatus: () => mockOnline,
}));
jest.mock("@/data/outbox-store", () => ({
	intentMetadata: (homeId: string, node: Node) => ({
		id: "flip-1",
		homeId,
		queuedAt: 1,
		title: node.title,
		sourceParentId: node.parentId,
		sourceAncestorIds: node.ancestorIds,
	}),
}));

const members: Member[] = [
	{ uid: "me", role: "owner", displayName: "Me", photoURL: null },
	{ uid: "other", role: "member", displayName: "Other", photoURL: null },
	{ uid: "bob", role: "member", displayName: "Bob", photoURL: null },
];
const node: Node = {
	...newNodeData({ title: "Project", rank: "a0", participantIds: ["me"] }),
	id: "project",
	createdAt: null,
	completedAt: null,
	updatedAt: null,
	createdBy: "me",
};
const pending: OutboxIntent = {
	id: "pending-1",
	homeId: "home-1",
	queuedAt: 1,
	title: node.title,
	sourceParentId: null,
	sourceAncestorIds: [],
	kind: "flipVisibility",
	nodeId: node.id,
	target: "private",
};
const onSave = jest.fn();

function Surface({
	subject = node,
	participants = false,
}: {
	subject?: Node;
	participants?: boolean;
}) {
	const flip = useFlip("home-1");
	return (
		<Provider theme={lightTheme}>
			{participants ? (
				<PeopleSection
					node={subject}
					root={subject}
					members={members}
					onSave={onSave}
					flip={flip}
					uid="me"
					only="participants"
				/>
			) : (
				<VisibilityField
					node={subject}
					members={members}
					uid="me"
					flip={flip}
				/>
			)}
			<FlipDialog state={flip} uid="me" />
		</Provider>
	);
}

beforeEach(() => {
	mockOnline = false;
	mockIntents = [];
	jest.mocked(flipVisibility).mockReset().mockResolvedValue();
	mockUndo.mockReset().mockImplementation(async (id: string) => {
		mockIntents = removeIntent(mockIntents, id);
	});
	mockSubmit
		.mockReset()
		.mockImplementation(
			async (intent: OutboxIntent, runOnline: () => Promise<void>) => {
				if (mockOnline) {
					try {
						await runOnline();
						return "saved";
					} catch (reason) {
						if ((reason as { code?: string }).code !== "unavailable")
							throw reason;
					}
				}
				mockIntents = enqueue(mockIntents, intent);
				return "queued";
			},
		);
});

async function confirmPrivate() {
	fireEvent.press(screen.getByText("detail.visibilityPrivate"));
	await act(async () =>
		fireEvent.press(screen.getByText("visibility.confirmAction")),
	);
}

it("offline confirmation queues a flip, keeps current chip selected and shows waiting line without progress", async () => {
	const view = render(<Surface />);
	expect(screen.getByText("detail.visibilityPrivate")).toBeEnabled();
	expect(screen.queryByText("board.offlineHint")).toBeNull();
	await confirmPrivate();
	expect(mockSubmit).toHaveBeenCalledWith(
		expect.objectContaining({
			kind: "flipVisibility",
			nodeId: "project",
			target: "private",
			homeId: "home-1",
			title: "Project",
			sourceParentId: null,
			sourceAncestorIds: [],
		}),
		expect.any(Function),
	);
	expect(flipVisibility).not.toHaveBeenCalled();
	view.rerender(<Surface />);
	expect(screen.getByText("outbox.pendingPrivate")).toBeTruthy();
	expect(screen.queryByTestId("visibility-progress-dialog")).toBeNull();
	expect(
		screen
			.getAllByRole("button")
			.filter((button) => button.props.accessibilityState?.selected === true),
	).toHaveLength(1);
	expect(
		screen.getByRole("button", {
			name: "detail.visibilityShared",
			selected: true,
		}),
	).toBeTruthy();
});

it("choosing current visibility cancels pending opposite flip rather than queuing another", async () => {
	mockIntents = [pending];
	const view = render(<Surface />);
	await act(async () =>
		fireEvent.press(screen.getByText("detail.visibilityShared")),
	);
	expect(mockUndo).toHaveBeenCalledWith("pending-1");
	expect(mockSubmit).not.toHaveBeenCalled();
	view.rerender(<Surface />);
	expect(screen.queryByText("outbox.pendingPrivate")).toBeNull();
});

it("current chip does not cancel resumable flip whose root already reached target", async () => {
	mockIntents = [pending];
	render(<Surface subject={{ ...node, visibility: "private" }} />);
	await act(async () =>
		fireEvent.press(screen.getByText("detail.visibilityPrivate")),
	);
	expect(mockUndo).not.toHaveBeenCalled();
	expect(mockSubmit).not.toHaveBeenCalled();
	expect(screen.getByText("outbox.pendingPrivate")).toBeTruthy();
});

it("private root participants queue their chosen list offline, retaining actor and server value", async () => {
	const subject = { ...node, visibility: "private" as const };
	const view = render(<Surface subject={subject} participants />);
	expect(screen.getByRole("checkbox", { name: "Other" })).toBeEnabled();
	await act(async () =>
		fireEvent.press(screen.getByRole("checkbox", { name: "Other" })),
	);
	expect(mockSubmit).toHaveBeenCalledWith(
		expect.objectContaining({
			kind: "flipVisibility",
			target: "private",
			participantIds: ["me", "other"],
		}),
		expect.any(Function),
	);
	expect(onSave).not.toHaveBeenCalled();
	expect(flipVisibility).not.toHaveBeenCalled();
	view.rerender(<Surface subject={subject} participants />);
	expect(screen.getByText("outbox.pendingParticipants")).toBeTruthy();
	expect(screen.getByRole("checkbox", { name: "Other" })).toBeChecked();
	expect(screen.getByRole("checkbox", { name: "Me" })).toBeDisabled();
	expect(screen.queryByText("board.offlineHint")).toBeNull();
	expect(screen.queryByTestId("visibility-progress-dialog")).toBeNull();
});

it("private participant toggles accumulate pending selection and reverse without changing server ACL", async () => {
	const subject = { ...node, visibility: "private" as const };
	const view = render(<Surface subject={subject} participants />);
	for (const name of ["Other", "Bob", "Other"]) {
		await act(async () =>
			fireEvent.press(screen.getByRole("checkbox", { name })),
		);
		view.rerender(<Surface subject={subject} participants />);
	}
	expect(
		mockSubmit.mock.calls.map(([intent]) => intent.participantIds),
	).toEqual([
		["me", "other"],
		["me", "other", "bob"],
		["me", "bob"],
	]);
	expect(screen.getByRole("checkbox", { name: "Other" })).not.toBeChecked();
	expect(screen.getByRole("checkbox", { name: "Bob" })).toBeChecked();
	expect(screen.getByRole("checkbox", { name: "Me" })).toBeDisabled();
	expect(subject.participantIds).toEqual(["me"]);
	expect(onSave).not.toHaveBeenCalled();
	expect(flipVisibility).not.toHaveBeenCalled();
});

it("pending shared flip says everyone in home, but other-home intents show no line", () => {
	mockIntents = [{ ...pending, target: "shared" }];
	const subject = { ...node, visibility: "private" as const };
	const view = render(<Surface subject={subject} />);
	expect(screen.getByText("outbox.pendingShared")).toBeTruthy();
	mockIntents = [{ ...pending, homeId: "other-home" }];
	view.rerender(<Surface subject={subject} />);
	expect(screen.queryByText(/outbox.pending/)).toBeNull();
});

it("online flip keeps progress dialog until writes finish", async () => {
	mockOnline = true;
	let finish: () => void = () => {};
	jest.mocked(flipVisibility).mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	render(<Surface />);
	await confirmPrivate();
	expect(screen.getByTestId("visibility-progress-dialog")).toBeTruthy();
	expect(flipVisibility).toHaveBeenCalledWith(
		"home-1",
		node,
		"private",
		"me",
		expect.objectContaining({ onProgress: expect.any(Function) }),
	);
	await act(async () => finish());
	expect(screen.queryByTestId("visibility-progress-dialog")).toBeNull();
	expect(mockIntents).toEqual([]);
});

it("unavailable midway queues resumable flip and closes progress without failure", async () => {
	mockOnline = true;
	jest
		.mocked(flipVisibility)
		.mockImplementationOnce(async (_homeId, _node, _target, _uid, options) => {
			options?.onProgress?.({ done: 1, total: 3 });
			throw { code: "unavailable" };
		});
	const view = render(<Surface />);
	await confirmPrivate();
	view.rerender(<Surface />);
	expect(mockIntents).toHaveLength(1);
	expect(screen.getByText("outbox.pendingPrivate")).toBeTruthy();
	expect(screen.queryByText("visibility.failed")).toBeNull();
	expect(screen.queryByTestId("visibility-progress-dialog")).toBeNull();
});

it("non-network online failure still offers retry and does not queue", async () => {
	mockOnline = true;
	jest
		.mocked(flipVisibility)
		.mockRejectedValueOnce(new Error("Permission refused"));
	const error = jest.spyOn(console, "error").mockImplementation(() => {});
	try {
		render(<Surface />);
		await confirmPrivate();
		expect(screen.getByText("visibility.failed")).toBeTruthy();
		expect(mockIntents).toEqual([]);
		await act(async () =>
			fireEvent.press(screen.getByText("visibility.retry")),
		);
		await waitFor(() =>
			expect(screen.queryByTestId("visibility-progress-dialog")).toBeNull(),
		);
		expect(flipVisibility).toHaveBeenCalledTimes(2);
	} finally {
		error.mockRestore();
	}
});
