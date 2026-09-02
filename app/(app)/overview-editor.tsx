import { useRouter } from "expo-router";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Animated, ScrollView, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Button,
	List,
	Snackbar,
	Surface,
	Text,
} from "react-native-paper";
import { DragArea } from "@/components/board/DragArea";
import { CardActionsMenu } from "@/components/overview/CardActionsMenu";
import { CardEditSheet } from "@/components/overview/CardEditSheet";
import { ImportCardDialog } from "@/components/overview/ImportCardDialog";
import {
	listKey,
	rowKey,
	useCardListDrag,
} from "@/components/overview/use-card-list-drag";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { BackAction } from "@/components/ui/BackAction";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardCardsConfig } from "@/contexts/DashboardCardsContext";
import { useHome } from "@/contexts/HomeContext";
import {
	deleteScopeCard,
	moveScopeCard,
	newCardId,
	saveHiddenShared,
	saveScopeCards,
} from "@/data/cards";
import { useLocations } from "@/hooks/use-locations";
import { membersOf } from "@/models/home";
import { rankAtEnd, rankBetween } from "@/models/node";
import {
	type Card,
	type CardScope,
	type EditorCard,
	removedSeeds,
	seedTitleKeys,
} from "@/models/overview-cards";
import { useAppTheme } from "@/theme";
import {
	drag as dragTokens,
	elevation,
	radius,
	space,
	touchTarget,
} from "@/theme/tokens";

/**
 * The editor: every card on the screen, arranged.
 *
 * The list is the merged card set — global, this home, shared — with each
 * card's scope named on its row, drag to reorder in the same gesture the
 * boards use, and *Move up* / *Move down* in the card menu as the accessible
 * alternative. A shared card the member hid is listed too, badged, with
 * *Show for me* in its menu; the read screen is the only thing a hide
 * removes. Beneath the list, *Removed originals* lists the seeds the member
 * deleted, each restorable with its original settings.
 *
 * Every write is the data layer's own — a per-user surface is its whole cards
 * map rewritten, a shared card is its own document — so all of it queues
 * offline like any other write. Import is clipboard-local: the pasted string
 * is decoded before anything is written, and the card it makes is the
 * importer's own, in the scope they chose.
 */
export default function OverviewEditor() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();
	const { activeHome } = useHome();

	const homeId = activeHome?.id ?? null;
	const uid = user?.uid ?? null;
	// The provider's one set of card-config listeners, shared with the read
	// screen underneath — a second `useDashboardCards` here would double the
	// `dashboardCards` collection and both config docs against the budget.
	const { editorCards, hiddenSharedIds, loading, failed, retry } =
		useDashboardCardsConfig();
	// The location picker's vocabulary. One more listener while a card is
	// being composed or imported — bounded by the collection, and the spec's
	// listener table notes it.
	const { locations } = useLocations(homeId);

	const [editing, setEditing] = useState<{
		card: Card | null;
		scope: CardScope;
	} | null>(null);
	const [removing, setRemoving] = useState<EditorCard | null>(null);
	const [importing, setImporting] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const members = useMemo(
		() => (activeHome === null ? [] : membersOf(activeHome)),
		[activeHome],
	);

	const byId = useMemo(
		() => new Map(editorCards.map((entry) => [entry.card.id, entry])),
		[editorCards],
	);

	const couldNotSave = (reason: unknown) =>
		console.error("Could not save the cards:", reason);

	/** Every card stored on one surface, in the editor's order. */
	const surfaceCards = (scope: CardScope): Card[] =>
		editorCards
			.filter((entry) => entry.scope === scope)
			.map((entry) => entry.card);

	/**
	 * The ids a write on this surface needs, or `null` when there is nothing
	 * to write to: no uid, or no active home for a scope that lives in one.
	 * `homes//dashboards/{uid}` is not a path Firestore declines politely —
	 * it is a synchronous crash — so the guard runs before any reference is
	 * built, which is what a deep link to a homeless editor needs.
	 */
	const idsFor = (scope: CardScope): { homeId: string; uid: string } | null => {
		if (uid === null) return null;
		if (scope !== "global" && homeId === null) return null;
		return { homeId: homeId ?? "", uid };
	};

	const addTo = (scope: CardScope, card: Card) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		saveScopeCards(scope, ids.homeId, ids.uid, [
			...surfaceCards(scope),
			card,
		]).catch(couldNotSave);
	};

	const removeFrom = (scope: CardScope, id: string) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		deleteScopeCard(scope, ids.homeId, ids.uid, id, surfaceCards(scope)).catch(
			couldNotSave,
		);
	};

	/** An edit or a reorder that stays on its own surface. */
	const replaceIn = (scope: CardScope, card: Card) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		saveScopeCards(
			scope,
			ids.homeId,
			ids.uid,
			surfaceCards(scope).map((each) => (each.id === card.id ? card : each)),
		).catch(couldNotSave);
	};

	/** Scope is where the card is stored, so changing scope moves the card. */
	const moveScope = (card: Card, from: CardScope, to: CardScope) => {
		const fromIds = idsFor(from);
		const toIds = idsFor(to);
		if (fromIds === null || toIds === null) return;
		moveScopeCard(
			card,
			from,
			to,
			toIds.homeId,
			toIds.uid,
			surfaceCards(from).filter((each) => each.id !== card.id),
			surfaceCards(to),
		).catch(couldNotSave);
	};

	/**
	 * A card the editor just composed or imported: minted here so a later
	 * scope move keeps it, and it takes the last place on the screen.
	 */
	const createIn = (scope: CardScope, draft: Omit<Card, "id" | "rank">) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		addTo(scope, {
			...draft,
			id: newCardId(scope, ids.homeId, ids.uid),
			rank: rankAtEnd(editorCards.at(-1)?.card.rank ?? null),
		});
	};

	const save = (draft: Card, scope: CardScope) => {
		if (editing === null) return;

		if (editing.card === null) {
			createIn(scope, draft);
			return;
		}

		if (editing.scope === scope) replaceIn(scope, draft);
		else moveScope(draft, editing.scope, scope);
	};

	const restore = (seed: Card) => {
		addTo("global", {
			...seed,
			rank: rankAtEnd(editorCards.at(-1)?.card.rank ?? null),
		});
	};

	/** The pasted string, decoded and added as the importer's own. */
	const importInto = (draft: Omit<Card, "id" | "rank">, scope: CardScope) => {
		createIn(scope, draft);
		setNotice("overview.cards.editor.importAdded");
	};

	const reorder = (id: string, rank: string) => {
		const entry = byId.get(id);
		if (entry !== undefined) replaceIn(entry.scope, { ...entry.card, rank });
	};

	const moveUp = (entry: EditorCard) => {
		const index = editorCards.findIndex(
			(each) => each.card.id === entry.card.id,
		);
		const above = editorCards[index - 1];
		if (above !== undefined) {
			replaceIn(entry.scope, {
				...entry.card,
				rank: rankBetween(
					editorCards[index - 2]?.card.rank ?? null,
					above.card.rank,
				),
			});
		}
	};

	const moveDown = (entry: EditorCard) => {
		const index = editorCards.findIndex(
			(each) => each.card.id === entry.card.id,
		);
		const below = editorCards[index + 1];
		if (below !== undefined) {
			replaceIn(entry.scope, {
				...entry.card,
				rank: rankBetween(
					below.card.rank,
					editorCards[index + 2]?.card.rank ?? null,
				),
			});
		}
	};

	const setSharedHidden = (entry: EditorCard, hidden: boolean) => {
		if (uid === null || homeId === null) return;
		const next = hidden
			? hiddenSharedIds.filter((id) => id !== entry.card.id)
			: [...hiddenSharedIds, entry.card.id];
		saveHiddenShared(homeId, uid, next).catch(couldNotSave);
	};

	const drag = useCardListDrag({
		cards: editorCards.map((entry) => ({
			id: entry.card.id,
			rank: entry.card.rank,
		})),
		onMove: reorder,
	});

	// The frozen order while a card is up, the live one otherwise — the same
	// freeze the board keeps, for the same reason: a card arriving mid-drag
	// must not move the gap out from under the finger.
	const frozen = drag.order
		.map((card) => byId.get(card.id))
		.filter((entry): entry is EditorCard => entry !== undefined);

	// The card in flight is drawn at screen level, following the finger — but
	// its own row **stays mounted**, flattened to nothing. The gesture belongs
	// to that row, and a row unmounted mid-drag takes the pointer capture with
	// it: the card lifts and then never moves again. The slot counting skips
	// the flattened row, which is what the drop model counts too.
	const positionOf = new Map<string, number>();
	let next = 0;
	for (const entry of frozen) {
		if (entry.card.id !== drag.draggedId) {
			positionOf.set(entry.card.id, next);
			next++;
		}
	}
	const visibleCount = positionOf.size;

	let slot = 0;
	const rows = frozen.map((entry) => {
		const held = entry.card.id === drag.draggedId;
		const row = { entry, held, gapBefore: !held && slot === drag.gapIndex };
		if (!held) slot++;
		return row;
	});

	const removed = removedSeeds(editorCards.map((entry) => entry.card));

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={t("common.done")}
					onPress={() => router.back()}
				/>
				<Appbar.Content title={t("overview.cards.editor.title")} />
				<Appbar.Action
					icon="import"
					accessibilityLabel={t("overview.cards.editor.import")}
					style={{ width: touchTarget, height: touchTarget }}
					onPress={() => setImporting(true)}
				/>
				<Appbar.Action
					icon="plus"
					accessibilityLabel={t("overview.cards.editor.add")}
					style={{ width: touchTarget, height: touchTarget }}
					onPress={() => setEditing({ card: null, scope: "global" })}
				/>
			</Appbar.Header>

			{loading ? (
				<ActivityIndicator
					accessibilityLabel={t("common.loading")}
					style={{ marginTop: space.xl }}
				/>
			) : failed ? (
				<View style={{ gap: space.md, padding: space.md }}>
					<Text
						variant="bodyMedium"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("overview.loadFailed")}
					</Text>
					<Button
						mode="contained-tonal"
						icon="refresh"
						onPress={retry}
						contentStyle={{ minHeight: touchTarget }}
						style={{ alignSelf: "flex-start" }}
					>
						{t("common.retry")}
					</Button>
				</View>
			) : (
				<ScrollView
					style={{ flex: 1 }}
					contentContainerStyle={{ paddingBottom: space.xl }}
				>
					<View
						ref={drag.register(listKey)}
						collapsable={false}
						style={{ gap: space.sm, padding: space.md }}
					>
						{rows.map(({ entry, held, gapBefore }) => (
							<Fragment key={entry.card.id}>
								{gapBefore ? <View style={{ height: drag.gapHeight }} /> : null}
								<EditorRow
									entry={entry}
									held={held}
									position={positionOf.get(entry.card.id) ?? -1}
									count={visibleCount}
									handlers={drag.handlers(entry.card.id)}
									register={drag.register}
									onEdit={(target) =>
										setEditing({ card: target.card, scope: target.scope })
									}
									onMoveUp={moveUp}
									onMoveDown={moveDown}
									onHide={(target) => setSharedHidden(target, false)}
									onShow={(target) => setSharedHidden(target, true)}
									onRemove={setRemoving}
								/>
							</Fragment>
						))}
						{drag.draggedId !== null &&
						drag.gapIndex !== null &&
						drag.gapIndex >= slot ? (
							<View style={{ height: drag.gapHeight }} />
						) : null}
					</View>

					{removed.length > 0 ? (
						<List.Section testID="overview-editor-removed">
							{/* A section heading is titleMedium per DESIGN § 4 — the
					    same swap the Overview card headings took. */}
							<Text
								variant="titleMedium"
								style={{
									paddingHorizontal: space.md,
									paddingVertical: space.sm,
								}}
							>
								{t("overview.cards.editor.removed")}
							</Text>
							{removed.map((seed) => (
								<List.Item
									key={seed.id}
									title={
										seed.seedId !== null
											? t(seedTitleKeys[seed.seedId])
											: seed.id
									}
									// The row's one action is the restore itself; the button
									// beside it is the same action named, and without a handler
									// on the row Paper would report the whole row disabled.
									onPress={() => restore(seed)}
									right={() => (
										<Button
											onPress={() => restore(seed)}
											contentStyle={{ minHeight: touchTarget }}
										>
											{t("overview.cards.editor.restore")}
										</Button>
									)}
								/>
							))}
						</List.Section>
					) : null}
				</ScrollView>
			)}

			{/* The card itself, off the list and under the hand — the board's own
			    overlay, over the same frozen list and gap. */}
			{drag.draggedId !== null && drag.overlay !== null ? (
				<Animated.View
					style={{
						position: "absolute",
						pointerEvents: "none",
						left: drag.overlay.left,
						top: drag.overlay.top,
						width: drag.overlay.width,
						transform: [
							{ translateX: drag.offset.x },
							{ translateY: drag.offset.y },
							{ scale: dragTokens.lift },
						],
					}}
				>
					<Surface
						elevation={elevation.high}
						style={{
							backgroundColor: theme.colors.surface,
							borderRadius: radius.md,
						}}
					>
						<EditorRow
							entry={byId.get(drag.draggedId) as EditorCard}
							held={false}
							position={-1}
							count={visibleCount}
							handlers={null}
							register={drag.register}
							onEdit={() => {}}
							onMoveUp={() => {}}
							onMoveDown={() => {}}
							onHide={() => {}}
							onShow={() => {}}
							onRemove={() => {}}
						/>
					</Surface>
				</Animated.View>
			) : null}

			{editing !== null ? (
				<CardEditSheet
					visible
					card={editing.card}
					scope={editing.scope}
					members={members}
					locations={locations}
					onDismiss={() => setEditing(null)}
					onSave={save}
				/>
			) : null}

			{importing ? (
				<ImportCardDialog
					visible
					members={members}
					locations={locations}
					onDismiss={() => setImporting(false)}
					onAdd={importInto}
				/>
			) : null}

			<Snackbar visible={notice !== null} onDismiss={() => setNotice(null)}>
				{notice === null ? "" : t(notice)}
			</Snackbar>

			{removing !== null ? (
				<ConfirmDialog
					visible
					onDismiss={() => setRemoving(null)}
					onConfirm={() => {
						removeFrom(removing.scope, removing.card.id);
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

interface EditorRowProps {
	entry: EditorCard;
	/** The row in flight, flattened to nothing so its gesture stays alive. */
	held: boolean;
	/** Where the row sits among the others, `-1` in the overlay. */
	position: number;
	/** How many rows a move can count, the held one excluded. */
	count: number;
	/** The card's own gesture callbacks, `null` in the overlay. */
	handlers: {
		onGrab: (point: { x: number; y: number }) => void;
		onMove: (point: { x: number; y: number }) => void;
		onDrop: () => void;
		onCancel: () => void;
	} | null;
	register: (key: string) => (view: View | null) => void;
	onEdit: (entry: EditorCard) => void;
	onMoveUp: (entry: EditorCard) => void;
	onMoveDown: (entry: EditorCard) => void;
	onHide: (entry: EditorCard) => void;
	onShow: (entry: EditorCard) => void;
	onRemove: (entry: EditorCard) => void;
}

/**
 * One row of the editor: the card's name, its scope named under it — plus
 * *Hidden* when this member hid the shared card — and the menu. Long-press
 * lifts it; the menu moves it, which is the path a screen reader takes.
 */
function EditorRow({
	entry,
	held,
	position,
	count,
	handlers,
	register,
	onEdit,
	onMoveUp,
	onMoveDown,
	onHide,
	onShow,
	onRemove,
}: EditorRowProps) {
	const { t } = useTranslation();
	const { card, scope, hidden } = entry;

	const row = (
		<View
			collapsable={false}
			ref={handlers === null ? undefined : register(rowKey(card.id))}
			style={
				held
					? {
							height: space.none,
							opacity: 0,
							overflow: "hidden",
						}
					: undefined
			}
		>
			<List.Item
				testID={`overview-editor-card-${card.id}`}
				title={
					card.title ??
					(card.seedId !== null ? t(seedTitleKeys[card.seedId]) : card.id)
				}
				titleNumberOfLines={2}
				description={`${t(`overview.cards.editor.scope.${scope}`)}${
					hidden ? ` · ${t("overview.cards.editor.hiddenBadge")}` : ""
				}`}
				style={{ minHeight: touchTarget }}
				// The row's one action is the editor for that card — and it is what
				// keeps the row a real pressable: Paper's TouchableRipple reports a
				// pressable with no handler as disabled, and an aria-disabled row
				// disables its own menu for every assistive technology with it.
				onPress={() => onEdit(entry)}
				right={() => (
					<CardActionsMenu
						testID={`overview-editor-menu-${card.id}`}
						card={card}
						scope={scope}
						hidden={hidden}
						showMove={handlers !== null}
						moveDisabled={held}
						canMoveUp={position > 0}
						canMoveDown={position >= 0 && position < count - 1}
						onEdit={() => onEdit(entry)}
						onMoveUp={() => onMoveUp(entry)}
						onMoveDown={() => onMoveDown(entry)}
						onHide={() => onHide(entry)}
						onShow={() => onShow(entry)}
						onRemove={() => onRemove(entry)}
					/>
				)}
			/>
		</View>
	);

	return handlers === null ? (
		row
	) : (
		<DragArea
			onGrab={handlers.onGrab}
			onMove={handlers.onMove}
			onDrop={handlers.onDrop}
			onCancel={handlers.onCancel}
		>
			{row}
		</DragArea>
	);
}
