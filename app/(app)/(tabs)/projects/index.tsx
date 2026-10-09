import {
	type NavigationProp,
	type ParamListBase,
	useFocusEffect,
	useNavigation,
} from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import {
	BoardFilterAction,
	BoardFilterSheet,
} from "@/components/board/BoardFilterSheet";
import { AppHeader } from "@/components/ui/AppHeader";
import { BackAction } from "@/components/ui/BackAction";
import { useHome } from "@/contexts/HomeContext";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useBoardNodes } from "@/hooks/use-board-nodes";
import { useCardSelection } from "@/hooks/use-card-selection";
import { useGoneNotice } from "@/hooks/use-gone-notice";
import { useLocations } from "@/hooks/use-locations";
import { useParticipantFilter } from "@/hooks/use-participant-filter";
import { filterActionVisible } from "@/models/board-filter";
import { membersOf } from "@/models/home";
import { defaultColumns } from "@/models/node";
import { useAppTheme } from "@/theme";
import { goBack } from "@/utils/navigation";

let placeVisitHomeId: string | null = null;

/**
 * The board you land on: every root-level card.
 *
 * The **root board is not a document**. It cannot be moved, deleted or
 * reparented, so there is nothing for a frozen column set to protect and its
 * columns are the `defaultColumns` constant; a stored set earns its keep when
 * #63 gives it a screen.
 *
 * The app bar names the *home*, not the screen — the tab bar already names the
 * screen, and which home you are in has to be visible without a tap. Without it,
 * work on the cabin gets recorded on the house board and nothing on screen ever
 * said otherwise.
 */
export default function Projects() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const navigation = useNavigation<NavigationProp<ParamListBase>>();
	const { from } = useLocalSearchParams<{ from?: string }>();
	const fromLocations = useRef(false);
	if (from === "locations") fromLocations.current = true;
	const { activeHome } = useHome();
	const notice = useGoneNotice();

	const homeId = activeHome?.id ?? null;
	if (from === "locations") placeVisitHomeId = homeId;
	const {
		filter,
		loading: filterLoading,
		setFilter,
		refresh,
	} = useBoardFilter(homeId);
	useFocusEffect(
		useCallback(() => {
			if (homeId === null) return;
			if (from !== "locations" && placeVisitHomeId === homeId) {
				placeVisitHomeId = null;
				setFilter(null);
				return;
			}
			refresh();
		}, [from, homeId, refresh, setFilter]),
	);
	useEffect(() => {
		return navigation.getParent()?.addListener("blur", () => {
			if (!fromLocations.current) return;
			fromLocations.current = false;
			navigation.setParams({ from: undefined });
			setFilter(null);
		});
	}, [navigation, setFilter]);
	// The reach the stored filter names (D2): this board's children, or
	// everything below them — the pool pair and the done pair (Q1), filtered
	// on the trail. Nothing on the board reads the filter before this: the
	// reach is what decides which listeners exist at all.
	const { nodes, pool, loading, failed, retry } = useBoardNodes(
		homeId,
		null,
		filter?.reach ?? "board",
	);
	const board = useParticipantFilter(nodes);
	const selection = useCardSelection(
		`${homeId ?? ""} root`,
		(filter?.reach ?? "board") === "board",
	);
	const { locations } = useLocations(homeId);
	const [filterOpen, setFilterOpen] = useState(false);
	const filterAnchor = useRef<View>(null);

	// The card face's location facts (#100): id → place, from the one listener
	// this screen holds. Every card here is a root, so the trail passes down no
	// labels and none are resolved.
	const locationsById = new Map(locations.map((l) => [l.id, l]));

	// The filter action exists where a condition could change something (D10):
	// a second member to filter by, or a label, or a place. A household of one
	// with neither grows no control that can never hold anything back.
	const members = activeHome === null ? [] : membersOf(activeHome);
	const showFilterAction = filterActionVisible(
		members.length,
		activeHome?.labels.length ?? 0,
		locations.length,
	);

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<AppHeader
				title={activeHome?.name ?? ""}
				leading={
					<BackAction
						accessibilityLabel={t(
							from === "locations" ? "tab.locations" : "homes.title",
						)}
						onPress={() =>
							from === "locations"
								? goBack("/locations")
								: router.push("/homes")
						}
					/>
				}
			>
				{showFilterAction ? (
					<BoardFilterAction
						set={
							filter !== null &&
							(filter.conditions.length > 0 || filter.reach === "subtree")
						}
						onPress={() => setFilterOpen(true)}
						anchorRef={filterAnchor}
					/>
				) : null}
				<AccountMenu />
			</AppHeader>

			{homeId ? (
				<Board
					homeId={homeId}
					parent={null}
					columns={defaultColumns}
					nodes={board.nodes}
					loading={loading || filterLoading}
					failed={failed}
					onRetry={retry}
					hidden={board.hidden}
					locations={locationsById}
					filter={filter}
					onChangeFilter={setFilter}
					onOpenFilter={() => setFilterOpen(true)}
					reach={filter?.reach ?? "board"}
					pool={pool}
					selection={selection}
				/>
			) : null}

			{showFilterAction && homeId !== null ? (
				<BoardFilterSheet
					visible={filterOpen}
					onDismiss={() => setFilterOpen(false)}
					filter={filter}
					onChange={setFilter}
					members={members}
					labels={activeHome?.labels ?? []}
					locations={locations}
					showEveryone={board.showEveryone}
					onShowEveryone={board.setShowEveryone}
					returnFocusTo={filterAnchor}
				/>
			) : null}

			{/* Said here rather than on the board that vanished: a card can be
			    deleted, with its whole subtree, while somebody is standing on it. */}
			<Snackbar visible={notice.showing} onDismiss={notice.dismiss}>
				{t("board.gone")}
			</Snackbar>
		</View>
	);
}
