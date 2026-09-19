import { renderHook } from "@testing-library/react-native";
import { useCardWrites } from "@/components/overview/use-card-writes";
import * as cards from "@/data/cards";
import type { Card, CardScope, EditorCard } from "@/models/overview-cards";

/**
 * The hook is the write half of the editor and the add/edit page: what each
 * call writes, to which surface, and the guards that write nothing. The data
 * layer itself is mocked — its Firestore shapes are `data/cards`'s own
 * business — and the rank math runs for real.
 */

jest.mock("@/contexts/AuthContext", () => {
	let currentUser: { uid: string } | null = { uid: "uid-me" };
	return {
		useAuth: () => ({ user: currentUser }),
		__setUser: (user: { uid: string } | null) => {
			currentUser = user;
		},
	};
});

jest.mock("@/contexts/HomeContext", () => {
	let currentHome: { activeHome: { id: string } | null } = {
		activeHome: { id: "home-1" },
	};
	return {
		useHome: () => currentHome,
		__setHome: (home: { activeHome: { id: string } | null }) => {
			currentHome = home;
		},
	};
});

jest.mock("@/contexts/DashboardCardsContext", () => {
	let currentCards: { editorCards: EditorCard[] } = { editorCards: [] };
	return {
		useDashboardCardsConfig: () => currentCards,
		__setCards: (cards: { editorCards: EditorCard[] }) => {
			currentCards = cards;
		},
	};
});

jest.mock("@/data/cards", () => ({
	saveScopeCards: jest.fn().mockResolvedValue(undefined),
	deleteScopeCard: jest.fn().mockResolvedValue(undefined),
	moveScopeCard: jest.fn().mockResolvedValue(undefined),
	newCardId: jest.fn().mockReturnValue("minted-id"),
}));

type AuthModule = {
	__setUser: (user: { uid: string } | null) => void;
};
type HomeModule = {
	__setHome: (home: { activeHome: { id: string } | null }) => void;
};
type CardsContextModule = {
	__setCards: (cards: { editorCards: EditorCard[] }) => void;
};

const authModule = jest.requireMock(
	"@/contexts/AuthContext",
) as unknown as AuthModule;
const homeModule = jest.requireMock(
	"@/contexts/HomeContext",
) as unknown as HomeModule;
const cardsContextModule = jest.requireMock(
	"@/contexts/DashboardCardsContext",
) as unknown as CardsContextModule;

function card(id: string, scope: CardScope, rank = "V0"): EditorCard {
	return {
		card: { id, rank } as Card,
		scope,
		hidden: false,
	};
}

function writesHook() {
	return renderHook(() => useCardWrites());
}

beforeEach(() => {
	jest.clearAllMocks();
	authModule.__setUser({ uid: "uid-me" });
	homeModule.__setHome({ activeHome: { id: "home-1" } });
	cardsContextModule.__setCards({
		editorCards: [card("a", "global", "V0"), card("b", "home", "V1")],
	});
});

describe("useCardWrites", () => {
	it("addTo appends the card to its own surface's list", () => {
		const added: Card = { id: "c", rank: "V2" } as Card;
		writesHook().result.current.addTo("home", added);

		expect(cards.saveScopeCards).toHaveBeenCalledWith(
			"home",
			"home-1",
			"uid-me",
			[expect.objectContaining({ id: "b" }), added],
		);
	});

	it("createIn mints the id and takes the last rank on the screen", () => {
		writesHook().result.current.createIn("global", { title: "New" } as Card);

		expect(cards.newCardId).toHaveBeenCalledWith("global", "home-1", "uid-me");
		expect(cards.saveScopeCards).toHaveBeenCalledWith(
			"global",
			"home-1",
			"uid-me",
			[
				expect.objectContaining({ id: "a", rank: "V0" }),
				expect.objectContaining({
					id: "minted-id",
					title: "New",
					rank: "V2",
				}),
			],
		);
	});

	it("replaceIn swaps the one card and leaves the rest standing", () => {
		const edited: Card = { id: "a", rank: "V0", title: "Renamed" } as Card;
		writesHook().result.current.replaceIn("global", edited);

		expect(cards.saveScopeCards).toHaveBeenCalledWith(
			"global",
			"home-1",
			"uid-me",
			[edited],
		);
	});

	it("removeFrom drops the one card", () => {
		writesHook().result.current.removeFrom("global", "a");

		expect(cards.deleteScopeCard).toHaveBeenCalledWith(
			"global",
			"home-1",
			"uid-me",
			"a",
			[expect.objectContaining({ id: "a" })],
		);
	});

	it("moveScope hands the batch the from-surface without the card, the to-surface as it is", () => {
		const moved: Card = { id: "a", rank: "V0" } as Card;
		writesHook().result.current.moveScope(moved, "global", "home");

		expect(cards.moveScopeCard).toHaveBeenCalledWith(
			moved,
			"global",
			"home",
			"home-1",
			"uid-me",
			[],
			[expect.objectContaining({ id: "b" })],
		);
	});

	it("no user, no write", () => {
		authModule.__setUser(null);
		writesHook().result.current.addTo("global", { id: "c" } as Card);

		expect(cards.saveScopeCards).not.toHaveBeenCalled();
	});

	it("a home-scoped card with no active home writes nothing; a global one still does", () => {
		homeModule.__setHome({ activeHome: null });

		const hook = writesHook();
		hook.result.current.addTo("home", { id: "c" } as Card);
		expect(cards.saveScopeCards).not.toHaveBeenCalled();

		hook.result.current.addTo("global", { id: "c" } as Card);
		expect(cards.saveScopeCards).toHaveBeenCalledWith("global", "", "uid-me", [
			expect.objectContaining({ id: "a" }),
			expect.objectContaining({ id: "c" }),
		]);
	});
});
