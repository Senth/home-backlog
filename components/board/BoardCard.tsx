import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Card, Icon, Text } from "react-native-paper";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget } from "@/theme/tokens";

interface BoardCardProps {
	node: Node;
	/** Opening the card **as a board**. That is what a tap means at every depth. */
	onOpen: () => void;
	/** The overflow menu. Everything that is not "open" lives in there. */
	menu?: ReactNode;
}

/**
 * One card: a title, a chevron, and a mark when something is blocking it.
 *
 * Due date, priority, effort and notes are deliberately absent — they are on the
 * document and belong to node detail (#49). A card face carrying five metadata
 * chips is the overwhelm this app exists to reduce.
 *
 * **The chevron is on every card**, whether or not it has children. Finding out
 * costs a query per card, and listener breadth is this app's stated cost risk;
 * the chevron says what a tap does, which is the same thing on every card and
 * will still be after #49 — so the gesture is never learned twice.
 */
export function BoardCard({ node, onOpen, menu }: BoardCardProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	return (
		<Card mode="outlined" onPress={onOpen} accessibilityHint={t("board.open")}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.sm,
					minHeight: touchTarget,
					paddingLeft: space.md,
					// The menu button carries its own padding; without this the card
					// would be visibly wider on the right than on the left.
					paddingRight: menu ? space.none : space.sm,
					paddingVertical: space.sm,
				}}
			>
				<View style={{ flex: 1, gap: space.xs }}>
					<Text variant="bodyLarge">{node.title}</Text>
					{/* Blocked is a *condition*, not a column: the card stays in the
					    stage it is really in and says it is waiting. Nothing in the UI
					    sets `blockedBy` yet — that is #66 — so this arrives from the
					    REST API or a fixture until then. */}
					{node.blockedBy.length > 0 ? (
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space.xs,
							}}
						>
							<Icon
								source="pause-circle-outline"
								size={icon.sm}
								color={theme.colors.warning}
							/>
							<Text
								variant="labelMedium"
								style={{ color: theme.colors.warning }}
							>
								{t("board.blocked")}
							</Text>
						</View>
					) : null}
				</View>
				<Icon
					source="chevron-right"
					size={icon.md}
					color={theme.colors.onSurfaceVariant}
				/>
				{menu}
			</View>
		</Card>
	);
}
