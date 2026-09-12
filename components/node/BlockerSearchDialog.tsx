import { getDocsFromServer } from "firebase/firestore";
import { Fragment, type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ActivityIndicator, Icon, Text, TextInput } from "react-native-paper";
import { MetaChip } from "@/components/board/MetaChip";
import { AppSheet } from "@/components/ui/AppSheet";
import { CheckRow } from "@/components/ui/CheckRow";
import { participatingPickerQuery, sharedPickerQuery } from "@/data/nodes";
import { cachedNode } from "@/hooks/use-ancestors";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
	type Node,
	pickerCandidates,
	siblingCandidates,
	toNode,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, space } from "@/theme/tokens";

/** A pause between keystrokes, not a number anybody tunes per screen. */
const searchDebounceMs = 300;
/** Below this the home-wide search would answer everything and nothing. */
const minQueryLength = 2;

interface BlockerSearchDialogProps {
	homeId: string;
	/** The searcher — Q-S2 needs the uid. `null` reads as offline. */
	uid: string | null;
	/** The card picking a blocker. It is never its own candidate. */
	node: Node;
	/**
	 * The cards sharing this card's board — the board's own `useNodes`
	 * listener (#237), held by the screen and passed down rather than heard
	 * twice. This group works offline, where the home-wide search cannot.
	 */
	siblings: readonly Node[];
	/**
	 * What a chosen blocker's title is read from — the owner's reads, handed
	 * down: this sheet renders inside a portal, above the auth context, and
	 * the reads are already running for the waiting-on row.
	 */
	blockers: ReadonlyMap<string, Node | null>;
	onDismiss: () => void;
	onPick: (id: string) => void;
	onUnpick: (id: string) => void;
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * The *Waiting on…* picker (#237 PK2) — the waiting-on editor and the search
 * in one sheet, shared by the waiting-on row and the card menu. It opens on
 * **the cards sharing this board**, under *On this board*, with *Everywhere
 * else* below; both headings stay while searching, and a group with results
 * is never hidden.
 *
 * Picked rows always show, ticked, ahead of their group's candidates —
 * the tick is the only thing that changes when you act, and a wait must be
 * takeable back off without clearing the search first. On-board rows are one
 * line, because the heading already says the board; rows from elsewhere
 * carry their trail, because there it is the whole answer. A picked blocker
 * that has since completed keeps its *Done* chip. A candidate that is
 * itself waiting on this card carries a warning chip (#183) — the cycle
 * is permitted, and the chip is its only guard.
 *
 * Typing still searches the whole home through the one-shot
 * `getDocsFromServer` pair (Q-S1/Q-S2 in `data/nodes.ts`) and their dedupe —
 * the provably-safe pair, fired debounced on a settled query of at least two
 * characters, once per settled query, no listener anywhere. `models/node`'s
 * `pickerCandidates` merges, dedupes, title-filters and caps the pair, and
 * says when the cap was hit so the search can admit what it may have missed.
 * Picking writes at once, from the board's own data when the card is a
 * sibling — no round trip through search.
 */
export function BlockerSearchDialog({
	homeId,
	uid,
	node,
	siblings,
	blockers,
	onDismiss,
	onPick,
	onUnpick,
	testID,
	returnFocusTo,
}: BlockerSearchDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();

	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Node[]>([]);
	const [rawCount, setRawCount] = useState(0);
	const [capped, setCapped] = useState(false);
	const [searching, setSearching] = useState(false);

	// The typed text settles into a query. Resetting the timer on every change
	// is the debounce: one server round per pause in typing.
	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim()), searchDebounceMs);
		return () => clearTimeout(timer);
	}, [text]);

	useEffect(() => {
		// `online` is in the guard, not only in `canSearch`: going offline
		// inside the debounce window would otherwise fire the server read and
		// draw its rejection. Offline the picker's own hint is the answer —
		// the on-board group above it keeps working from the listener.
		if (uid === null || !online || query.length < minQueryLength) {
			setResults([]);
			setRawCount(0);
			setCapped(false);
			setSearching(false);
			return;
		}

		let cancelled = false;
		setSearching(true);

		Promise.all([
			getDocsFromServer(sharedPickerQuery(homeId)),
			getDocsFromServer(participatingPickerQuery(homeId, uid)),
		])
			.then(([shared, participating]) => {
				if (cancelled) return;
				const found = pickerCandidates(
					query,
					node,
					node.blockedBy,
					shared.docs.map(toNode),
					participating.docs.map(toNode),
				);
				setResults(found.results);
				setRawCount(found.rawCount);
				setCapped(found.capped);
			})
			.catch((reason) => {
				console.error("Could not search the home for cards:", reason);
				if (!cancelled) setResults([]);
			})
			.finally(() => {
				if (!cancelled) setSearching(false);
			});

		return () => {
			cancelled = true;
		};
	}, [homeId, uid, online, query, node]);

	const settled = text.trim().length > 0;
	const picked = node.blockedBy;

	// Picked first, ticked; then what the board may still offer. A sibling's
	// state is in hand, so its *Done* chip needs no read of its own.
	const onBoard = [
		...siblings.filter((sibling) => picked.includes(sibling.id)),
		...siblingCandidates(text.trim(), node, picked, siblings),
	];

	const siblingIds = new Set(siblings.map((sibling) => sibling.id));
	const elsewherePicked = picked.filter((id) => !siblingIds.has(id));
	const elsewhereFound = results.filter((result) => !siblingIds.has(result.id));
	const elsewhereCount = elsewherePicked.length + elsewhereFound.length;

	const toggle = (id: string) => {
		if (picked.includes(id)) {
			onUnpick(id);
			return;
		}
		onPick(id);
	};

	const doneChip = <MetaChip>{t("detail.blockerDone")}</MetaChip>;
	// A cycle is permitted and rendered (#183): the chip warns, the pick still
	// lands. Best-effort by construction — it fires only when the candidate's
	// own `blockedBy` is in hand, which a sibling row and a search hit both are.
	const cycleChip = (
		<MetaChip source="alert" color={theme.colors.warning}>
			{t("detail.blockerCycle")}
		</MetaChip>
	);

	return (
		<AppSheet
			visible
			onDismiss={onDismiss}
			testID={testID}
			returnFocusTo={returnFocusTo}
		>
			<View style={{ gap: space.md }}>
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					<Text variant="titleMedium" style={{ flex: 1 }}>
						{t("detail.waitingOn")}
					</Text>
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("detail.pickedCount", { count: picked.length })}
					</Text>
				</View>

				<TextInput
					mode="flat"
					label={t("detail.waitingSearchPlaceholder")}
					value={text}
					onChangeText={setText}
					left={<TextInput.Icon icon="magnify" />}
					autoFocus
				/>

				{searching ? (
					<ActivityIndicator accessibilityLabel={t("common.loading")} />
				) : null}

				{onBoard.length > 0 || settled ? (
					<View style={{ gap: space.xs }}>
						<Text
							variant="labelLarge"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("board.waitingGroupBoard")}
						</Text>
						{onBoard.map((sibling) => (
							<CheckRow
								key={sibling.id}
								label={sibling.title}
								checked={picked.includes(sibling.id)}
								right={
									picked.includes(sibling.id)
										? sibling.status === "done"
											? doneChip
											: null
										: sibling.blockedBy.includes(node.id)
											? cycleChip
											: null
								}
								onPress={() => toggle(sibling.id)}
							/>
						))}
					</View>
				) : null}

				{elsewhereCount > 0 || settled ? (
					<View style={{ gap: space.xs }}>
						<Text
							variant="labelLarge"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("board.waitingGroupEverywhere")}
						</Text>
						{elsewherePicked.map((id) => {
							// Unanswered holds its row — the same not-yet direction the
							// waiting-on row takes. `null` is a read that came back gone.
							const blocker = blockers.get(id);
							const title =
								blocker === undefined
									? t(online ? "common.loading" : "board.offlineHint")
									: (blocker?.title ?? t("detail.blockerGone"));

							return (
								<View key={id}>
									<CheckRow
										label={title}
										checked
										right={blocker?.status === "done" ? doneChip : null}
										onPress={() => toggle(id)}
									/>
									{blocker ? (
										<PickerTrail
											homeId={homeId}
											uid={uid}
											ids={blocker.ancestorIds}
										/>
									) : null}
								</View>
							);
						})}
						{elsewhereFound.map((result) => (
							<View key={result.id}>
								<CheckRow
									label={result.title}
									checked={false}
									right={result.blockedBy.includes(node.id) ? cycleChip : null}
									onPress={() => toggle(result.id)}
								/>
								<PickerTrail
									homeId={homeId}
									uid={uid}
									ids={result.ancestorIds}
								/>
							</View>
						))}
					</View>
				) : null}

				{/* An answer only when one was asked: not while the search is in
			    flight, and not below `minQueryLength`, where the home-wide
			    search would answer everything and nothing. Offline nothing was
			    asked either, so "no cards match" would be a lie dressed as an
			    answer. */}
				{!searching &&
				settled &&
				text.trim().length >= minQueryLength &&
				onBoard.length === 0 &&
				elsewhereCount === 0 ? (
					<Text
						variant="bodyMedium"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{online ? t("detail.waitingSearchEmpty") : t("board.offlineHint")}
					</Text>
				) : null}

				{/* On `capped` alone: the cap is measured on the raw hits, so all
				    fifty can filter away and leave "no cards match" — the picker
				    must still admit what the search may have missed. The count is
				    the raw hits too: what the search saw, not what survived. */}
				{capped ? (
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("detail.waitingSearchCapped", { count: rawCount })}
					</Text>
				) : null}
			</View>
		</AppSheet>
	);
}

/**
 * The trail under a row from elsewhere — muted `bodySmall`, chevron-separated
 * the way every trail in the app draws itself, and never a link: the picker's
 * job is to pick, and its rows are the surface.
 *
 * One `cachedNode` per crumb, the session memo `useAncestors` reads through —
 * so a trail already resolved anywhere this session costs nothing. The reads
 * run here rather than through `useAncestors` because the sheet's portal sits
 * above the auth context (#237): the uid arrives as a prop, or there is no
 * trail.
 */
function PickerTrail({
	homeId,
	uid,
	ids,
}: {
	homeId: string;
	uid: string | null;
	ids: readonly string[];
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [crumbs, setCrumbs] = useState<{ id: string; title: string | null }[]>(
		[],
	);

	// `ids` is rebuilt on every snapshot, so the effect keys on the path —
	// the same guard `useAncestors` runs.
	const path = ids.join("\u0000");

	useEffect(() => {
		const list = path.length === 0 ? [] : path.split("\u0000");
		if (uid === null || list.length === 0) {
			setCrumbs([]);
			return;
		}

		let live = true;
		Promise.all(
			list.map(async (id) => ({
				id,
				title: (await cachedNode(uid, homeId, id))?.title ?? null,
			})),
		).then((resolved) => {
			if (live) setCrumbs(resolved);
		});

		return () => {
			live = false;
		};
	}, [homeId, uid, path]);

	if (crumbs.length === 0) return null;

	return (
		<View
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				columnGap: space.xs,
				// Under the title, past the tick — the row's own second line.
				paddingLeft: icon.md + space.md,
				paddingBottom: space.xs,
			}}
		>
			{crumbs.map((crumb, index) => (
				<Fragment key={crumb.id}>
					{index === 0 ? null : (
						<Icon
							source="chevron-right"
							size={icon.sm}
							color={theme.colors.onSurfaceVariant}
						/>
					)}
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{crumb.title ?? t("board.crumbHidden")}
					</Text>
				</Fragment>
			))}
		</View>
	);
}
