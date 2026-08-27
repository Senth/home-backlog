import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
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
import { MetaChip } from "@/components/board/MetaChip";
import { TitleDialog } from "@/components/board/TitleDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { createNode } from "@/data/nodes";
import { type OverviewSection, useOverview } from "@/hooks/use-overview";
import { dueState, formatDueElapsed } from "@/models/due-date";
import { hasSteps, type Node, rankAtEnd } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space, touchTarget, touchTargetStyle } from "@/theme/tokens";

/**
 * What is going on, without opening a board: the projects in progress, what is
 * coming up or already late, and what recently got done.
 *
 * The first tab and the route the app opens on — a summary you have to navigate
 * to is a summary nobody reads. The app bar names the *home*, not the screen:
 * the tab bar already names the screen, and this is the highest-risk place in
 * the app for recording cabin work on the house board, with no breadcrumb to
 * lean on. No `BoardMenu`, because there is no filter here to toggle.
 *
 * Every read is `useOverview`; this file opens no listener of its own.
 */
export default function Overview() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();
	const { activeHome } = useHome();

	const homeId = activeHome?.id ?? null;
	const { ongoing, due, done, roots } = useOverview(homeId);

	const [adding, setAdding] = useState(false);
	const [fabHeight, setFabHeight] = useState(0);

	// Measured, not assumed: the FAB names its action in words, so it is taller
	// in Swedish and taller again at 200% text. `space.xxl` is only the value for
	// the single frame before it has laid itself out — the same reserve the board
	// keeps under its own FAB.
	const fabInset = fabHeight > 0 ? fabHeight + space.md + space.md : space.xxl;

	const loading = ongoing.loading || due.loading || done.loading;
	// Not while anything failed: "add the first project" and "could not load" are
	// contradictory instructions, and only one of them is true.
	const nothingAtAll =
		!loading &&
		!ongoing.failed &&
		!due.failed &&
		!done.failed &&
		ongoing.nodes.length === 0 &&
		due.nodes.length === 0 &&
		done.nodes.length === 0;

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
			rank: rankAtEnd(roots.at(-1)?.rank ?? null),
			parent: null,
			status: "backlog",
			participantIds: Object.keys(activeHome?.members ?? {}),
		});
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.BackAction
					style={touchTargetStyle}
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
				<AccountMenu />
			</Appbar.Header>

			<ScrollView contentContainerStyle={{ paddingBottom: fabInset }}>
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
				) : (
					<>
						<Section
							title={t("overview.ongoing.title")}
							empty={t("overview.ongoing.empty")}
							section={ongoing}
							onOpen={open}
						/>
						<Section
							title={t("overview.due.title")}
							empty={t("overview.due.empty")}
							section={due}
							onOpen={open}
						/>
						{/* No empty line. "Nothing completed" is the report card, and a
						    household that has finished nothing does not need a box
						    saying so — the section is absent instead. */}
						<Section
							title={t("overview.done.title")}
							section={done}
							onOpen={open}
						/>
					</>
				)}
			</ScrollView>

			<FAB
				icon="plus"
				label={t("overview.add")}
				onPress={() => setAdding(true)}
				onLayout={(event) => setFabHeight(event.nativeEvent.layout.height)}
				style={{ position: "absolute", right: space.md, bottom: space.md }}
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

/** Rows a section shows before it offers the rest. */
const rowsPerSection = 5;

interface SectionProps {
	title: string;
	/**
	 * What the section says when it is answered and empty. A section with no
	 * empty line — Recently done — is not rendered at all when it holds nothing.
	 */
	empty?: string;
	section: OverviewSection;
	onOpen: (node: Node) => void;
}

/**
 * One heading and its rows, answered independently of the other two.
 *
 * A section that is still loading renders nothing rather than a heading over a
 * gap: a heading with nothing under it is indistinguishable from an empty
 * section, and this screen has three of them.
 */
function Section({ title, empty, section, onOpen }: SectionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [expanded, setExpanded] = useState(false);

	if (section.loading) return null;
	if (!section.failed && section.nodes.length === 0 && empty === undefined) {
		return null;
	}

	const shown = expanded
		? section.nodes
		: section.nodes.slice(0, rowsPerSection);
	const more = section.nodes.length - shown.length;

	return (
		<List.Section>
			<List.Subheader>{title}</List.Subheader>

			{/* Said rather than drawn as an empty section: a section is two
			    listeners and only one of them has to fail, and "nothing coming up"
			    is the wrong answer to "I could not ask". */}
			{section.failed ? (
				<View style={{ gap: space.sm, paddingHorizontal: space.md }}>
					<Text
						variant="bodyMedium"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("overview.loadFailed")}
					</Text>
					<Button
						mode="contained-tonal"
						icon="refresh"
						onPress={section.retry}
						contentStyle={{ minHeight: touchTarget }}
						style={{ alignSelf: "flex-start" }}
					>
						{t("common.retry")}
					</Button>
				</View>
			) : section.nodes.length === 0 ? (
				<Text
					variant="bodyMedium"
					style={{
						color: theme.colors.onSurfaceVariant,
						paddingHorizontal: space.md,
					}}
				>
					{empty}
				</Text>
			) : (
				shown.map((node) => (
					<List.Item
						key={node.id}
						title={node.title}
						titleNumberOfLines={2}
						onPress={() => onOpen(node)}
						style={{ minHeight: touchTarget }}
						right={() => <RowMeta node={node} />}
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
 * The meta a row carries, which is the card face's own: the steps glyph on a
 * project that has children, and the due chip on one that is late or due soon.
 *
 * **Overdue is words, never colour** — *3 days late* — for the reason the card
 * face settled it: nothing in the app acts on a due date yet, so a red row is
 * pure guilt for a deadline nothing will remind anyone about, and words survive
 * 200% text and colour blindness.
 */
function RowMeta({ node }: { node: Node }) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();

	const due = dueState(node.dueDate, new Date());
	const late = due === "late";
	const showDue = node.dueDate !== null && (late || due === "soon");

	if (!hasSteps(node) && !showDue) return null;

	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
			{showDue && node.dueDate !== null ? (
				<MetaChip
					source="calendar"
					color={late ? theme.colors.warning : undefined}
				>
					{t(late ? "board.dueLate" : "board.dueSoon", {
						elapsed: formatDueElapsed(node.dueDate, new Date(), i18n.language),
					})}
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
