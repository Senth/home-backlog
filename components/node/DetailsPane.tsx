import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { DetailsView } from "@/components/node/DetailsView";
import { useDetailsEscape } from "@/hooks/use-details-escape";
import { useAppTheme } from "@/theme";
import { border, space } from "@/theme/tokens";

export function DetailsPane({
	nodeId,
	width,
	overlay,
	onClose,
	onOpenNode,
	onOpenBoard,
}: {
	nodeId: string | null;
	width: number;
	overlay: boolean;
	onClose: () => void;
	onOpenNode: (id: string) => void;
	onOpenBoard: (id: string | null) => void;
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const focused = useIsFocused();
	useDetailsEscape(focused && nodeId !== null, onClose);
	if (overlay && nodeId === null) return null;
	return (
		<View
			testID="details-pane"
			style={{
				width,
				backgroundColor: theme.colors.background,
				...(overlay
					? {
							position: "absolute",
							right: space.none,
							top: space.none,
							bottom: space.none,
						}
					: {}),
			}}
		>
			{nodeId === null ? (
				<View style={{ flex: 1, padding: space.md, gap: space.lg }}>
					<Text variant="titleMedium">{t("detail.title")}</Text>
					<View style={{ flex: 1, justifyContent: "center", gap: space.md }}>
						<Text variant="bodyLarge">{t("detail.emptyTitle")}</Text>
						<Text
							variant="bodyMedium"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("detail.emptyHint")}
						</Text>
					</View>
				</View>
			) : (
				<DetailsView
					key={nodeId}
					nodeId={nodeId}
					width={width}
					presentation="pane"
					onClose={onClose}
					onOpenNode={onOpenNode}
					onOpenBoard={onOpenBoard}
				/>
			)}
			<View
				style={{
					position: "absolute",
					left: space.none,
					top: space.none,
					bottom: space.none,
					width: border.hairline,
					backgroundColor: overlay
						? theme.colors.outline
						: theme.colors.outlineVariant,
					pointerEvents: "none",
				}}
			/>
		</View>
	);
}
