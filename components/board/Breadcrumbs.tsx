import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Button, Icon, Text } from "react-native-paper";
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
		<ScrollView
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
		</ScrollView>
	);
}
