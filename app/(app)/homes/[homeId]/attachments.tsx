import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, View } from "react-native";
import {
	Appbar,
	Divider,
	Icon,
	IconButton,
	SegmentedButtons,
	Snackbar,
	Text,
} from "react-native-paper";
import { urlOf } from "@/components/board/CardThumbnails";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { BackAction } from "@/components/ui/BackAction";
import { Row } from "@/components/ui/Row";
import { SlimScrollView } from "@/components/ui/SlimScrollView";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import {
	deleteAttachment,
	participatingInventoryQuery,
	sharedInventoryQuery,
} from "@/data/attachments";
import { usePairedListener } from "@/hooks/use-paired-listener";
import {
	formatBytes,
	homeAttachmentCeiling,
	type InventoryOrder,
	type InventoryRow,
	inventoryRows,
	isImageType,
	quotaShare,
	quotaWarning,
	thumbnailPathFor,
	unseenBytes,
} from "@/models/attachment";
import type { Attachment } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	icon,
	radius,
	segmentedLabelLineHeight,
	size,
	space,
	touchTargetStyle,
} from "@/theme/tokens";

export default function AttachmentsInventory() {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { homeId } = useLocalSearchParams<{ homeId: string }>();
	const { user } = useAuth();
	const { homes } = useHome();
	const home = homes.find((candidate) => candidate.id === homeId) ?? null;

	const [order, setOrder] = useState<InventoryOrder>("largest");
	const [confirming, setConfirming] = useState<InventoryRow | null>(null);
	const [failed, setFailed] = useState(false);

	const pair = usePairedListener(
		`${homeId ?? ""}\u0000${user?.uid ?? ""}\u0000${homeId ? "open" : "off"}`,
		useCallback(() => {
			if (homeId === undefined || user === null) return null;
			return {
				shared: sharedInventoryQuery(homeId),
				participating: participatingInventoryQuery(homeId, user.uid),
			};
		}, [homeId, user]),
		{
			shared: "Could not load the home's attachments",
			participating: "Could not load your private attachments",
		},
	);

	const rows = inventoryRows(pair.nodes, order);
	const bytes = home?.attachmentBytes ?? 0;
	const hidden = unseenBytes(bytes, rows);
	const full = quotaWarning(bytes);

	// The name behind the uid the counter attributed the bytes to. A member
	// who has left has no profile left, and their bytes stay theirs.
	const nameOfUid = (uid: string) =>
		home?.memberProfiles?.[uid]?.displayName || t("members.unknown");

	const remove = async () => {
		const row = confirming;
		setConfirming(null);
		if (row === null) return;
		try {
			await deleteAttachment(homeId ?? "", row.nodeId, row.attachment);
		} catch {
			setFailed(true);
		}
	};

	if (homeId === undefined) return null;

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={t("manageHome.title")}
					onPress={() =>
						router.canGoBack()
							? router.back()
							: router.replace(`/homes/${homeId}`)
					}
				/>
				<Appbar.Content title={home?.name ?? ""} />
			</Appbar.Header>

			<SlimScrollView
				contentContainerStyle={{
					padding: space.md,
					gap: space.md,
					alignSelf: "center",
					width: "100%",
					maxWidth: contentWidth.form,
				}}
			>
				{/* The first thing this screen says: the number against the
				    ceiling. Words beside it only at nine tenths — below that the
				    number is not a nag, and the warning appears nowhere. */}
				<View style={{ gap: space.xs }}>
					<Text variant="titleMedium">
						{t("homes.attachmentsUsage", {
							used: formatBytes(bytes, i18n.language),
							total: formatBytes(homeAttachmentCeiling, i18n.language),
						})}
					</Text>
					{full ? (
						<Text variant="bodyMedium" style={{ color: theme.colors.warning }}>
							{t("homes.attachmentsAlmostFull", {
								percent: Math.round(quotaShare(bytes) * 100),
							})}
						</Text>
					) : null}
				</View>

				{Object.keys(home?.attachmentBytesByUid ?? {}).length === 0 ? null : (
					<View style={{ gap: space.xs }}>
						<Text
							variant="labelLarge"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("homes.attachmentsByPerson")}
						</Text>
						{Object.entries(home?.attachmentBytesByUid ?? {})
							.sort(([, a], [, b]) => b - a)
							.map(([uid, personBytes]) => (
								<Text
									key={uid}
									variant="bodySmall"
									style={{ color: theme.colors.onSurfaceVariant }}
								>
									{nameOfUid(uid)} · {formatBytes(personBytes, i18n.language)}
								</Text>
							))}
					</View>
				)}

				<SegmentedButtons
					value={order}
					onValueChange={(value) => setOrder(value as InventoryOrder)}
					buttons={[
						{
							value: "largest",
							label: t("homes.sortLargest"),
							labelStyle: { lineHeight: segmentedLabelLineHeight },
						},
						{
							value: "newest",
							label: t("homes.sortNewest"),
							labelStyle: { lineHeight: segmentedLabelLineHeight },
						},
					]}
				/>

				{/* The gap between the home's true total and what this member can
				    see, stated rather than hidden — a reader without every private
				    card would otherwise be told the home is fuller than their list
				    shows. The gap is the private cards' bytes plus every thumbnail,
				    which has no row of its own, so the line names both. */}
				{hidden > 0 ? (
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("homes.attachmentsHidden", {
							size: formatBytes(hidden, i18n.language),
						})}
					</Text>
				) : null}

				{pair.loading ? (
					<Text
						variant="bodyMedium"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("common.loading")}
					</Text>
				) : rows.length === 0 ? (
					<Text
						variant="bodyLarge"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("homes.attachmentsEmpty")}
					</Text>
				) : (
					<View>
						{rows.map((row) => (
							<View key={row.attachment.id}>
								<Divider />
								<InventoryEntry
									row={row}
									nameOfUid={nameOfUid}
									onDelete={() => setConfirming(row)}
								/>
							</View>
						))}
						<Divider />
					</View>
				)}
			</SlimScrollView>

			{confirming === null ? null : (
				<ConfirmDialog
					visible
					onDismiss={() => setConfirming(null)}
					onConfirm={() => void remove()}
					title={t("detail.attachmentsDeleteTitle", {
						name: confirming.attachment.name,
					})}
					body={t("detail.attachmentsDeleteBody")}
					confirmLabel={t("detail.attachmentsDelete")}
					destructive
					testID={`delete-attachment-${confirming.attachment.id}`}
				/>
			)}

			<Snackbar visible={failed} onDismiss={() => setFailed(false)}>
				{t("detail.attachmentsDeleteFailed")}
			</Snackbar>
		</View>
	);
}

function InventoryEntry({
	row,
	nameOfUid,
	onDelete,
}: {
	row: InventoryRow;
	nameOfUid: (uid: string) => string;
	onDelete: () => void;
}) {
	const { t, i18n } = useTranslation();
	const entry = row.attachment;
	const uploaded = entry.uploadedAt?.toDate();
	const when =
		uploaded === undefined
			? null
			: new Intl.DateTimeFormat(i18n.language, {
					dateStyle: "medium",
				}).format(uploaded);

	return (
		<Row
			left={<Thumb entry={entry} />}
			title={entry.name}
			description={
				// The card it lives on is how a size is reclaimed — you open the
				// card — so it rides between the date and who put it there.
				[row.nodeTitle, when, nameOfUid(entry.uploadedBy)]
					.filter((part) => part !== null && part !== "")
					.join(" · ")
			}
			right={
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.sm,
					}}
				>
					{/* The size is why the screen exists; it is the one row value
					    that does not sit in the muted tier. */}
					<Text variant="bodyMedium">
						{formatBytes(entry.size, i18n.language)}
					</Text>
					<IconButton
						icon="delete-outline"
						accessibilityLabel={t("detail.attachmentsDelete")}
						onPress={onDelete}
						style={touchTargetStyle}
					/>
				</View>
			}
		/>
	);
}

/** The attachment's thumbnail, or its type's glyph when it has no picture. */
function Thumb({ entry }: { entry: Attachment }) {
	const theme = useAppTheme();
	const image = isImageType(entry.contentType);
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!image) return;
		let cancelled = false;
		void urlOf(thumbnailPathFor(entry.path))
			.then((resolved) => {
				if (!cancelled) setUrl(resolved);
			})
			// A raced delete takes the object with it; the row keeps its glyph,
			// and the console stays clean.
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [entry.path, image]);

	return (
		<View
			style={{
				width: size.avatarSm,
				height: size.avatarSm,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{image && url !== null ? (
				<Image
					source={{ uri: url }}
					style={{
						width: size.avatarSm,
						height: size.avatarSm,
						borderRadius: radius.sm,
					}}
					resizeMode="cover"
					accessibilityLabel={entry.name}
				/>
			) : (
				<Icon
					source={image ? "image-outline" : fileGlyph(entry.contentType)}
					size={icon.md}
					color={theme.colors.onSurfaceVariant}
				/>
			)}
		</View>
	);
}

function fileGlyph(contentType: string): string {
	if (contentType === "application/pdf") return "file-pdf-box";
	if (contentType === "text/plain") return "text-box-outline";
	return "file-outline";
}
