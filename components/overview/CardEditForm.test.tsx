import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ name }: { name: string }) => <View testID={name} />,
	};
});

// Paper's inputs read the theme its provider carries.
import { Provider } from "react-native-paper";
import { CardEditForm } from "@/components/overview/CardEditForm";
import { AuthProvider } from "@/contexts/AuthContext";
import type { LabelWithId } from "@/models/label";
import { lightTheme } from "@/theme";

/**
 * The real tree: `app/_layout.tsx` mounts `AuthProvider` inside
 * `PaperProvider`, and the form reads the uid through `useAuth`. The
 * mock must throw the way the real hook does — a canned user in the mock
 * provider is the false green that once hid the `useAuth` crash.
 */
jest.mock("@/contexts/AuthContext", () => {
	const { createContext, createElement, useContext } =
		require("react") as typeof import("react");

	const AuthContext = createContext<{ user: { uid: string } } | null>(null);

	return {
		AuthProvider: ({ children }: { children: ReactNode }) =>
			createElement(
				AuthContext.Provider,
				{ value: { user: { uid: "uid-me" } } },
				children,
			),
		useAuth: () => {
			const auth = useContext(AuthContext);
			if (auth === null) {
				throw new Error("useAuth must be used within an AuthProvider");
			}
			return auth;
		},
	};
});

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — the form is translated elsewhere, and
	// `Board.test.tsx` carries the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

const labels: LabelWithId[] = [
	{ id: "lb1", title: "Målning", icon: "brush", color: "red", rank: "a0" },
];

const renderForm = (onSave = jest.fn()) =>
	render(
		<Provider theme={lightTheme}>
			{/* The real order: `AuthProvider` inside `PaperProvider`. */}
			<AuthProvider>
				<CardEditForm
					card={null}
					scope="home"
					members={[]}
					locations={[]}
					labels={labels}
					onSave={onSave}
				/>
			</AuthProvider>
		</Provider>,
	);

describe("CardEditForm", () => {
	/**
	 * #229 closed: a blank card plus one tap on *Färdiga* is the whole
	 * Recently done card — the mode selector seeds the window, the order and
	 * the empty state, and Save writes exactly what the seed carries.
	 */
	it("turns a blank card into Recently done with one tap on Färdiga", () => {
		const onSave = jest.fn();
		renderForm(onSave);

		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));
		fireEvent.changeText(
			screen.getByTestId("overview-card-edit-title"),
			"Recently done",
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "done",
				conditions: [{ field: "completedAt", is: "within" }],
				sort: { field: "completedAt", direction: "desc" },
				empty: { mode: "hide" },
			}),
			"home",
		);
	});

	it("offers the done card no status, due or waiting group, and open no completed window", () => {
		renderForm();

		expect(screen.queryByText("overview.cards.field.status")).toBeTruthy();
		expect(screen.queryByText("detail.dueDate")).toBeTruthy();
		expect(screen.queryByText("board.blocked")).toBeTruthy();
		expect(screen.queryByText("overview.cards.field.completedAt")).toBeNull();

		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));

		expect(screen.queryByText("overview.cards.field.status")).toBeNull();
		expect(screen.queryByText("detail.dueDate")).toBeNull();
		expect(screen.queryByText("board.blocked")).toBeNull();
		expect(screen.queryByText("overview.cards.field.completedAt")).toBeTruthy();

		fireEvent.press(screen.getByText("overview.cards.editor.mode.open"));

		expect(screen.queryByText("overview.cards.field.completedAt")).toBeNull();
		expect(screen.queryByText("overview.cards.field.status")).toBeTruthy();
	});

	it("a field row opens the values as check rows, and a pick writes the condition", () => {
		const onSave = jest.fn();
		renderForm(onSave);

		fireEvent.press(screen.getByTestId("overview-card-edit-field-priority"));
		fireEvent.press(screen.getByRole("checkbox", { name: "priority.high" }));
		fireEvent.changeText(
			screen.getByTestId("overview-card-edit-title"),
			"Urgent jobs",
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				conditions: [{ field: "priority", anyOf: ["high"] }],
			}),
			"home",
		);
	});

	/**
	 * #306: the editor offers the home's labels as a condition, and a pick
	 * stores the label ids — the read screen's pool already matches on them.
	 */
	it("offers the home's labels as a condition and stores the picked ids", () => {
		const onSave = jest.fn();
		renderForm(onSave);

		fireEvent.press(screen.getByTestId("overview-card-edit-field-labelIds"));
		fireEvent.press(screen.getByRole("checkbox", { name: "Målning" }));
		fireEvent.changeText(
			screen.getByTestId("overview-card-edit-title"),
			"Painting",
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				conditions: [{ field: "labelIds", anyOf: ["lb1"] }],
			}),
			"home",
		);
	});

	it("a row's clear takes that field off and leaves the rest standing", () => {
		const onSave = jest.fn();
		renderForm(onSave);

		fireEvent.press(screen.getByTestId("overview-card-edit-field-priority"));
		fireEvent.press(screen.getByRole("checkbox", { name: "priority.high" }));
		fireEvent.press(screen.getByTestId("overview-card-edit-field-effort"));
		fireEvent.press(screen.getByRole("checkbox", { name: "effort.quick" }));
		fireEvent.press(
			screen.getByLabelText(
				'board.filter.removeFilter:{"what":"detail.priority"}',
			),
		);
		fireEvent.changeText(
			screen.getByTestId("overview-card-edit-title"),
			"Quick ones",
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				conditions: [{ field: "effort", anyOf: ["quick"] }],
			}),
			"home",
		);
	});

	it("a card that already had a condition still lands on done's newest-first sort", () => {
		const onSave = jest.fn();
		renderForm(onSave);

		// A card with a condition takes none of withMode's seed branches: the
		// mode moves and the conditions ride along — but done has no sort
		// control, so the default order has to arrive here, not from the user.
		fireEvent.press(screen.getByTestId("overview-card-edit-field-priority"));
		fireEvent.press(screen.getByRole("checkbox", { name: "priority.high" }));
		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));
		fireEvent.changeText(
			screen.getByTestId("overview-card-edit-title"),
			"Urgent finished",
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "done",
				conditions: [{ field: "priority", anyOf: ["high"] }],
				sort: { field: "completedAt", direction: "desc" },
			}),
			"home",
		);
	});

	/**
	 * #327: the empty state is the reader's to set — the checkbox at the
	 * bottom writes `hide` on, and unticking it restores the sentence a
	 * card with no configuration carries.
	 */
	it("the hide-when-empty checkbox saves the empty mode on and off", () => {
		const onSave = jest.fn();
		renderForm(onSave);

		fireEvent.press(
			screen.getByRole("checkbox", {
				name: "overview.cards.edit.hideWhenEmpty",
			}),
		);
		fireEvent.changeText(
			screen.getByTestId("overview-card-edit-title"),
			"Any card",
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({ empty: { mode: "hide" } }),
			"home",
		);

		onSave.mockClear();
		// A blank card moved to done arrives ticked (the #229 shape), so the
		// way back is the same row unticked — not a fresh card.
		fireEvent.press(
			screen.getByRole("checkbox", {
				name: "overview.cards.edit.hideWhenEmpty",
			}),
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				empty: { mode: "say", key: "overview.cards.empty.generic" },
			}),
			"home",
		);
	});

	it("says what each mode collects", () => {
		renderForm();

		expect(
			screen.getByText("overview.cards.editor.mode.openDescription"),
		).toBeTruthy();
		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));
		expect(
			screen.getByText("overview.cards.editor.mode.doneDescription"),
		).toBeTruthy();
	});

	it("says where each scope stores the card, all three of them", () => {
		renderForm();

		expect(
			screen.getByText("overview.cards.editor.scope.homeDescription"),
		).toBeTruthy();
		fireEvent.press(screen.getByText("overview.cards.editor.scope.global"));
		expect(
			screen.getByText("overview.cards.editor.scope.globalDescription"),
		).toBeTruthy();
		fireEvent.press(screen.getByText("overview.cards.editor.scope.shared"));
		expect(
			screen.getByText("overview.cards.editor.scope.sharedDescription"),
		).toBeTruthy();
	});
});
