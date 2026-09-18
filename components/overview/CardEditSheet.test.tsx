import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
// `Provider`, not `ThemeProvider`: the dialog mounts a Portal host.
import { Provider } from "react-native-paper";
// Paper's dialog reads the safe-area insets its provider carries.
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CardEditSheet } from "@/components/overview/CardEditSheet";
import { AuthProvider } from "@/contexts/AuthContext";
import { lightTheme } from "@/theme";
import { space } from "@/theme/tokens";

/**
 * The real tree: `app/_layout.tsx` mounts `AuthProvider` inside
 * `PaperProvider`, so the dialog's portal children render *outside* it. The
 * mock must throw the way the real hook does — a canned user here is the
 * false green that once hid the `useAuth` crash inside the portal.
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
	// Keys asserted, not sentences — the sheet is translated elsewhere, and
	// `Board.test.tsx` carries the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

const renderSheet = (onSave = jest.fn()) =>
	render(
		<SafeAreaProvider
			initialMetrics={{
				insets: { top: 0, bottom: 0, left: 0, right: 0 },
				frame: { x: 0, y: 0, width: space.none, height: space.none },
			}}
		>
			<Provider theme={lightTheme}>
				{/* The real order: `AuthProvider` inside `PaperProvider`, so the
				    portal escapes it — `CardEditSheet` reads the uid above. */}
				<AuthProvider>
					<CardEditSheet
						visible
						card={null}
						scope="home"
						members={[]}
						locations={[]}
						onDismiss={() => {}}
						onSave={onSave}
					/>
				</AuthProvider>
			</Provider>
		</SafeAreaProvider>,
	);

describe("CardEditSheet", () => {
	/**
	 * #229 closed: a blank card plus one tap on *Färdiga* is the whole
	 * Recently done card — the mode selector seeds the window, the order and
	 * the empty state, and Save writes exactly what the seed carries.
	 */
	it("turns a blank card into Recently done with one tap on Färdiga", () => {
		const onSave = jest.fn();
		renderSheet(onSave);

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
		renderSheet();

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
		renderSheet(onSave);

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

	it("a row's clear takes that field off and leaves the rest standing", () => {
		const onSave = jest.fn();
		renderSheet(onSave);

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
		renderSheet(onSave);

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

	it("says what each mode collects", () => {
		renderSheet();

		expect(
			screen.getByText("overview.cards.editor.mode.openDescription"),
		).toBeTruthy();
		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));
		expect(
			screen.getByText("overview.cards.editor.mode.doneDescription"),
		).toBeTruthy();
	});

	it("says where each scope stores the card, all three of them", () => {
		renderSheet();

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
