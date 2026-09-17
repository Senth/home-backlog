import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Button,
	FAB,
	Text,
} from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { BoardCard } from "@/components/board/BoardCard";
import { boardHref, detailsHref } from "@/components/board/board-href";
import { columnWidth } from "@/components/board/column-width";
import { TitleDialog } from "@/components/board/TitleDialog";
import { CardActionsMenu } from "@/components/overview/CardActionsMenu";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { BackAction } from "@/components/ui/BackAction";
import { InstallCard } from "@/components/ui/InstallCard";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardCardsConfig } from "@/contexts/DashboardCardsContext";
import { useHome } from "@/contexts/HomeContext";
import { deleteScopeCard, saveHiddenShared } from "@/data/cards";
import { createNode } from "@/data/nodes";
import { useLabelAncestors } from "@/hooks/use-label-ancestors";
import { useLocations } from "@/hooks/use-locations";
import { useOverview } from "@/hooks/use-overview";
import { effectiveLabels } from "@/models/label";
import {
	crumbTitlesOf,
	effectiveLocation,
	hasSteps,
	inheritedLocation,
	type Node,
	rankAtEnd,
} from "@/models/node";
import { type Card, cardRows, seedTitleKeys } from "@/models/overview-cards";
import { useAppTheme } from "@/theme";
import {
	border,
	cardGutterBreakpoint,
	compactBreakpoint,
	denseBreakpoint,
	fab as fabTokens,
	space,
	touchTarget,
} from "@/theme/tokens";

/**
 * What is going on, without opening a board: an ordered list of the home's
 * filter cards over one shared pool of open nodes, ending in what recently
 * got done.
 *
 * The first tab and the route the app opens on — a summary you have to navigate
 * to is a summary nobody reads. The app bar names the *home*, not the screen:
 * the tab bar already names the screen, and this is the highest-risk place in
 * the app for recording cabin work on the house board, with no breadcrumb to
 * lean on. No `BoardMenu`, because there is no filter here to toggle.
 *
 * Every read is `useOverview` or `useDashboardCardsConfig`; this file opens no
 * listener of its own, and renders every card through the one `CardSection`.
 */
export default function Overview() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();
	const { activeHome } = useHome();
	const { width } = useWindowDimensions();

	const homeId = activeHome?.id ?? null;
	const uid = user?.uid ?? null;
	const { roots, pool, done } = useOverview(homeId);
	const { locations } = useLocations(homeId);
	const {
		cards,
		scopes,
		hiddenSharedIds,
		loading: configLoading,
		failed: configFailed,
		retry: retryConfig,
	} = useDashboardCardsConfig();

	// What a row resolves everything against: nodes already in hand — every
	// root, the whole pool and the done window. No new listener anywhere; a
	// blocker absent from the map keeps its card waiting, the same not-yet
	// direction the board and the detail screen take. The same map answers a
	// row's path, and an ancestor it cannot answer renders as the hidden
	// crumb, exactly as the node's own breadcrumbs would.
	const nodesById = new Map<string, Node>();
	for (const node of [...roots.nodes, ...pool.nodes, ...done.nodes]) {
		nodesById.set(node.id, node);
	}

	// Every card's hide predicate asks this one map, so it is built once rather
	// than scanned per node. A root it cannot answer keeps that card hidden.
	const rootsById = new Map<string, Node>();
	for (const node of roots.nodes) {
		rootsById.set(node.id, node);
	}

	// The card face's location facts (#100): id → title, from the one listener
	// this screen holds.
	const locationTitles = new Map(locations.map((l) => [l.id, l.title]));

	// The labels a row inherits (#100). Overview draws cards from anywhere, so
	// their trails reach nodes no listener is holding — the pool pair answers
	// the ancestors it holds, and `useLabelAncestors` `getDoc`s the rest, one
	// cached read per id. A *done* project above a still-open card is the case
	// that exists for it. An ancestor nobody can answer contributes nothing,
	// the same neutral answer its crumb renders.
	const ancestorIds = [
		...new Set([...pool.nodes, ...done.nodes].flatMap((n) => n.ancestorIds)),
	];
	const ancestors = useLabelAncestors(homeId, ancestorIds, pool.nodes);

	// The place every pooled card answers to (#290): its own, or the nearest
	// one its trail passes down — what the location conditions filter on, so a
	// step under a filed project matches "in or under" that project's place.
	// `ancestors` already holds the trail by id; a crumb it cannot answer
	// contributes no place, the same neutral answer its crumb renders.
	const located = new Map(
		pool.nodes.map((node) => [
			node.id,
			effectiveLocation(
				node,
				node.ancestorIds.map((id) => ancestors.get(id) ?? null),
			),
		]),
	);

	// The labels every card's `labelIds` condition filters on (#100): own plus
	// everything the trail passes down, the list `effectiveLabels` resolves.
	// Done rows answer too — a done card is labelled like any other.
	const labelled = new Map(
		[...pool.nodes, ...done.nodes].map((node) => [
			node.id,
			effectiveLabels(
				node.labelIds,
				node.ancestorIds.flatMap((id) => ancestors.get(id)?.labelIds ?? []),
				activeHome?.labels ?? [],
			).map((label) => label.id),
		]),
	);

	// Above the breakpoint the sections flow and wrap, each a column the board
	// would recognize — the board's own dividing arithmetic, clamped at the
	// same two ends. Below it, one full-width stack as ever.
	const flowing = width >= compactBreakpoint;
	// The cards' gutters give their room back below `cardGutterBreakpoint`
	// (#100) — a 390px phone at 200% text is a 195px viewport, and there the
	// title outranks both gutters.
	const narrow = width < cardGutterBreakpoint;
	// A failed pair nulls its card's section, so the width divides by what
	// actually renders, not by what is configured.
	const sectionWidth = columnWidth(
		width,
		cards.filter(
			(card) =>
				!(card.kind === "open" && pool.failed) &&
				!(card.kind === "done" && done.failed),
		).length,
	);

	const [adding, setAdding] = useState(false);
	const [fabHeight, setFabHeight] = useState(0);
	/** The card whose *Remove* is waiting for its confirmation. */
	const [removing, setRemoving] = useState<Card | null>(null);

	// Measured, not assumed: the FAB names its action in words, so it is taller
	// in Swedish and taller again at 200% text. `space.xxl` is only the value for
	// the single frame before it has laid itself out — the same reserve the board
	// keeps under its own FAB.
	const fabInset = fabHeight > 0 ? fabHeight + space.md + space.md : space.xxl;

	// The spinner covers the screen only while nothing has answered at all:
	// a pair that has answered shows its section, and is not covered while
	// another pair is still being asked. The empty claim still waits for
	// every pair — "no nodes" from one is not the whole story while the
	// others are silent.
	const loading =
		roots.loading && pool.loading && done.loading && configLoading;
	const anyLoading =
		roots.loading || pool.loading || done.loading || configLoading;
	const failed = roots.failed || pool.failed || done.failed || configFailed;

	// Not while anything failed: "add the first project" and "could not load" are
	// contradictory instructions, and only one of them is true.
	//
	// And not while the home holds a root at all. Seven empty cards are not the
	// same claim as an empty house: every project sitting in To do, undated and
	// with nothing finished this month empties them all, and so does being on
	// none of the household's roots. A "nothing here yet" a household can
	// disprove is the kind of lie people stop trusting a screen for, and Overview
	// has no filter control to disprove it with. `roots` is every unarchived root
	// the pair returned — before the hide predicate, which is what makes the
	// second case say "nothing in progress" rather than "add the first project".
	const nothingAtAll =
		!anyLoading &&
		!failed &&
		roots.nodes.length === 0 &&
		pool.nodes.length === 0 &&
		done.nodes.length === 0;

	// Fresh every render, like a card face's own due chip — the point is a card
	// agreeing with its own heading at the moment it is looked at, not at the
	// moment its listener last fired.
	const now = new Date();
	const rows = new Map<string, Node[]>();
	if (uid !== null) {
		for (const card of cards) {
			rows.set(
				card.id,
				cardRows(card, card.kind === "done" ? done.nodes : pool.nodes, {
					uid,
					now,
					roots: rootsById,
					blockers: nodesById,
					locations: located,
					labels: labelled,
				}),
			);
		}
	}

	/**
	 * A tap goes where a board card's tap goes: the board once the project has a
	 * step in it, its details until then.
	 */
	const open = (node: Node) => {
		router.push(hasSteps(node) ? boardHref(node.id) : detailsHref(node.id));
	};

	/**
	 * The root board's own create: a project born with the whole household on it.
	 * Queued, never awaited — it is in Ongoing projects the moment Firestore
	 * applies it locally, and the write lands when the connection does.
	 *
	 * No column is named, the way the board's FAB names one: Overview does not
	 * show columns, so naming a destination would name something that is not on
	 * this screen.
	 */
	const add = (title: string) => {
		if (user === null || homeId === null) return;

		createNode(homeId, user.uid, {
			title,
			rank: rankAtEnd(roots.nodes.at(-1)?.rank ?? null),
			parent: null,
			status: "backlog",
			participantIds: Object.keys(activeHome?.members ?? {}),
		});
	};

	/** The roots pair is the one every card's hide predicate depends on. */
	const retryRoots = () => {
		roots.retry();
	};

	/**
	 * The editor, reached from the tune action or from a card's own menu. One
	 * screen owns every arrangement — neither entry is load-bearing for the
	 * other.
	 */
	const openEditor = () => {
		router.push("/overview-editor");
	};

	/**
	 * Hiding a shared card writes its id to the member's own dashboards doc —
	 * the card itself is never touched, so the household still sees it.
	 */
	const hideCard = (card: Card) => {
		if (uid === null || homeId === null) return;
		saveHiddenShared(homeId, uid, [...hiddenSharedIds, card.id]).catch(
			couldNotSave,
		);
	};

	/**
	 * Removing deletes: the card leaves its surface's map, or its shared
	 * document is deleted — one write either way, chosen in the data layer.
	 * A removed seed stays removable only in the sense the editor restores it
	 * — the seeds, not the member's own cards.
	 */
	const removeCard = (card: Card) => {
		const scope = scopes[card.id] ?? "global";
		if (uid === null || (scope !== "global" && homeId === null)) return;
		deleteScopeCard(
			scope,
			homeId,
			uid,
			card.id,
			cards.filter((each) => scopes[each.id] === scope),
		).catch(couldNotSave);
	};

	// Built once; in the flowing layout it is one wrapping row, in the stack it
	// is the column the screen has always been.
	const sections = cards.map((card) => {
		if (card.kind === "open" && pool.failed) return null;
		if (card.kind === "done" && done.failed) return null;
		return (
			<CardSection
				key={card.id}
				card={card}
				rows={rows.get(card.id) ?? []}
				onOpen={open}
				nodesById={nodesById}
				ancestors={ancestors}
				locations={locationTitles}
				narrow={narrow}
				width={flowing ? sectionWidth : null}
				menu={
					<CardActionsMenu
						testID={`overview-card-menu-${card.id}`}
						card={card}
						scope={scopes[card.id] ?? "global"}
						onEdit={openEditor}
						onHide={
							scopes[card.id] === "shared" ? () => hideCard(card) : undefined
						}
						onRemove={() => setRemoving(card)}
					/>
				}
			/>
		);
	});

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
				<Appbar.Action
					icon="tune"
					accessibilityLabel={t("overview.cards.editor.title")}
					style={{ width: touchTarget, height: touchTarget }}
					onPress={openEditor}
				/>
				<AccountMenu />
			</Appbar.Header>

			{/* Per-route proximity: this screen gets the air. `space.lg` between
			    the groups — the install offer and the cards — so Overview reads as
			    sections rather than one block; a board column keeps its own
			    density and gets no such gap. */}
			<ScrollView
				contentContainerStyle={{
					paddingBottom: fabInset,
					gap: space.lg,
				}}
			>
				{/* The install offer belongs on whatever the app opens on, and that is
				    now this screen — behind a tab tap it is never seen by the member
				    who never opens Projects. Inside the scroller rather than pinned
				    under the app bar: it renders only when the browser says an install
				    is possible, and when it does it should scroll away rather than
				    hold a phone's worth of height for a one-time offer. */}
				<InstallCard />

				{loading ? (
					<ActivityIndicator
						accessibilityLabel={t("common.loading")}
						style={{ marginTop: space.xl }}
					/>
				) : null}

				{nothingAtAll ? (
					<Text
						variant="bodyLarge"
						style={{
							color: theme.colors.onSurfaceVariant,
							textAlign: "center",
							padding: space.xl,
						}}
					>
						{t("overview.empty")}
					</Text>
				) : roots.failed ? (
					/* Said once, with one Try again: the roots pair feeds every
					   card's hide predicate, so when it fails every card would fail
					   with it — one failure reported as one, not as seven. */
					<LoadFailed onRetry={retryRoots} />
				) : configFailed ? (
					<LoadFailed onRetry={retryConfig} />
				) : (
					<>
						{pool.failed ? (
							/* One load failure for the whole pool: every filter card
							   reads the same pair, and five copies of the same sentence
							   over five retry buttons would be one failure reported as
							   five. The completed card reads the done pair and still
							   renders. */
							<LoadFailed onRetry={pool.retry} />
						) : null}
						{flowing ? (
							<View
								style={{
									flexDirection: "row",
									flexWrap: "wrap",
									// The same gutters `columnWidth` divides with — the pair
									// at the edges and the gaps between — so the sections
									// really are columns of the board's shape.
									gap: space.md,
									paddingHorizontal: space.md,
								}}
							>
								{sections}
							</View>
						) : (
							sections
						)}
						{done.failed ? (
							/* The done pair is the completed card's alone, so its failure
							   is said where that card would have been. */
							<LoadFailed
								onRetry={() => {
									roots.retry();
									done.retry();
								}}
							/>
						) : null}
					</>
				)}
			</ScrollView>

			{/* The same two footprint caps the board's FAB carries — a share of the
			    width it floats over, and the words over the glyph below
			    `denseBreakpoint` — so the claim about the FAB's room holds on the
			    screen Ingrid opens, not only on the board. */}
			<FAB
				icon={width < denseBreakpoint ? undefined : "plus"}
				label={t("overview.add")}
				onPress={() => setAdding(true)}
				onLayout={(event) => setFabHeight(event.nativeEvent.layout.height)}
				style={{
					position: "absolute",
					right: space.md,
					bottom: space.md,
					maxWidth: width * fabTokens.widthShare,
				}}
			/>

			<TitleDialog
				visible={adding}
				onDismiss={() => setAdding(false)}
				heading={t("overview.add")}
				confirmLabel={t("board.add")}
				onSubmit={add}
				testID="new-project-dialog"
			/>

			{removing !== null ? (
				<ConfirmDialog
					visible
					onDismiss={() => setRemoving(null)}
					onConfirm={() => {
						removeCard(removing);
						setRemoving(null);
					}}
					title={t("overview.cards.menu.removeTitle")}
					body={t("overview.cards.menu.removeBody")}
					confirmLabel={t("overview.cards.menu.remove")}
					destructive
					testID="overview-card-remove"
				/>
			) : null}
		</View>
	);
}

const couldNotSave = (reason: unknown) =>
	console.error("Could not save the cards:", reason);

interface CardSectionProps {
	card: Card;
	/** What the engine answered for this card, before the shown/max slice. */
	rows: Node[];
	onOpen: (node: Node) => void;
	/**
	 * Every node the screen holds, by id: what a row's waiting mark resolves
	 * against, and what its path resolves from — one map, both marks, no new
	 * read of anything.
	 */
	nodesById: ReadonlyMap<string, Node>;
	/**
	 * A row's ancestors, by id — the pool pair's answer for the ones it holds,
	 * a fetched one for the rest. What each row's inherited labels resolve
	 * from. See `useLabelAncestors`.
	 */
	ancestors: ReadonlyMap<string, Node | null>;
	/** Location id → title, the leaf. See `BoardCard`. */
	locations: ReadonlyMap<string, string>;
	/** Below `cardGutterBreakpoint` the cards give their gutters' room back. */
	narrow: boolean;
	/**
	 * The section's width above `compactBreakpoint`, `null` in the full-width
	 * stack. Non-null **is** the flowing layout, so the cards' `wide` — the
	 * title's tier — derives from it rather than riding along as a second
	 * prop that could disagree.
	 */
	width: number | null;
	/** The card's press menu — the per-card chrome, which appears on press. */
	menu: React.ReactNode;
}

/**
 * One heading and its rows — the one renderer every card goes through, seed
 * or composed.
 *
 * A card whose answer has not arrived renders nothing rather than a heading
 * over a gap: a heading with nothing under it is indistinguishable from an
 * empty card, and this screen holds several. Empty is a per-card decision —
 * mode `hide` renders nothing at all, mode `say` keeps the heading and says
 * one sentence — because a card you configured that vanishes reads as broken
 * config, and for several seeds an empty card is the good outcome.
 *
 * The rows are the board's own card face, not a second rendering of it: the
 * marks a row carries — due, waiting, steps, done — are drawn by `BoardCard`,
 * so this screen and a board cannot disagree about what a card says.
 */
function CardSection({
	card,
	rows,
	onOpen,
	nodesById,
	ancestors,
	locations,
	narrow,
	width,
	menu,
}: CardSectionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [expanded, setExpanded] = useState(false);
	const wide = width !== null;

	const emptyLine = card.empty.mode === "say" ? t(card.empty.key) : undefined;
	if (rows.length === 0 && emptyLine === undefined) return null;

	// Rows held is the card's own ceiling, not the screen's: what sits above a
	// card can never empty it out, because nothing is shared between cards.
	const held = rows.slice(0, card.max);
	const shown = expanded ? held : held.slice(0, card.shown);
	const more = held.length - shown.length;

	return (
		<View
			testID={`overview-section-${card.id}`}
			style={width === null ? undefined : { width }}
		>
			<View style={{ flexDirection: "row", alignItems: "center" }}>
				{/* The heading is the first thing read, per § 7, and a section
				    heading is titleMedium per § 4 — Paper's List.Subheader is a
				    muted bodyMedium that sits *below* the rows it names. */}
				<Text
					variant="titleMedium"
					style={{
						flex: 1,
						paddingHorizontal: space.md,
						paddingVertical: space.sm,
					}}
				>
					{card.title ??
						(card.seedId !== null ? t(seedTitleKeys[card.seedId]) : card.id)}
				</Text>
				{menu}
			</View>

			{/* The section's floor, inset to the cards' own padding so it lines
			    up with what sits under it — a boundary the stack and the flowing
			    layout both get, and the only reason a wrapped section reads as
			    one thing rather than a heading over loose cards. */}
			<View
				style={{
					height: border.hairline,
					backgroundColor: theme.colors.outlineVariant,
					marginHorizontal: space.md,
					marginBottom: space.sm,
				}}
			/>

			{rows.length === 0 ? (
				<Text
					variant="bodyMedium"
					style={{
						color: theme.colors.onSurfaceVariant,
						paddingHorizontal: space.md,
					}}
				>
					{emptyLine}
				</Text>
			) : (
				<View style={{ gap: space.sm }}>
					{shown.map((node) => (
						<BoardCard
							key={node.id}
							node={node}
							onOpen={() => onOpen(node)}
							blockers={nodesById}
							path={crumbTitlesOf(node, nodesById)}
							ancestorLabelIds={node.ancestorIds.flatMap(
								(id) => ancestors.get(id)?.labelIds ?? [],
							)}
							ancestorLocationId={inheritedLocation(
								node.ancestorIds.map((id) => ancestors.get(id) ?? null),
							)}
							locations={locations}
							wide={wide}
							narrow={narrow}
						/>
					))}
				</View>
			)}

			{/* Expands in place, from rows this screen already holds. There is no
			    cross-board dated screen to send anyone to, and inventing one is a
			    different issue. */}
			{more > 0 || expanded ? (
				<Button
					onPress={() => setExpanded(!expanded)}
					contentStyle={{ minHeight: touchTarget }}
					style={{ alignSelf: "flex-start" }}
				>
					{expanded ? t("overview.less") : t("overview.more", { count: more })}
				</Button>
			) : null}
		</View>
	);
}

/**
 * What a spent retry ladder looks like: what happened, and the way back.
 *
 * One component for every failure scope on this screen — the whole pool, the
 * done pair, the card config — because the sentence and the button are the
 * same; all that differs is what `onRetry` reopens.
 */
function LoadFailed({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	return (
		<View style={{ gap: space.sm, padding: space.md }}>
			<Text
				variant="bodyMedium"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{t("overview.loadFailed")}
			</Text>
			<Button
				mode="contained-tonal"
				icon="refresh"
				onPress={onRetry}
				contentStyle={{ minHeight: touchTarget }}
				style={{ alignSelf: "flex-start" }}
			>
				{t("common.retry")}
			</Button>
		</View>
	);
}
