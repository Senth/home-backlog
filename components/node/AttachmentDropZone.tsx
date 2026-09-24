import { Trans, useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { ActivityIndicator, Icon, Text } from "react-native-paper";
import {
	type DropPhase,
	formatBytes,
	maxAttachmentBytes,
} from "@/models/attachment";
import { useAppTheme } from "@/theme";
import { border, icon, radius, space, touchTarget } from "@/theme/tokens";

export function AttachmentDropZone({
	size,
	phase,
	state,
	uploadingCount,
	onPress,
}: {
	size: "large" | "slim";
	phase: DropPhase;
	state: "ready" | "uploading" | "offline";
	uploadingCount: number;
	onPress: () => void;
}) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const active = state === "ready";
	const over = active && phase === "over";
	const armed = active && phase === "armed";
	const leadColor = over
		? theme.colors.onPrimaryContainer
		: active
			? theme.colors.onSurface
			: theme.colors.onSurfaceDisabled;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={t("detail.attachmentsChooseFiles")}
			disabled={!active}
			onPress={onPress}
			style={{
				minHeight: touchTarget,
				borderWidth: border.hairline,
				borderStyle: "dashed",
				borderColor: over ? theme.colors.primary : theme.colors.outline,
				borderRadius: radius.sm,
				backgroundColor: over
					? theme.colors.primaryContainer
					: armed
						? theme.colors.boardColumn
						: undefined,
				padding: size === "large" ? space.lg : space.sm,
				...(active ? {} : { backgroundColor: theme.colors.surfaceDisabled }),
			}}
		>
			<View
				style={{
					flexDirection: size === "large" ? "column" : "row",
					alignItems: "center",
					justifyContent: "center",
					gap: size === "large" ? space.md : space.sm,
				}}
			>
				{state === "uploading" ? (
					<ActivityIndicator
						accessibilityLabel={t("detail.attachmentsUploading")}
					/>
				) : (
					<Icon
						source={state === "offline" ? "cloud-off-outline" : "tray-arrow-up"}
						size={icon.md}
						color={
							over
								? theme.colors.onPrimaryContainer
								: theme.colors.onSurfaceVariant
						}
					/>
				)}
				<View
					style={{
						alignItems: size === "large" ? "center" : "flex-start",
						gap: space.xs,
						flexShrink: 1,
					}}
				>
					<Text
						variant="bodyLarge"
						style={{
							color: leadColor,
							fontWeight: over ? "500" : "400",
							textAlign: size === "large" ? "center" : "left",
						}}
					>
						{state === "offline" ? (
							t("detail.attachmentsOffline")
						) : state === "uploading" ? (
							t("detail.attachmentsUploadingCount", { count: uploadingCount })
						) : over ? (
							t("detail.attachmentsDropOver")
						) : armed ? (
							t("detail.attachmentsDropArmed")
						) : (
							<Trans
								i18nKey="detail.attachmentsDrag"
								components={{
									choose: (
										<Text
											style={{
												color: theme.colors.primary,
												textDecorationLine: "underline",
											}}
										>
											{""}
										</Text>
									),
								}}
							/>
						)}
					</Text>
					<Text
						variant="bodySmall"
						style={{
							color: theme.colors.onSurfaceVariant,
							textAlign: size === "large" ? "center" : "left",
						}}
					>
						{t("detail.attachmentsLimits", {
							limit: formatBytes(maxAttachmentBytes, i18n.language),
						})}
					</Text>
				</View>
			</View>
		</Pressable>
	);
}
