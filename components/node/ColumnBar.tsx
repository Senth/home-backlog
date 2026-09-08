import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, IconButton, Surface, Text } from "react-native-paper";
import { moveNode } from "@/data/nodes";
import type { Node, Status } from "@/models/node";
import { nextStatus, previousStatus, rankAtEnd } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	elevation,
	icon,
	space,
	touchTarget,
	touchTargetStyle,
} from "@/theme/tokens";

interface ColumnBarProps {
	homeId: string;
	/** The card the bar is about. Its status comes from the screen's listener. */
	node: Node;
	/** The parent board's frozen columns — the ramp the arrows step through. */
	columns: readonly Status[];
	/** The card's siblings, which a destination rank is computed against. */
	nodes: readonly Node[];
	/** Shows the screen's save-failed snack, the way `save` does. */
	onFailed: () => void;
}

/**
 * The bar at the foot of the details screen (#237 phase 4): back, the column's
 * name, forward, and *Done* — a card moved without going back to the board.
 *
 * It is about this card, not about the app, so it looks like nothing the frame
 * owns: no tabs, no nav row. The column's name is where the eye lands first and
 * stays uncoloured — a status that is a hue is the Trello habit
 * `docs/DESIGN.md` names — and *Done* is the only `contained-tonal` on the
 * screen. The write is the one the card menu already makes, `moveNode` with
 * `rankAtEnd` of the destination, and offline it queues like every other write.
 */
export function ColumnBar({
	homeId,
	node,
	columns,
	nodes,
	onFailed,
}: ColumnBarProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const next = nextStatus(columns, node.status);
	const previous = previousStatus(columns, node.status);

	const moveTo = (status: Status) => {
		if (status === node.status) return;

		// Appends to the destination column, the way `CardMenu.moveTo` does —
		// the same write, not a second implementation of it.
		const last = nodes.filter((card) => card.status === status).at(-1);
		moveNode(homeId, node, status, rankAtEnd(last?.rank ?? null)).catch(
			(reason) => {
				console.error("Could not move the card:", reason);
				onFailed();
			},
		);
	};

	return (
		<Surface
			elevation={elevation.low}
			mode="flat"
			testID={`column-bar-${node.id}`}
			// It rides the card's form width, the way the content above it
			// clamps (#237) — full-bleed beside a clamped column read as two
			// different screens. The wrap is the 200 % escape the contract
			// names for rows of controls: when the row cannot hold the name,
			// the name takes a line of its own rather than shrinking to a
			// character per line.
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				alignSelf: "center",
				width: "100%",
				maxWidth: contentWidth.form,
				gap: space.sm,
				paddingHorizontal: space.sm,
				paddingVertical: space.sm,
			}}
		>
			<IconButton
				icon="chevron-left"
				mode="outlined"
				size={icon.md}
				disabled={previous === null}
				accessibilityLabel={t("detail.moveToColumn", {
					column: t(`status.${previous ?? node.status}`),
				})}
				onPress={() => previous !== null && moveTo(previous)}
				// Paper greys the border of a disabled outlined button to
				// `surfaceDisabled`, which drops the circle the mock keeps on
				// both arrows — the outline is the affordance that says these
				// two are a pair, enabled or not.
				style={[
					touchTargetStyle,
					{ margin: space.none, borderColor: theme.colors.outline },
				]}
			/>
			{/* An auto basis, not `flex: 1`: with a zero basis the name was
			    weight zero in the shrink phase and collapsed to a character per
			    line at 200 % text, the same bug `Row` fixes for the rows. */}
			<View
				testID={`column-name-${node.id}`}
				style={{
					flexGrow: 1,
					flexShrink: 1,
					flexBasis: "auto",
					minHeight: touchTarget,
					justifyContent: "center",
				}}
			>
				<Text
					variant="labelMedium"
					style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}
				>
					{t("detail.column")}
				</Text>
				<Text variant="titleMedium" style={{ textAlign: "center" }}>
					{t(`status.${node.status}`)}
				</Text>
			</View>
			<IconButton
				icon="chevron-right"
				mode="outlined"
				size={icon.md}
				disabled={next === null}
				accessibilityLabel={t("detail.moveToColumn", {
					column: t(`status.${next ?? node.status}`),
				})}
				onPress={() => next !== null && moveTo(next)}
				style={[
					touchTargetStyle,
					{ margin: space.none, borderColor: theme.colors.outline },
				]}
			/>
			<Button
				mode="contained-tonal"
				icon="check"
				contentStyle={{ minHeight: touchTarget }}
				onPress={() => moveTo("done")}
				style={{ margin: space.none }}
			>
				{t("common.done")}
			</Button>
		</Surface>
	);
}
