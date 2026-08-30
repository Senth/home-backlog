import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Button,
	FAB,
	List,
	Text,
} from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { boardHref, detailsHref } from "@/components/board/board-href";
import { DueChip } from "@/components/board/DueChip";
import { MetaChip } from "@/components/board/MetaChip";
import { TitleDialog } from "@/components/board/TitleDialog";
import { useWaitingMark } from "@/components/board/waiting-mark";
import { BackAction } from "@/components/ui/BackAction";
import { InstallCard } from "@/components/ui/InstallCard";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { createNode } from "@/data/nodes";
import { useDashboardCards } from "@/hooks/use-dashboard-cards";
import { useOverview } from "@/hooks/use-overview";
import { dueState } from "@/models/due-date";
import { hasSteps, type Node, rankAtEnd } from "@/models/node";
import { recentlyDone } from "@/models/overview";
import { type Card, cardRows, seedTitleKeys } from "@/models/overview-cards";
import { useAppTheme } from "@/theme";
import {
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
 * Every read is `useOverview` or `useDashboardCards`; this file opens no
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
	const {
		cards,
		loading: configLoading,
		failed: configFailed,
		retry: retryConfig,
	} = useDashboardCards(homeId);

	// What a row resolves its waiting mark against: statuses already in hand —
	// every root, and the whole pool. No new listener anywhere; a blocker
	// absent from the map keeps its card waiting, the same not-yet direction
	// the board and the detail screen take.
	const blockers = new Map<string, Node | null>();
	for (const node of [...roots, ...pool.nodes, ...done.nodes]) {
		blockers.set(node.id, node);
	}

	const [adding, setAdding] = useState(false);
	const [fabHeight, setFabHeight] = useState(0);

	// Measured, not assumed: the FAB names its action in words, so it is taller
	// in Swedish and taller again at 200% text. `space.xxl` is only the value for
	// the single frame before it has laid itself out — the same reserve the board
	// keeps under its own FAB.
	const fabInset = fabHeight > 0 ? fabHeight + space.md + space.md : space.xxl;

	const loading =
		roots.loading || pool.loading || done.loading || configLoading;
	const failed = roots.failed || pool.failed || done.failed || configFailed;

	// Not while anything failed: "add the first project" and "could not load" are
	// contradictory instructions, and only one of them is true.
	//
	// And not while the home holds any open node at all. Seven empty cards are
	// not the same claim as an empty house: every project sitting in To do,
	// undated and with nothing finished this month empties them all, and so does
	// being on none of the household's roots. `boards-and-nodes.md` settled that
	// a "nothing here yet" a household can disprove is the kind of lie people
	// stop trusting a screen for, and Overview has no filter control to disprove
	// it with.
	const nothingAtAll =
		!loading &&
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
				card.kind === "completed"
					? recentlyDone(done.nodes, roots.nodes, uid, now)
					: cardRows(card, pool.nodes, {
							uid,
							now,
							roots: roots.nodes,
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

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
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
						{cards.map((card) => {
							if (card.kind === "filter" && pool.failed) return null;
							if (card.kind === "completed" && done.failed) return null;
							return (
								<CardSection
									key={card.id}
									card={card}
									rows={rows.get(card.id) ?? []}
									onOpen={open}
									blockers={blockers}
								/>
							);
						})}
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
				testID={newProjectDialogTestID}
			/>
		</View>
	);
}

const newProjectDialogTestID = "new-project-dialog";

interface CardSectionProps {
	card: Card;
	/** What the engine answered for this card, before the shown/max slice. */
	rows: Node[];
	onOpen: (node: Node) => void;
	/** What a row's waiting mark is resolved against. */
	blockers: ReadonlyMap<string, Node | null>;
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
 */
function CardSection({ card, rows, onOpen, blockers }: CardSectionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [expanded, setExpanded] = useState(false);

	const emptyLine = card.empty.mode === "say" ? t(card.empty.key) : undefined;
	if (rows.length === 0 && emptyLine === undefined) return null;

	// Rows held is the card's own ceiling, not the screen's: what sits above a
	// card can never empty it out, because nothing is shared between cards.
	const held = rows.slice(0, card.max);
	const shown = expanded ? held : held.slice(0, card.shown);
	const more = held.length - shown.length;

	return (
		<List.Section testID={`overview-section-${card.id}`}>
			<List.Subheader>
				{card.title ??
					(card.seedId !== null ? t(seedTitleKeys[card.seedId]) : card.id)}
			</List.Subheader>

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
				shown.map((node) => (
					<List.Item
						key={node.id}
						title={node.title}
						titleNumberOfLines={2}
						onPress={() => onOpen(node)}
						style={{ minHeight: touchTarget }}
						right={() => <RowMeta node={node} blockers={blockers} />}
					/>
				))
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
		</List.Section>
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

/**
 * The meta a row carries, which is the card face's own: the steps glyph on a
 * project that has children, the `DueChip` on one that is late or due soon —
 * the card's own component, so the two surfaces cannot disagree about what a
 * due date says or about the rule that says it in words rather than in colour
 * — and the waiting mark, so a blocked project answers "is anything on fire"
 * honestly here too.
 */
function RowMeta({
	node,
	blockers,
}: {
	node: Node;
	blockers: ReadonlyMap<string, Node | null>;
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const due = dueState(node.dueDate, new Date());
	const showDue = node.dueDate !== null && (due === "late" || due === "soon");
	// The same derivation the card face makes — the shared `useWaitingMark`,
	// so the two surfaces cannot disagree about when a card waits.
	const {
		isWaiting,
		label: waitingLabel,
		a11yLabel,
	} = useWaitingMark(node, blockers);

	if (!hasSteps(node) && !showDue && !isWaiting) return null;

	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
			<DueChip node={node} />
			{isWaiting ? (
				<MetaChip
					source="pause-circle-outline"
					color={theme.colors.warning}
					accessibilityLabel={a11yLabel}
				>
					{waitingLabel}
				</MetaChip>
			) : null}
			{hasSteps(node) ? (
				<MetaChip
					source="format-list-checks"
					accessibilityLabel={t("detail.stepsDone", {
						done: node.doneCount,
						total: node.childCount,
					})}
				>
					{t("board.steps", {
						done: node.doneCount,
						total: node.childCount,
					})}
				</MetaChip>
			) : null}
		</View>
	);
}
