import { getDocsFromServer } from "firebase/firestore";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ActivityIndicator, Button, Text, TextInput } from "react-native-paper";
import { AppDialog } from "@/components/ui/AppDialog";
import { CheckRow } from "@/components/ui/CheckRow";
import { participatingPickerQuery, sharedPickerQuery } from "@/data/nodes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { type Node, pickerCandidates, toNode } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

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
	onDismiss: () => void;
	onPick: (id: string) => void;
	onUnpick: (id: string) => void;
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * The *Waiting on…* picker's home-wide search, shared by the card menu and the
 * detail screen — the `TitleDialog`/`ConfirmDialog` mounting precedent, so it
 * is mounted only while open.
 *
 * Online-only, one-shot `getDocsFromServer` over the two picker queries
 * (Q-S1/Q-S2 in `data/nodes.ts`), fired debounced on a settled query of at
 * least two characters — once per settled query, never per keystroke, and no
 * listener anywhere. Results are merged, deduped, title-filtered and capped by
 * `models/node.ts`'s `pickerCandidates`, which also says when the cap was hit
 * so the search can admit what it may have missed rather than pretend
 * completeness.
 *
 * Tapping a result picks it and closes; tapping a picked result unpicks it and
 * stays. Offline it says it needs a connection instead of failing after a tap.
 */
export function BlockerSearchDialog({
	homeId,
	uid,
	node,
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
	const [capped, setCapped] = useState(false);
	const [searching, setSearching] = useState(false);

	// The typed text settles into a query. Resetting the timer on every change
	// is the debounce: one server round per pause in typing.
	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim()), searchDebounceMs);
		return () => clearTimeout(timer);
	}, [text]);

	useEffect(() => {
		if (uid === null || query.length < minQueryLength) {
			setResults([]);
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
	}, [homeId, uid, query, node]);

	const canSearch = online && uid !== null;
	const settled = query.length >= minQueryLength;

	return (
		<AppDialog
			visible
			onDismiss={onDismiss}
			title={t("detail.waitingSearchTitle")}
			testID={testID}
			returnFocusTo={returnFocusTo}
			actions={[
				<Button
					key="dismiss"
					onPress={onDismiss}
					textColor={theme.colors.onSurfaceVariant}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("common.dismiss")}
				</Button>,
			]}
		>
			{canSearch ? (
				<View style={{ gap: space.md }}>
					<TextInput
						mode="outlined"
						label={t("detail.waitingSearchPlaceholder")}
						value={text}
						onChangeText={setText}
						autoFocus
					/>

					{searching ? (
						<ActivityIndicator accessibilityLabel={t("common.loading")} />
					) : null}

					{settled && !searching && results.length === 0 ? (
						<Text
							variant="bodyMedium"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("detail.waitingSearchEmpty")}
						</Text>
					) : null}

					{results.map((result) => (
						<CheckRow
							key={result.id}
							label={result.title}
							checked={node.blockedBy.includes(result.id)}
							onPress={() => {
								if (node.blockedBy.includes(result.id)) {
									onUnpick(result.id);
									return;
								}
								// Picking is the answer the dialog was opened for, so it
								// closes; unpicking stays, the way the menu's own page does.
								onPick(result.id);
								onDismiss();
							}}
						/>
					))}

					{capped && results.length > 0 ? (
						<Text
							variant="bodySmall"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("detail.waitingSearchCapped", { count: results.length })}
						</Text>
					) : null}
				</View>
			) : (
				<Text variant="bodyMedium">{t("board.offlineHint")}</Text>
			)}
		</AppDialog>
	);
}
