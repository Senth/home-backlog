import { fireEvent, render, screen } from "@testing-library/react-native";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-native-paper";
import OverviewEditor from "@/app/(app)/overview-editor";
import en from "@/i18n/locales/en-US.json";
import sv from "@/i18n/locales/sv-SE.json";
import { type EditorCard, seedCards } from "@/models/overview-cards";
import { lightTheme } from "@/theme";

const mockPush = jest.fn();
let mockHomeName = "Huset";
let mockLoading = false;
let mockFailed = false;
const cards = seedCards();
const mockEditorCards: EditorCard[] = [
	{ card: cards.ongoing, scope: "global", hidden: false },
	{ card: cards.comingUp, scope: "home", hidden: false },
	{ card: cards.recentlyDone, scope: "shared", hidden: true },
];

jest.mock("expo-router", () => ({
	useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "me" } }),
}));
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({
		activeHome: { id: "home", name: mockHomeName, members: {}, labels: [] },
	}),
}));
jest.mock("@/contexts/DashboardCardsContext", () => ({
	useDashboardCardsConfig: () => ({
		editorCards: mockEditorCards,
		hiddenSharedIds: ["recentlyDone"],
		loading: mockLoading,
		failed: mockFailed,
		retry: jest.fn(),
	}),
}));
jest.mock("@/hooks/use-locations", () => ({
	useLocations: () => ({ locations: [] }),
}));
jest.mock("@/data/cards", () => ({ saveHiddenShared: jest.fn() }));
jest.mock("@/components/overview/use-card-writes", () => ({
	useCardWrites: () => ({}),
}));
jest.mock("@/components/overview/use-card-list-drag", () => ({
	listKey: "list",
	rowKey: (id: string) => id,
	useCardListDrag: ({ cards }: { cards: { id: string; rank: string }[] }) => ({
		order: cards,
		draggedId: null,
		gapIndex: null,
		register: () => () => {},
		handlers: () => null,
	}),
}));

async function renderEditor(language: string) {
	const i18n = createInstance();
	await i18n.init({
		lng: language,
		resources: { "en-US": { translation: en }, "sv-SE": { translation: sv } },
		interpolation: { escapeValue: false },
	});
	return render(
		<I18nextProvider i18n={i18n}>
			<Provider theme={lightTheme}>
				<OverviewEditor />
			</Provider>
		</I18nextProvider>,
	);
}

beforeEach(() => {
	mockHomeName = "Huset";
	mockLoading = false;
	mockFailed = false;
});

it.each([
	[
		"en-US",
		en,
		"Only me · every home",
		"Only me · Huset",
		"Everyone in Huset · Hidden",
	],
	[
		"sv-SE",
		sv,
		"Bara jag · alla hem",
		"Bara jag · Huset",
		"Alla i Huset · Dold",
	],
])(
	"explains scope in %s and still opens cards",
	async (language, locale, global, home, shared) => {
		await renderEditor(language);
		expect(
			screen.getByText(
				locale.overview.cards.editor.intro.replace("{{home}}", "Huset"),
			),
		).toBeTruthy();
		for (const subtitle of [global, home, shared]) {
			expect(screen.getByText(subtitle)).toBeTruthy();
		}
		fireEvent.press(screen.getByTestId("overview-editor-card-recentlyDone"));
		expect(mockPush).toHaveBeenCalledWith(
			"/overview-card-edit?cardId=recentlyDone",
		);
	},
);

it.each(["loading", "failed"])(
	"does not show intro while %s",
	async (state) => {
		mockLoading = state === "loading";
		mockFailed = state === "failed";
		await renderEditor("en-US");
		expect(screen.queryByText(/These are your cards/)).toBeNull();
	},
);

it("names the active home rather than a fixed home", async () => {
	mockHomeName = "Stugan";
	await renderEditor("en-US");
	expect(screen.getByText("Only me · Stugan")).toBeTruthy();
	expect(screen.getByText("Everyone in Stugan · Hidden")).toBeTruthy();
	expect(screen.getByText(/shared with everyone in Stugan/)).toBeTruthy();
});
