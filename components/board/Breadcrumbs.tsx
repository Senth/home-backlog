import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Button, Icon, Text } from "react-native-paper";
import { SlimScrollView } from "@/components/ui/SlimScrollView";
import type { Crumb } from "@/hooks/use-ancestors";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget } from "@/theme/tokens";

interface BreadcrumbsProps {
	/** The ancestors, root first. The current board is not one of them. */
	crumbs: Crumb[];
	/** The board you are on — the last crumb, and never a link. */
	current: string;
	/** `null` is the root board. */
	onNavigate: (nodeId: string | null) => void;
}

interface CardTrailProps {
	/** The card's ancestors, root first — `useAncestors`' output. The first is the project, never the home. */
	crumbs: readonly Crumb[];
	/** Where a readable crumb goes: that ancestor's board. */
	onOpenCrumb: (nodeId: string) => void;
	/** Below `cardGutterBreakpoint` the trail keeps clear of the floating menu. */
	narrow?: boolean;
}

/**
 * The trail on a card face, as **links that wrap** (#237 phase 2).
 *
 * Used only by the details screen's card, whose face is the whole subject of
 * the screen: every readable crumb is a link back to that board, and the trail
 * wraps instead of eliding, because there is nothing below it competing for the
 * room. Everywhere else the trail stays `BoardCard`'s single elided line.
 *
 * Quiet by the surface brief: `bodySmall`, muted on the card face, except the
 * links, which carry `primary`. A hidden crumb is still not a link — the same
 * neutral crumb `Breadcrumbs` draws. Each link is a full `touchTarget`, which
 * is what a control that navigates costs; the wrap keeps the trail to the
 * two lines a four-deep card needs rather than one over-long one.
 */
export function CardTrail({
	crumbs,
	onOpenCrumb,
	narrow = false,
}: CardTrailProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	return (
		<View
			style={[
				{
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					columnGap: space.xs,
					rowGap: space.none,
				},
				narrow ? { paddingRight: touchTarget } : null,
			]}
		>
			{crumbs.map((crumb, index) => {
				const target = crumb.node;

				return (
					<Fragment key={crumb.id}>
						{index === 0 ? null : (
							<Icon
								source="chevron-right"
								size={icon.sm}
								color={theme.colors.onCardMuted}
							/>
						)}
						{target === null ? (
							<Text
								variant="bodySmall"
								style={{ color: theme.colors.onCardMuted }}
							>
								{t("board.crumbHidden")}
							</Text>
						) : (
							<Pressable
								accessibilityRole="link"
								onPress={() => onOpenCrumb(target.id)}
								style={{
									minHeight: touchTarget,
									justifyContent: "center",
									paddingHorizontal: space.xs,
								}}
							>
								<Text
									variant="bodySmall"
									style={{ color: theme.colors.primary }}
								>
									{target.title}
								</Text>
							</Pressable>
						)}
					</Fragment>
				);
			})}
		</View>
	);
}

/**
 * *Projects › Bathroom › Tiling* — where you are, and the way back up.
 *
 * An ancestor that cannot be read renders as a neutral, unlinked crumb rather
 * than a gap. That case is real: participant inheritance runs downward, so being
 * added to a private subtask grants no read on the private project above it, and
 * a trail with a hole in it says less than one that admits to a hidden step.
 */
export function Breadcrumbs({ crumbs, current, onNavigate }: BreadcrumbsProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const separator = (
		<Icon
			source="chevron-right"
			size={icon.sm}
			color={theme.colors.onSurfaceVariant}
		/>
	);

	return (
		<SlimScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			accessibilityLabel={t("board.trail")}
			// A `ScrollView` in a column parent grows to fill it, which would give
			// one line of crumbs half the screen and push the board off the bottom.
			// It hugs its content instead.
			style={{ flexGrow: 0 }}
			contentContainerStyle={{
				alignItems: "center",
				paddingHorizontal: space.sm,
			}}
		>
			<Button
				compact
				onPress={() => onNavigate(null)}
				contentStyle={{ minHeight: touchTarget }}
			>
				{t("board.root")}
			</Button>

			{crumbs.map((crumb) => (
				<View
					key={crumb.id}
					style={{ flexDirection: "row", alignItems: "center" }}
				>
					{separator}
					{crumb.node ? (
						<Button
							compact
							onPress={() => onNavigate(crumb.id)}
							contentStyle={{ minHeight: touchTarget }}
						>
							{crumb.node.title}
						</Button>
					) : (
						<Text
							variant="labelLarge"
							style={{
								color: theme.colors.onSurfaceVariant,
								paddingHorizontal: space.sm,
							}}
						>
							{t("board.crumbHidden")}
						</Text>
					)}
				</View>
			))}

			<View style={{ flexDirection: "row", alignItems: "center" }}>
				{separator}
				<Text
					variant="labelLarge"
					style={{ paddingHorizontal: space.sm }}
					numberOfLines={1}
				>
					{current}
				</Text>
			</View>
		</SlimScrollView>
	);
}
