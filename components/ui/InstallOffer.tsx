import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, IconButton, Text } from "react-native-paper";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { useInstallOffer } from "@/hooks/use-install-offer";
import { useAppTheme } from "@/theme";
import { border, icon, space, touchTargetStyle } from "@/theme/tokens";

type InstallOfferProps = {
	placement: "top" | "end";
};

export function InstallOffer({ placement }: InstallOfferProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { visible, install, dismiss } = useInstallOffer();

	if (!visible) return null;

	return (
		<View
			style={[
				{
					alignSelf: "flex-start",
					flexDirection: "row",
					alignItems: "center",
					flexWrap: "wrap",
					gap: space.sm,
					marginHorizontal: space.md,
					maxWidth: "100%",
				},
				placement === "end" && {
					borderTopWidth: border.hairline,
					borderTopColor: theme.colors.outlineVariant,
					paddingTop: space.md,
				},
			]}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.sm,
					flexShrink: 1,
				}}
			>
				<PaperIcon
					name="cellphone-arrow-down"
					size={icon.md}
					color={theme.colors.onSurfaceVariant}
				/>
				<Text
					variant="bodyMedium"
					style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}
				>
					{t("install.offer")}
				</Text>
			</View>
			<Button
				mode="text"
				onPress={install}
				style={{ flexShrink: 0 }}
				contentStyle={{ minHeight: touchTargetStyle.height }}
			>
				{t("install.action")}
			</Button>
			<IconButton
				icon="close"
				accessibilityLabel={t("install.hide")}
				onPress={dismiss}
				style={touchTargetStyle}
			/>
		</View>
	);
}
