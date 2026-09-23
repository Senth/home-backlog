import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, Pressable, View } from "react-native";
import { Button, Icon, Surface, Text } from "react-native-paper";
import { ChoiceField } from "@/components/node/ChoiceField";
import { AppSheet } from "@/components/ui/AppSheet";
import { moveNode } from "@/data/nodes";
import { pickRung } from "@/models/column-bar";
import type { Node, Status } from "@/models/node";
import {
	nextStatus,
	previousStatus,
	rankAtEnd,
	visibleColumns,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	elevation,
	icon,
	space,
	touchTarget,
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

type Measured = Record<string, number>;

/**
 * The bar at the foot of the details screen: back and forward, each named by
 * where it sends the card, and between them the column the card is in.
 *
 * Its shape is the first of three rungs that fits (`pickRung`), from widths
 * measured off a hidden row of every label in the column set, so the buttons
 * hold one width as the card steps and the bar paints once, whole.
 *
 * The centre opens a sheet of every visible column: the arrows step, the sheet
 * jumps.
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
	const [measured, setMeasured] = useState<Measured>({});
	const [barWidth, setBarWidth] = useState(0);
	const [picking, setPicking] = useState(false);

	const next = nextStatus(columns, node.status);
	const previous = previousStatus(columns, node.status);

	const moveTo = (status: Status) => {
		if (status === node.status) return;

		const last = nodes.filter((card) => card.status === status).at(-1);
		moveNode(homeId, node, status, rankAtEnd(last?.rank ?? null)).catch(
			(reason) => {
				console.error("Could not move the card:", reason);
				onFailed();
			},
		);
	};

	const measure = (key: string) => (event: LayoutChangeEvent) => {
		const { width } = event.nativeEvent.layout;
		setMeasured((current) =>
			current[key] === width ? current : { ...current, [key]: width },
		);
	};

	const widest = (prefix: string) =>
		Math.max(
			0,
			...columns.map((status) => measured[`${prefix}-${status}`] ?? 0),
		);
	const button = widest("button");
	const centre = widest("centre");
	const iconOnly = measured.icon ?? 0;
	const ready =
		barWidth > 0 &&
		iconOnly > 0 &&
		columns.every(
			(status) =>
				measured[`button-${status}`] !== undefined &&
				measured[`centre-${status}`] !== undefined,
		);
	const rung = pickRung(
		{
			labelled: 2 * button + centre + 2 * space.sm,
			icons: 2 * iconOnly + centre + 2 * space.sm,
		},
		ready ? barWidth - 2 * space.sm : 0,
	);
	const labelled = rung === "labelled";

	const arrow = (destination: Status | null, forward: boolean) => (
		<Button
			mode="outlined"
			icon={forward ? "chevron-right" : "chevron-left"}
			disabled={destination === null}
			accessibilityLabel={t("detail.moveToColumn", {
				column: t(`status.${destination ?? node.status}`),
			})}
			onPress={() => destination !== null && moveTo(destination)}
			contentStyle={{
				minHeight: touchTarget,
				flexDirection: forward ? "row-reverse" : "row",
			}}
			style={{
				margin: space.none,
				borderColor: theme.colors.outline,
				width: labelled ? button : undefined,
				flexGrow: rung === "stacked" ? 1 : 0,
			}}
		>
			{labelled && destination !== null ? t(`status.${destination}`) : ""}
		</Button>
	);

	const name = (status: Status) => (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "center",
				gap: space.xs,
			}}
		>
			<Text
				variant="titleMedium"
				numberOfLines={2}
				style={{ textAlign: "center", flexShrink: 1 }}
			>
				{t(`status.${status}`)}
			</Text>
			<Icon
				source="menu-down"
				size={icon.sm}
				color={theme.colors.onSurfaceVariant}
			/>
		</View>
	);

	const centreView = (
		<Pressable
			testID={`column-name-${node.id}`}
			accessibilityRole="button"
			accessibilityLabel={t("detail.columnCurrent", {
				column: t(`status.${node.status}`),
			})}
			onPress={() => setPicking(true)}
			style={{
				flexGrow: 1,
				flexShrink: 1,
				flexBasis: "auto",
				minHeight: touchTarget,
				justifyContent: "center",
			}}
		>
			{name(node.status)}
		</Pressable>
	);

	return (
		<Surface
			elevation={elevation.low}
			mode="flat"
			testID={`column-bar-${node.id}`}
			onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
			style={{
				alignSelf: "center",
				width: "100%",
				maxWidth: contentWidth.form,
				gap: space.sm,
				paddingHorizontal: space.sm,
				paddingVertical: space.sm,
				opacity: ready ? 1 : 0,
			}}
		>
			<View
				pointerEvents="none"
				aria-hidden
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					position: "absolute",
					opacity: 0,
					alignItems: "flex-start",
				}}
			>
				{columns.map((status) => (
					<View key={status} style={{ flexDirection: "row" }}>
						<View onLayout={measure(`button-${status}`)}>
							<Button
								mode="outlined"
								icon="chevron-right"
								contentStyle={{ minHeight: touchTarget }}
								style={{ margin: space.none }}
							>
								{t(`status.${status}`)}
							</Button>
						</View>
						<View onLayout={measure(`centre-${status}`)}>{name(status)}</View>
					</View>
				))}
				<View onLayout={measure("icon")}>
					<Button
						mode="outlined"
						icon="chevron-right"
						contentStyle={{ minHeight: touchTarget }}
						style={{ margin: space.none }}
					>
						{""}
					</Button>
				</View>
			</View>
			{rung === "stacked" && centreView}
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
			>
				{arrow(previous, false)}
				{rung !== "stacked" && centreView}
				{arrow(next, true)}
			</View>
			{picking ? (
				<AppSheet
					visible
					onDismiss={() => setPicking(false)}
					testID={`editor-column-${node.id}`}
				>
					<ChoiceField
						label={t("detail.column")}
						value={node.status}
						values={visibleColumns(columns, nodes)}
						labelFor={(status) => t(`status.${status}`)}
						clearable={false}
						onChange={(status) => {
							if (status === null) return;
							setPicking(false);
							moveTo(status);
						}}
					/>
				</AppSheet>
			) : null}
		</Surface>
	);
}
