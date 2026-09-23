import { getDownloadURL, ref } from "firebase/storage";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { Menu } from "react-native-paper";
import { AppMenu } from "@/components/ui/AppMenu";
import { storage } from "@/config/firebase";
import { isImageType } from "@/models/attachment";
import type { Attachment, Node } from "@/models/node";

/**
 * The actions an attachment can take, in one list — the viewer's bar and the
 * gesture menu both render this, so the gesture is never the only route to any
 * of them, and the two never disagree about what exists.
 *
 * `Set as hero` is an image's action, and only until it is already the one the
 * card draws. It stores the id on the node and touches nothing else: on a card
 * whose display mode is `count` it is the answer waiting for the day the mode
 * is switched.
 */
export interface AttachmentAction {
	key: "hero" | "download" | "delete";
	icon: string;
	label: string;
	onPress: () => void;
}

export function useAttachmentActions(
	node: Node,
	attachment: Attachment,
	handlers: {
		onHero: () => void;
		onDownload: () => void;
		onDelete: () => void;
	},
): AttachmentAction[] {
	const { t } = useTranslation();

	const actions: AttachmentAction[] = [
		{
			key: "download",
			icon: "download-outline",
			label: t("detail.attachmentsDownload"),
			onPress: handlers.onDownload,
		},
	];
	if (
		isImageType(attachment.contentType) &&
		node.heroAttachmentId !== attachment.id
	) {
		actions.push({
			key: "hero",
			icon: "wallpaper",
			label: t("detail.attachmentsHero"),
			onPress: handlers.onHero,
		});
	}
	actions.push({
		key: "delete",
		icon: "delete-outline",
		label: t("detail.attachmentsDelete"),
		onPress: handlers.onDelete,
	});
	return actions;
}

/**
 * The original, not the thumbnail. A download URL is cross-origin, where an
 * anchor's `download` name is ignored — so the bytes are fetched and handed
 * over as an object URL first, and a fetch the browser refuses falls back to
 * opening the original in a tab.
 */
export async function downloadAttachment(
	attachment: Attachment,
): Promise<void> {
	if (Platform.OS !== "web" || typeof document === "undefined") return;
	const url = await getDownloadURL(ref(storage, attachment.path));
	try {
		const response = await fetch(url);
		const href = URL.createObjectURL(await response.blob());
		const anchor = document.createElement("a");
		anchor.href = href;
		anchor.download = attachment.name;
		anchor.click();
		// Revoked after a beat rather than at once: Safari has been known to
		// abort a download whose object URL died before the reader got to it.
		setTimeout(() => URL.revokeObjectURL(href), revokeDelayMs);
	} catch {
		window.open(url, "_blank");
	}
}

/** How long a download may take to pick up its object URL before it is revoked. */
const revokeDelayMs = 10000;

interface AttachmentMenuProps {
	/** Where the gesture happened, in viewport coordinates; `null` is closed. */
	anchor: { x: number; y: number } | null;
	node: Node;
	attachment: Attachment;
	onDismiss: () => void;
	onHero: () => void;
	onDelete: () => void;
}

/**
 * The gesture's shortcut menu, opened by long-press and right-click at the
 * position the gesture happened at. Every item here is also in the viewer's
 * bar — the tap is the route that always exists.
 */
export function AttachmentMenu({
	anchor,
	node,
	attachment,
	onDismiss,
	onHero,
	onDelete,
}: AttachmentMenuProps) {
	const { t } = useTranslation();
	const actions = useAttachmentActions(node, attachment, {
		onHero,
		onDownload: () => void downloadAttachment(attachment),
		onDelete,
	});

	if (anchor === null) return null;
	return (
		<AppMenu
			visible
			onDismiss={onDismiss}
			overlayAccessibilityLabel={t("common.closeMenu")}
			anchor={anchor}
		>
			<View testID={`attachment-menu-${attachment.id}`}>
				{actions.map((action) => (
					<Menu.Item
						key={action.key}
						leadingIcon={action.icon}
						title={action.label}
						onPress={() => {
							onDismiss();
							action.onPress();
						}}
					/>
				))}
			</View>
		</AppMenu>
	);
}
