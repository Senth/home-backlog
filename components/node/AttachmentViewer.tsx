import { getDownloadURL, ref } from "firebase/storage";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, View } from "react-native";
import {
	ActivityIndicator,
	IconButton,
	Modal,
	Portal,
	Text,
} from "react-native-paper";
import {
	downloadAttachment,
	useAttachmentActions,
} from "@/components/node/AttachmentMenu";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { storage } from "@/config/firebase";
import { deleteAttachment } from "@/data/attachments";
import type { NodeChanges } from "@/data/nodes";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { formatBytes, isImageType } from "@/models/attachment";
import type { Attachment, Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface AttachmentViewerProps {
	homeId: string;
	node: Node;
	attachment: Attachment;
	onDismiss: () => void;
	/** The ordinary node write, so *Set as hero* is one field on the card. */
	onSave: (changes: NodeChanges) => void;
}

/**
 * One attachment, at full size — the screen Ingrid lands on when she taps a
 * photo. Everything that is not the file is gone while it is open: the image
 * contained in the window, one bar of actions under it, one close at the top.
 * A non-image has no preview to show, so it says what it is instead of faking
 * one.
 *
 * Delete asks first, naming the file, and any member may delete any attachment
 * the card can show — ownership is a concept this app does not have. The hero
 * action writes one field and leaves the card's display mode exactly as it
 * was.
 */
export function AttachmentViewer({
	homeId,
	node,
	attachment,
	onDismiss,
	onSave,
}: AttachmentViewerProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const image = isImageType(attachment.contentType);

	const [url, setUrl] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [failed, setFailed] = useState(false);

	// The original at full size, from the stored path — the thumbnail stays
	// where it belongs, on the card.
	useEffect(() => {
		let cancelled = false;
		getDownloadURL(ref(storage, attachment.path))
			.then((resolved) => {
				if (!cancelled) setUrl(resolved);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [attachment.path]);

	const testID = `attachment-viewer-${attachment.id}`;
	useModalFocus(true, testID, onDismiss, {
		scrim: { testID: `${testID}-backdrop`, label: t("common.closeDialog") },
	});

	const remove = async () => {
		setDeleting(false);
		try {
			await deleteAttachment(homeId, node.id, attachment);
			onDismiss();
		} catch {
			setFailed(true);
		}
	};

	const actions = useAttachmentActions(node, attachment, {
		onHero: () => onSave({ heroAttachmentId: attachment.id }),
		onDownload: () => void downloadAttachment(attachment),
		onDelete: () => setDeleting(true),
	});

	return (
		<Portal>
			<Modal
				visible
				onDismiss={onDismiss}
				testID={testID}
				overlayAccessibilityLabel={t("common.closeDialog")}
				contentContainerStyle={{
					flex: 1,
					backgroundColor: theme.colors.background,
				}}
			>
				{/* The way out, above everything — Ingrid's quit condition is
				    hunting for it, so it is a full target in the corner and not a
				    gesture. Stacked above the image, which would otherwise win
				    the tap over its own corner. */}
				<View
					style={{
						position: "absolute",
						top: space.md,
						right: space.md,
						zIndex: 1,
					}}
				>
					<IconButton
						icon="close"
						accessibilityLabel={t("detail.attachmentsClose")}
						onPress={onDismiss}
					/>
				</View>

				{image ? (
					<View style={{ flex: 1 }}>
						{url === null ? (
							<ActivityIndicator
								accessibilityLabel={t("common.loading")}
								style={{ flex: 1 }}
							/>
						) : (
							<Image
								source={{ uri: url }}
								style={{ width: "100%", height: "100%" }}
								resizeMode="contain"
								accessibilityLabel={attachment.name}
							/>
						)}
					</View>
				) : (
					<View
						style={{
							flex: 1,
							alignItems: "center",
							justifyContent: "center",
							gap: space.sm,
						}}
					>
						<Text variant="bodyLarge">{attachment.name}</Text>
						<Text
							variant="bodyMedium"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{formatBytes(attachment.size, i18n.language)}
						</Text>
					</View>
				)}

				{failed ? (
					<Text
						variant="bodySmall"
						style={{
							color: theme.colors.error,
							alignSelf: "center",
							marginBottom: space.sm,
						}}
					>
						{t("detail.attachmentsDeleteFailed")}
					</Text>
				) : null}

				<View
					style={{
						flexDirection: "row",
						justifyContent: "center",
						gap: space.sm,
						paddingBottom: space.lg,
					}}
				>
					{actions.map((action) => (
						<IconButton
							key={action.key}
							icon={action.icon}
							accessibilityLabel={action.label}
							onPress={action.onPress}
						/>
					))}
				</View>

				{deleting ? (
					<ConfirmDialog
						visible
						onDismiss={() => setDeleting(false)}
						onConfirm={() => void remove()}
						title={t("detail.attachmentsDeleteTitle", {
							name: attachment.name,
						})}
						body={t("detail.attachmentsDeleteBody")}
						confirmLabel={t("detail.attachmentsDelete")}
						destructive
						testID={`delete-attachment-${attachment.id}`}
					/>
				) : null}
			</Modal>
		</Portal>
	);
}
