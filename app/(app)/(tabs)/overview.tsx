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
import { DueChip } from "@/components/board/DueChip";
import { MetaChip } from "@/components/board/MetaChip";
import { TitleDialog } from "@/components/board/TitleDialog";
import { BackAction } from "@/components/ui/BackAction";
import { InstallCard } from "@/components/ui/InstallCard";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { createNode } from "@/data/nodes";
import { type OverviewSection, useOverview } from "@/hooks/use-overview";
import { dueState } from "@/models/due-date";
import { hasSteps, type Node, rankAtEnd } from "@/models/node";
import { rowsPerSection } from "@/models/overview";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

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
	//
	// And not while the home holds a root at all. Three empty sections are not the
	// same claim as an empty house: every project sitting in To do, undated and
	// with nothing finished this month empties all three, and so does being on
	// none of the household's roots. `boards-and-nodes.md` settled that a
	// "nothing here yet" a household can disprove is the kind of lie people stop
	// trusting a screen for, and Overview has no filter control to disprove it
	// with. `roots` is every unarchived root the pair returned — before the hide
	// predicate, which is what makes the second case say "nothing in progress"
	// rather than "add the first project".
	const nothingAtAll =
		!loading &&
		!ongoing.failed &&
		!due.failed &&
		!done.failed &&
		roots.length === 0 &&
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
				<BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
				<AccountMenu />
			</Appbar.Header>

			<ScrollView contentContainerStyle={{ paddingBottom: fabInset }}>
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
				) : ongoing.failed ? (
					/* The roots pair is the one every section depends on — Ongoing
					   projects *is* it, and the other two need it for the hide scope —
					   so when it fails, all three fail with it. Said once, with one Try
					   again: three copies of the same sentence over three buttons that
					   all retry the same listener is one failure reported as three. */
					<LoadFailed onRetry={ongoing.retry} />
				) : (
					<>
						<Section
							title={t("overview.ongoing.title")}
							empty={t("overview.ongoing.empty")}
							section={ongoing}
							onOpen={open}
							testID="overview-section-ongoing"
						/>
						<Section
							title={t("overview.due.title")}
							empty={t("overview.due.empty")}
							section={due}
							onOpen={open}
							testID="overview-section-due"
						/>
						{/* No empty line. "Nothing completed" is the report card, and a
						    household that has finished nothing does not need a box
						    saying so — the section is absent instead. */}
						<Section
							title={t("overview.done.title")}
							section={done}
							onOpen={open}
							testID="overview-section-done"
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

interface SectionProps {
	title: string;
	/**
	 * What the section says when it is answered and empty. A section with no
	 * empty line — Recently done — is not rendered at all when it holds nothing.
	 */
	empty?: string;
	section: OverviewSection;
	onOpen: (node: Node) => void;
	/** Scopes a claim to its own section — three headings share every row's words. */
	testID: string;
}

/**
 * One heading and its rows, answered independently of the other two.
 *
 * A section that is still loading renders nothing rather than a heading over a
 * gap: a heading with nothing under it is indistinguishable from an empty
 * section, and this screen has three of them.
 */
function Section({ title, empty, section, onOpen, testID }: SectionProps) {
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
		<List.Section testID={testID}>
			<List.Subheader>{title}</List.Subheader>

			{/* Said rather than drawn as an empty section: a section is two
			    listeners and only one of them has to fail, and "nothing coming up"
			    is the wrong answer to "I could not ask". Only this section's own
			    pair reaches here — a failed roots pair is reported once, above. */}
			{section.failed ? (
				<LoadFailed onRetry={section.retry} />
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
 * What a spent retry ladder looks like: what happened, and the way back.
 *
 * One component for both scopes — the whole screen when the roots pair failed,
 * one section when only that section's own pair did — because the sentence and
 * the button are the same; all that differs is what `onRetry` reopens.
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
 * project that has children, and `DueChip` on one that is late or due soon —
 * the card's own component, so the two surfaces cannot disagree about what a
 * due date says or about the rule that says it in words rather than in colour.
 */
function RowMeta({ node }: { node: Node }) {
	const { t } = useTranslation();

	const due = dueState(node.dueDate, new Date());
	const showDue = node.dueDate !== null && (due === "late" || due === "soon");

	if (!hasSteps(node) && !showDue) return null;

	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
			<DueChip node={node} />
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
