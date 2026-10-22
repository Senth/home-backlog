import {
	act,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { ColumnBar } from "@/components/node/ColumnBar";
import { moveNode } from "@/data/nodes";
import type { Node, Status } from "@/models/node";
import { defaultColumns } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

jest.mock("@/data/nodes", () => ({
	moveNode: jest.fn(() => Promise.resolve()),
}));

function card(status: Status): Node {
	return {
		id: "n1",
		title: "Card",
		status,
		rank: "a0",
		parentId: null,
		ancestorIds: [],
		locationId: null,
		locationAncestorIds: [],
		participantIds: [],
		assigneeIds: [],
		visibility: "shared",
		columns: [...defaultColumns],
		childCount: 0,
		doneCount: 0,
	} as unknown as Node;
}

const label = (status: Status) =>
	`detail.moveToColumn:${JSON.stringify({ column: `status.${status}` })}`;

async function renderBar(status: Status) {
	await render(
		<Provider theme={lightTheme}>
			<ColumnBar
				homeId="h1"
				node={card(status)}
				columns={defaultColumns}
				nodes={[]}
				onFailed={() => {}}
			/>
		</Provider>,
	);
}

const part = 50;
const whole = 1000;

async function layOutWide() {
	const measured = screen.container.queryAll(
		(n) => typeof n.type === "string" && typeof n.props.onLayout === "function",
	);
	await act(() => {
		for (const n of measured) {
			n.props.onLayout({
				nativeEvent: { layout: { width: part, height: part } },
			});
		}
	});
	const bar = screen.getByTestId("column-bar-n1");
	await fireEvent(bar, "layout", {
		nativeEvent: { layout: { width: whole, height: part } },
	});
}

describe("ColumnBar", () => {
	beforeEach(() => jest.mocked(moveNode).mockClear());

	it("steps the last working column into done", async () => {
		await renderBar("execution");
		await fireEvent.press(screen.getByLabelText(label("done")));
		expect(moveNode).toHaveBeenCalledWith(
			"h1",
			expect.anything(),
			"done",
			expect.any(String),
		);
	});

	it("steps back to the previous column", async () => {
		await renderBar("next_up");
		await fireEvent.press(screen.getByLabelText(label("backlog")));
		expect(moveNode).toHaveBeenCalledWith(
			"h1",
			expect.anything(),
			"backlog",
			expect.any(String),
		);
	});

	it("disables back in the first column, and it names nothing", async () => {
		await renderBar("backlog");
		await layOutWide();
		const back = screen.getByRole("button", { disabled: true });
		expect(back).not.toHaveAccessibleName();
		expect(screen.queryByLabelText(label("backlog"))).toBeNull();
		expect(back).not.toHaveTextContent(/status\./);
		expect(screen.getByLabelText(label("next_up"))).toHaveTextContent(
			"status.next_up",
		);
	});

	it("disables forward in done, and it names nothing", async () => {
		await renderBar("done");
		await layOutWide();
		const forward = screen.getByRole("button", { disabled: true });
		expect(forward).not.toHaveAccessibleName();
		expect(screen.queryByLabelText(label("done"))).toBeNull();
		expect(forward).not.toHaveTextContent(/status\./);
		expect(screen.getByLabelText(label("execution"))).toHaveTextContent(
			"status.execution",
		);
		await fireEvent.press(forward);
		expect(moveNode).not.toHaveBeenCalled();
	});

	it("has no done button", async () => {
		await renderBar("next_up");
		expect(screen.queryByText("common.done")).toBeNull();
		expect(screen.queryByTestId("check")).toBeNull();
	});

	it("the centre opens a picker that jumps to any column", async () => {
		await renderBar("backlog");
		await fireEvent.press(screen.getByTestId("column-name-n1"));
		const sheet = within(screen.getByTestId("editor-column-n1-surface"));

		await fireEvent.press(sheet.getByText("status.backlog"));
		expect(moveNode).not.toHaveBeenCalled();

		await fireEvent.press(sheet.getByText("status.done"));
		expect(moveNode).toHaveBeenCalledWith(
			"h1",
			expect.anything(),
			"done",
			expect.any(String),
		);
	});
});
