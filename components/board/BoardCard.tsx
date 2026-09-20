import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, View } from "react-native";
import { Card, Icon, Text } from "react-native-paper";
import { CardTrail } from "@/components/board/Breadcrumbs";
import { CardFooter } from "@/components/board/CardFooter";
import { CardGutter } from "@/components/board/CardGutter";
import { CardThumbnails, urlOf } from "@/components/board/CardThumbnails";
import { useWaitingMark } from "@/components/board/waiting-mark";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { useHome } from "@/contexts/HomeContext";
import type { Crumb } from "@/hooks/use-ancestors";
import { formatList } from "@/i18n/format-list";
import { cardFace } from "@/models/attachment";
import { effectiveLabels } from "@/models/label";
import type { Attachment } from "@/models/node";
import { hasSteps, type Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	elevation,
	icon,
	radius,
	size,
	space,
	touchTarget,
} from "@/theme/tokens";

interface BoardCardProps {
	node: Node;
	/**
	 * A tap. On a card with steps that is its board; on one without, its details
	 * — a card is a board only once it has a step in it. Absent renders the face
	 * without a press of its own: the details screen (#237) shows the card the
	 * route already names, so the face is not itself a control there.
	 */
	onOpen?: () => void;
	/** The overflow menu. Everything that is not "open" lives in there. */
	menu?: ReactNode;
	/**
	 * Above `compactBreakpoint`, where the title drops to `bodyMedium` because a
	 * column of desktop cards is read as a list rather than one card at a time.
	 *
	 * The column passes it down; **the card does not measure itself**. A card is
	 * rendered once per row and dragged over a second time in an overlay, and a
	 * width listener on each of those is a resize observer per card for a fact
	 * the board already knows.
	 */
	wide?: boolean;
	/**
	 * Below `cardGutterBreakpoint` (#100): the left gutter narrows, the right
	 * gutter disappears, the menu floats in the card's top-right corner, and the
	 * people and the step count join the content as a trailing line. A 390px
	 * phone at 200% text is a 195px viewport, and there the gutters' combined
	 * 76px is two fifths of the card before the title has had a word.
	 */
	narrow?: boolean;
	/**
	 * The blockers this card might wait on, by id — the board's own nodes plus
	 * the watcher's cross-board documents, `null` for one the server confirmed
	 * gone. Absent means *not heard from yet*, which waits. Overview hands the
	 * statuses it already holds, in the same shape.
	 */
	blockers?: ReadonlyMap<string, Node | null>;
	/**
	 * The ancestors' titles, root first, `null` for one the node map cannot
	 * answer — `crumbTitlesOf`'s output. Absent or empty draws nothing: the
	 * board says where you are in its own trail, and a root has nothing above
	 * it. Overview passes it; the board never does.
	 */
	path?: readonly (string | null)[];
	/**
	 * The trail as **links that wrap**, used only by the details screen's card
	 * (#237) — see `CardTrail`. Everywhere else the trail is `path`'s single
	 * elided line. The crumbs are `useAncestors`' output, root first, so the
	 * first is the project, never the home.
	 */
	linkedTrail?: {
		crumbs: readonly Crumb[];
		onOpenCrumb: (nodeId: string) => void;
	};
	/**
	 * The label ids the card's trail passes down (#100) — on a board, the
	 * board's own chain, which every card on it shares; on Overview, the card's
	 * own ancestors, resolved by `use-label-ancestors` where the pool cannot
	 * answer. Unioned with the card's own ids against the home's definitions.
	 */
	ancestorLabelIds?: readonly string[];
	/**
	 * Location id → title, the leaf, as the screen holds it. A location the map
	 * cannot answer says nothing rather than a wrong name.
	 */
	locations?: ReadonlyMap<string, string>;
	/**
	 * The nearest place the trail passes down (#290) — the board's own chain on
	 * a board, resolved once by the screen that already holds it; the card's
	 * own ancestors on Overview and details. The card's own field wins, and an
	 * inherited place renders exactly like the card's own (#296) — the same
	 * rule the labels above follow.
	 */
	ancestorLocationId?: string | null;
	/**
	 * True drops the footer's location fact (#205): the tree screen draws the
	 * card inside the very place's row, and naming it again is the row saying
	 * its own name twice. One prop through to `CardFooter` — the face is not
	 * restyled, it just keeps one fact to itself.
	 */
	hideLocation?: boolean;
}

/**
 * The hero face's image, full-bleed above the gutters. The chosen one, or —
 * after it was deleted, with nothing rewritten — the first remaining. An empty
 * placeholder holds the aspect while the URL resolves, so the face does not
 * jump once it arrives.
 */
function CardHero({ attachment }: { attachment: Attachment }) {
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void urlOf(attachment.path)
			.then((resolved) => {
				if (!cancelled) setUrl(resolved);
			})
			// A raced delete takes the object with it; the tile simply never
			// arrives, and the console stays clean.
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [attachment.path]);

	return (
		<View
			style={{
				overflow: "hidden",
				borderTopLeftRadius: radius.md,
				borderTopRightRadius: radius.md,
			}}
		>
			{url === null ? (
				<View style={{ width: "100%", aspectRatio: 4 / 3 }} />
			) : (
				<Image
					source={{ uri: url }}
					style={{ width: "100%", aspectRatio: 4 / 3 }}
					resizeMode="cover"
					accessibilityLabel={attachment.name}
				/>
			)}
		</View>
	);
}

/** What a card resolves its waiting against before its board has said anything. */
const noBlockers: ReadonlyMap<string, Node | null> = new Map();

const noAncestorLabelIds: readonly string[] = [];

/**
 * One card (#100), the settled face. Fixed order in the content column:
 * **project breadcrumbs → title → footer**, and nothing above the crumbs.
 *
 * The face is three columns:
 *
 * - **The left gutter** — priority and identity, `CardGutter`'s. Always drawn,
 *   so every card on a board is the same shape.
 * - **The content** — the trail, the title, and the footer's two bare pairs:
 *   where and how long, then due and waiting. Words, never chips: the old
 *   outlined pills put a box around every fact and an edge around every row,
 *   and overdue — the one fact that is a status — is carried by words in the
 *   warning color, which survives 200% text and color blindness.
 * - **The right gutter** — the menu at the top, the assignees and the step
 *   count anchored to the foot. Below `cardGutterBreakpoint` it goes: the
 *   menu floats in the corner and the people and the count become a trailing
 *   line, because at 195px the title outranks both.
 *
 * **Inherited labels render exactly like a card's own** — the same dot, the
 * same hue, no dimming — because a label passed down by the project above is
 * as true of the work as one added to it directly.
 *
 * **The steps glyph says the card is a board**, and it is there only when the
 * card really has steps — `hasSteps`, from the stored `childCount`. `2/5`
 * rather than a progress bar: a count of direct steps is a fact, and a bar on
 * nested work is a false claim about the project.
 *
 * A card with nothing set is its gutter, a title and its trail: nothing is
 * added to make it look finished.
 */
export function BoardCard({
	node,
	onOpen,
	menu,
	wide = false,
	narrow = false,
	blockers = noBlockers,
	path,
	linkedTrail,
	ancestorLabelIds = noAncestorLabelIds,
	locations,
	ancestorLocationId = null,
	hideLocation = false,
}: BoardCardProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const { activeHome } = useHome();

	// Own ∪ inherited, named by the home's definitions and in their order —
	// `HomeContext` carries them on `activeHome`, so this costs no read the
	// screen is not already paying for.
	const labels = effectiveLabels(
		node.labelIds,
		ancestorLabelIds,
		activeHome?.labels ?? [],
	);

	const steps = hasSteps(node);
	const isDone = node.status === "done";

	// The face (#298): what the card draws after degradation — the count fact
	// in the footer, a thumbnails row under it, or the hero above everything.
	const face = cardFace(node);

	// The card's own place wins; otherwise the trail's nearest (#290) — the
	// same rule the location picker and the details row resolve by.
	const locationId = node.locationId ?? ancestorLocationId;

	// Two projects in one path may share a title, so the key is content plus
	// position — the trail never reorders, only grows or disappears.
	const crumbs =
		path === undefined || path.length === 0
			? undefined
			: path.map((crumb, index) => ({
					id: `${index}:${crumb ?? t("board.crumbHidden")}`,
					label: crumb ?? t("board.crumbHidden"),
				}));

	// Waiting is the *unresolved* blockers, never the stored list — the shared
	// `useWaitingMark` derivation, so the face and Overview cannot disagree.
	const {
		isWaiting,
		label: waitingLabel,
		a11yLabel,
	} = useWaitingMark(node, blockers);
	const waiting = isWaiting ? { label: waitingLabel, a11yLabel } : null;

	// A member who has left the home has no profile left, and is still assigned:
	// the row says *Someone* rather than dropping them, the same way the members
	// list does.
	const assignees = node.assigneeIds.map((uid) => ({
		uid,
		name:
			activeHome?.memberProfiles?.[uid]?.displayName || t("members.unknown"),
		photoURL: activeHome?.memberProfiles?.[uid]?.photoURL ?? null,
	}));

	const people =
		assignees.length === 0 ? null : (
			// One label for the row rather than one per face: a screen reader
			// reading "M W, N A" learns nothing, and the initials are a visual
			// shorthand rather than a name.
			<View
				accessible
				accessibilityLabel={t("board.assignedTo", {
					count: assignees.length,
					names: formatList(
						assignees.map((assignee) => assignee.name),
						i18n.language,
					),
				})}
				style={
					narrow
						? {
								flexDirection: "row",
								flexWrap: "wrap",
								alignItems: "center",
								gap: space.xs,
							}
						: { alignItems: "center", gap: space.xs }
				}
			>
				{assignees.map((assignee) => (
					<PersonAvatar
						key={assignee.uid}
						name={assignee.name}
						photoURL={assignee.photoURL}
						px={size.avatarXs}
					/>
				))}
			</View>
		);

	const stepMark =
		steps === false ? null : (
			<View
				testID={cardStepsTestID}
				style={{
					flexDirection: "row",
					// Never wraps: the glyph and its count are one mark, and half of
					// it on the next line is not a smaller mark.
					flexWrap: "nowrap",
					alignItems: "center",
					gap: space.xs,
				}}
			>
				<Icon
					source="format-list-checks"
					size={icon.sm}
					color={theme.colors.onCardMuted}
				/>
				<Text
					variant="labelMedium"
					numberOfLines={1}
					style={{ color: theme.colors.onCardMuted }}
					accessibilityLabel={t("detail.stepsDone", {
						done: node.doneCount,
						total: node.childCount,
					})}
				>
					{t("board.steps", {
						done: node.doneCount,
						total: node.childCount,
					})}
				</Text>
			</View>
		);

	return (
		<Card
			mode="outlined"
			testID={cardTestID}
			onPress={onOpen}
			accessibilityHint={
				// A face without a press has nothing to hint about.
				onOpen === undefined
					? undefined
					: steps
						? t("board.open")
						: t("board.openDetails")
			}
			// Raised out of its column: the fill is a board color rather than
			// `surface`, which in dark was the same color as the page. Paper draws
			// the outlined card's hairline itself, in whatever `borderColor` this
			// style carries — a `borderWidth` here would put a second, coincident
			// border on the surface underneath it and inset the content by a pixel.
			style={{
				backgroundColor: theme.colors.boardCard,
				borderColor: theme.colors.boardCardBorder,
			}}
		>
			{/* The hero is the one face that breaks the gutters' rail — full-bleed
			    above both of them, its top corners the card's own. Chosen per
			    card, never automatic: a board looks like this only where somebody
			    decided it should (docs/DESIGN.md, #298). */}
			{face.mode === "hero" && face.hero !== null ? (
				<CardHero attachment={face.hero} />
			) : null}

			<View style={{ flexDirection: "row", minHeight: touchTarget }}>
				<CardGutter node={node} labels={labels} narrow={narrow} />

				{/* The content column, spacing 8 / 4 / 8 (#100): edge → crumbs,
				    crumbs → title, title → footer. Nothing above the crumbs, nothing
				    between them and the title — the trail reads as one unit with what
				    it names. */}
				<View
					style={{
						flex: 1,
						paddingTop: space.sm,
						paddingBottom: space.sm,
						paddingHorizontal: narrow ? space.xs : space.sm,
					}}
				>
					{/* The linked trail is the details card's alone: links that
					    wrap. Everywhere else the trail is one elided line you
					    consult. */}
					{linkedTrail === undefined ? null : (
						<CardTrail
							crumbs={linkedTrail.crumbs}
							onOpenCrumb={linkedTrail.onOpenCrumb}
							narrow={narrow}
						/>
					)}

					{/* Context you consult rather than scan: quiet metadata the title
					    still owns. One `Text` so the trail end-elides as a whole — the
					    Swedish 195px case — and one label so a screen reader hears the
					    crumbs as words rather than chevrons. Narrow, it keeps clear of
					    the menu floating over its own corner. */}
					{linkedTrail !== undefined || crumbs === undefined ? null : (
						<Text
							variant="labelMedium"
							numberOfLines={1}
							accessible
							accessibilityLabel={t("board.pathA11y", {
								path: crumbs.map((crumb) => crumb.label).join(", "),
							})}
							style={[
								{ color: theme.colors.onCardMuted },
								narrow ? { paddingRight: touchTarget } : null,
							]}
						>
							{crumbs.reduce<ReactNode>(
								(trail, crumb) => (
									<Fragment key={crumb.id}>
										{trail}
										{trail === null ? null : (
											<Icon
												source="chevron-right"
												size={icon.sm}
												color={theme.colors.onCardMuted}
											/>
										)}
										{crumb.label}
									</Fragment>
								),
								null,
							)}
						</Text>
					)}

					{/* Smaller on desktop, where a column is read as a list of cards
					    rather than one card filling the screen. `wide` comes from the
					    column, not from a measurement taken here. Quiet by exactly one
					    step when done: the check says *finished* and the title steps
					    down a tier with it — the fill, the border and the gutter are
					    untouched, because a done card still belongs to its column. */}
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space.xs,
							marginTop:
								crumbs === undefined && linkedTrail === undefined
									? space.none
									: space.xs,
						}}
					>
						{isDone ? (
							<Icon
								source="check"
								size={icon.sm}
								color={theme.colors.onCardMuted}
							/>
						) : null}
						<Text
							variant={wide ? "bodyMedium" : "bodyLarge"}
							style={isDone ? { color: theme.colors.onCardMuted } : undefined}
						>
							{node.title}
						</Text>
					</View>

					<CardFooter
						node={node}
						locationId={locationId}
						locations={locations}
						showLocation={!hideLocation}
						waiting={waiting}
						// The title owns the space between them; the footer hangs one
						// `space.sm` under it, whether or not it has anything to say.
						// Rendered only when it does — a footer that renders as nothing
						// leaves the title as the last word, which is what an empty card
						// should end on.
						style={{ marginTop: space.sm }}
					/>

					{/* The thumbnails face: one row under the footer, inside the
					    content column — the gutters are untouched, and the pictures
					    answer for the count the footer would otherwise carry. */}
					{face.mode === "thumbnails" && face.images.length > 0 ? (
						<View style={{ marginTop: space.sm }}>
							<CardThumbnails images={face.images} />
						</View>
					) : null}

					{/* Below `cardGutterBreakpoint` the right gutter is gone, so the
					    people and the count travel with the content instead — a
					    trailing line, wrapping before it shrinks. */}
					{narrow && (people !== null || stepMark !== null) ? (
						<View
							style={{
								flexDirection: "row",
								flexWrap: "wrap",
								alignItems: "center",
								gap: space.sm,
								marginTop: space.sm,
							}}
						>
							{people}
							{stepMark}
						</View>
					) : null}
				</View>

				{/* The right gutter: the menu, and at the foot the people and the
				    mark that this card is a board. Gone below `cardGutterBreakpoint`,
				    where the floating menu takes its place. */}
				{narrow ? null : (
					<View
						style={{
							width: size.cardRail,
							alignItems: "center",
							paddingBottom: space.xs,
						}}
					>
						{menu}
						{/* The foot is inset from the card's edge: the count is as wide
						    as the rail was, and flush content lands under the outline's
						    rounded corner. */}
						<View
							style={{
								marginTop: "auto",
								alignItems: "center",
								gap: space.xs,
								paddingRight: space.xs,
							}}
						>
							{people}
							{stepMark}
						</View>
					</View>
				)}

				{narrow && menu !== undefined ? (
					// The menu floats over the card's own corner: the room it needs
					// comes out of the crumbs' elide point rather than out of a
					// gutter the 195px card does not have.
					<View
						style={{
							position: "absolute",
							top: space.none,
							right: space.none,
							zIndex: elevation.high,
						}}
					>
						{menu}
					</View>
				) : null}
			</View>
		</Card>
	);
}

/** The card's box and its steps mark, for the selectors in `e2e/`. */
export const cardTestID = "board-card";
export const cardStepsTestID = "card-steps";
