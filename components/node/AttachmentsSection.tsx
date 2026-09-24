import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GestureResponderEvent } from "react-native";
import {
	Image,
	Platform,
	Pressable,
	useWindowDimensions,
	View,
} from "react-native";
import { Button, Icon, Text } from "react-native-paper";
import { urlOf } from "@/components/board/CardThumbnails";
import { AttachmentDropZone } from "@/components/node/AttachmentDropZone";
import { AttachmentMenu } from "@/components/node/AttachmentMenu";
import { AttachmentModeChip } from "@/components/node/AttachmentModeChip";
import { AttachmentViewer } from "@/components/node/AttachmentViewer";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { Row } from "@/components/ui/Row";
import { useAuth } from "@/contexts/AuthContext";
import { deleteAttachment, uploadAttachment } from "@/data/attachments";
import type { NodeChanges } from "@/data/nodes";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
	attachmentAccept,
	formatBytes,
	isImageType,
	maxAttachmentBytes,
	namedRefusals,
	photoAccept,
	thumbnailPathFor,
} from "@/models/attachment";
import type { Attachment, Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, radius, space, touchTarget } from "@/theme/tokens";

interface AttachmentsSectionProps {
	homeId: string;
	/** The card these belong to — its own listener is the truth of the list. */
	node: Node;
	/** The ordinary node write, so *Set as hero* is one field on the card. */
	onSave: (changes: NodeChanges) => void;
}

/** Where a long-press or right-click happened, in viewport coordinates. */
type MenuAnchor = { x: number; y: number };

/** Across on the content column; a row of fewer keeps the same tile size. */
const gridColumns = 3;

function chunks<T>(items: readonly T[], per: number): T[][] {
	const rows: T[][] = [];
	for (let at = 0; at < items.length; at += per) {
		rows.push(items.slice(at, at + per));
	}
	return rows;
}

function fileGlyph(contentType: string): string {
	if (contentType === "application/pdf") return "file-pdf-box";
	if (contentType === "text/plain") return "text-box-outline";
	return "file-outline";
}

/**
 * One row of the grid, padded to `per` cells with named placeholders — the
 * empty cells keep a filled row's tile size instead of stretching, and a
 * placeholder's stable name is what the cell is keyed by.
 */
type GridCell = Attachment | { placeholder: string };

function paddedRow(row: readonly Attachment[], per: number): GridCell[] {
	const cells: GridCell[] = [...row];
	for (let at = row.length; at < per; at++) {
		cells.push({ placeholder: `cell-${at}` });
	}
	return cells;
}

/**
 * The pictures and the documents a card carries (#298), directly after Notes —
 * an attachment is something a person put on the card exactly as a note is.
 *
 * The first image leads full width, the rest sit three across, and non-images
 * read as rows of name and size. Getting a file in, on the web this is, is
 * three doors onto one path — the Add button's file picker, a drop onto the
 * section, a paste — so there is one thing to test and one place a refusal
 * becomes a sentence.
 *
 * **Offline the control is disabled and says why**: Storage has no queue, and
 * a photo that dies in a stalled request is worse than one never accepted.
 */
export function AttachmentsSection({
	homeId,
	node,
	onSave,
}: AttachmentsSectionProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();
	const online = useOnlineStatus();
	const coarse = useCoarsePointer();

	const [urls, setUrls] = useState<Record<string, string>>({});
	const [uploadingCount, setUploadingCount] = useState(0);
	const [refusals, setRefusals] = useState<ReturnType<typeof namedRefusals>>(
		[],
	);
	const [deleteFailed, setDeleteFailed] = useState(false);
	const [viewing, setViewing] = useState<Attachment | null>(null);
	const [menu, setMenu] = useState<{
		anchor: MenuAnchor;
		attachment: Attachment;
	} | null>(null);
	const [confirming, setConfirming] = useState<Attachment | null>(null);

	const images = node.attachments.filter((entry) =>
		isImageType(entry.contentType),
	);
	const files = node.attachments.filter(
		(entry) => !isImageType(entry.contentType),
	);
	const [lead, ...rest] = images;
	// The grid draws only what the face draws: an image whose thumbnail
	// cannot resolve takes no slot at all, the way the lead above skips.
	const drawn = rest.filter(
		(entry) => urls[thumbnailPathFor(entry.path)] !== undefined,
	);

	const addFiles = useCallback(
		(list: FileList | readonly File[]) => {
			const picked = Array.from(list);
			const uid = user?.uid;
			if (
				picked.length === 0 ||
				uploadingCount > 0 ||
				!online ||
				uid === undefined
			) {
				return;
			}
			setRefusals([]);
			setDeleteFailed(false);
			setUploadingCount(picked.length);
			void Promise.allSettled(
				picked.map((file) =>
					uploadAttachment(homeId, node.id, uid, {
						name: file.name,
						contentType: file.type,
						size: file.size,
						blob: file,
					}),
				),
			).then((results) => {
				setUploadingCount(0);
				setRefusals(
					namedRefusals(
						picked.map((file) => file.name),
						results,
					),
				);
			});
		},
		[homeId, node.id, online, uploadingCount, user],
	);

	// A download URL carries a rotating token, so it is asked for at render
	// time from the stored path (`models/node.ts` explains why none are stored)
	// through the shared `urlOf` cache — the one CardThumbnails' docblock
	// owns, which keeps a not-found rejection cached so a thumbnail whose
	// object never existed is one 404 per session, not one per node write.
	useEffect(() => {
		const wanted: string[] = [];
		for (const entry of node.attachments) {
			if (!isImageType(entry.contentType)) continue;
			wanted.push(entry.path, thumbnailPathFor(entry.path));
		}
		if (wanted.length === 0) return;

		let cancelled = false;
		void Promise.allSettled(
			wanted.map(async (path) => [path, await urlOf(path)] as const),
		).then((results) => {
			if (cancelled) return;
			const next: Record<string, string> = {};
			for (const result of results) {
				if (result.status === "fulfilled") {
					const [path, url] = result.value;
					next[path] = url;
				}
			}
			setUrls((prev) => ({ ...prev, ...next }));
		});
		return () => {
			cancelled = true;
		};
	}, [node.attachments]);

	const openPicker = useCallback(
		(accept: string) => {
			if (Platform.OS !== "web" || typeof document === "undefined") return;
			const input = document.createElement("input");
			input.type = "file";
			input.multiple = true;
			input.accept = accept;
			input.onchange = () => {
				if (input.files !== null) addFiles(input.files);
			};
			input.click();
		},
		[addFiles],
	);

	const section = useRef<View>(null);
	const phase = useFileDrop(section, addFiles);

	// Pasting a copied image attaches it, wherever the focus happens to be on
	// this screen. A paste that carries no files — text, mostly — is left alone.
	useEffect(() => {
		if (Platform.OS !== "web" || typeof document === "undefined") return;
		const paste = (event: ClipboardEvent) => {
			if (!event.clipboardData?.files.length) return;
			event.preventDefault();
			addFiles(event.clipboardData.files);
		};
		document.addEventListener("paste", paste);
		return () => document.removeEventListener("paste", paste);
	}, [addFiles]);

	// Tap is the route that always exists — the viewer and its bar — and the
	// gestures are the shortcut on top: long-press on a phone, right-click on
	// the desktop, both opening the same action list where the gesture
	// happened. Nothing is reachable only by gesture.
	const { width, height } = useWindowDimensions();
	const pressProps = (attachment: Attachment) => ({
		onPress: () => setViewing(attachment),
		onLongPress: (event: GestureResponderEvent) => {
			const at = event.nativeEvent as unknown as {
				clientX?: number;
				clientY?: number;
			};
			setMenu({
				attachment,
				anchor: { x: at.clientX ?? width / 2, y: at.clientY ?? height / 2 },
			});
		},
		...(Platform.OS === "web"
			? {
					onContextMenu: (event: MouseEvent) => {
						event.preventDefault();
						setMenu({
							attachment,
							anchor: { x: event.clientX, y: event.clientY },
						});
					},
				}
			: {}),
	});

	const remove = async (attachment: Attachment) => {
		setConfirming(null);
		try {
			await deleteAttachment(homeId, node.id, attachment);
		} catch {
			setDeleteFailed(true);
		}
	};

	return (
		<>
			<View ref={section} style={{ gap: space.md }}>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
				>
					<Text
						variant="labelLarge"
						style={{
							color: theme.colors.onSurfaceVariant,
							flex: 1,
						}}
					>
						{t("detail.attachments")}
					</Text>
					{/* What the card's face shows, beside what it governs — it exists
					    only while the card has a picture for a face to show. */}
					<AttachmentModeChip node={node} onSave={onSave} />
				</View>

				{/* The one the eye lands on — the first image, which the hero mode on
			    the board would draw too. A tap opens it properly; the gestures
			    offer the actions where the finger already is. */}
				{lead !== undefined && urls[lead.path] !== undefined ? (
					<Pressable {...pressProps(lead)}>
						<Image
							source={{ uri: urls[lead.path] }}
							style={{
								width: "100%",
								aspectRatio: 4 / 3,
								borderRadius: radius.sm,
							}}
							resizeMode="cover"
							accessibilityLabel={lead.name}
						/>
					</Pressable>
				) : null}

				{chunks(drawn, gridColumns).map((row) => (
					<View
						key={row[0]?.id}
						style={{ flexDirection: "row", gap: space.sm }}
					>
						{paddedRow(row, gridColumns).map((cell) => {
							if ("placeholder" in cell) {
								return (
									<View
										key={cell.placeholder}
										style={{ flex: 1, aspectRatio: 1 }}
									/>
								);
							}
							const entry = cell;
							const uri = urls[thumbnailPathFor(entry.path)];
							if (uri === undefined) return null;
							return (
								<Pressable
									key={entry.id}
									style={{ flex: 1, aspectRatio: 1 }}
									{...pressProps(entry)}
								>
									<Image
										source={{ uri }}
										style={{
											width: "100%",
											height: "100%",
											borderRadius: radius.sm,
										}}
										resizeMode="cover"
										accessibilityLabel={entry.name}
									/>
								</Pressable>
							);
						})}
					</View>
				))}

				{files.map((entry) => (
					<Pressable key={entry.id} {...pressProps(entry)}>
						<Row
							left={
								<Icon source={fileGlyph(entry.contentType)} size={icon.md} />
							}
							title={entry.name}
							right={
								<Text
									variant="bodyMedium"
									style={{ color: theme.colors.onSurfaceVariant }}
								>
									{formatBytes(entry.size, i18n.language)}
								</Text>
							}
						/>
					</Pressable>
				))}

				{coarse ? (
					<View style={{ gap: space.sm }}>
						<View
							style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
						>
							<Button
								mode="outlined"
								icon="image-plus-outline"
								onPress={() => openPicker(photoAccept)}
								disabled={!online || uploadingCount > 0}
								style={{ flex: 1, minWidth: touchTarget * 3 }}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("detail.attachmentsAddPhotos")}
							</Button>
							<Button
								mode="outlined"
								icon="file-plus-outline"
								onPress={() => openPicker(attachmentAccept)}
								disabled={!online || uploadingCount > 0}
								style={{ flex: 1, minWidth: touchTarget * 3 }}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("detail.attachmentsAddFiles")}
							</Button>
						</View>
						<Text
							variant="bodySmall"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{!online
								? t("detail.attachmentsOffline")
								: uploadingCount > 0
									? t("detail.attachmentsUploadingCount", {
											count: uploadingCount,
										})
									: t("detail.attachmentsLimits", {
											limit: formatBytes(maxAttachmentBytes, i18n.language),
										})}
						</Text>
					</View>
				) : (
					<AttachmentDropZone
						size={node.attachments.length === 0 ? "large" : "slim"}
						phase={phase}
						state={
							!online ? "offline" : uploadingCount > 0 ? "uploading" : "ready"
						}
						uploadingCount={uploadingCount}
						onPress={() => openPicker(attachmentAccept)}
					/>
				)}

				{refusals.length > 0 || deleteFailed ? (
					<View style={{ gap: space.xs }}>
						{refusals.map(({ name, key }) => (
							<Text
								key={name}
								variant="bodyMedium"
								style={{ color: theme.colors.error }}
							>
								{t("detail.attachmentsNamedRefusal", {
									name,
									reason: t(key, {
										limit: formatBytes(maxAttachmentBytes, i18n.language),
									}),
								})}
							</Text>
						))}
						{deleteFailed ? (
							<Text variant="bodyMedium" style={{ color: theme.colors.error }}>
								{t("detail.attachmentsDeleteFailed")}
							</Text>
						) : null}
						{/* The one refusal with a remedy: at the ceiling, the way to
						    do something about it is the inventory, and the refusal
						    names it instead of leaving a failure with nothing behind
						    it. */}
						{refusals.some(({ key }) => key === "detail.attachmentsQuota") ? (
							<Button
								mode="text"
								icon="clipboard-list-outline"
								onPress={() => router.push(`/homes/${homeId}/attachments`)}
							>
								{t("detail.attachmentsInventoryOpen")}
							</Button>
						) : null}
					</View>
				) : null}
			</View>

			{/* The viewer and the gesture menu, mounted only while open — the way
		    every dialog on this screen is. The confirm is the grid route's own;
		    the viewer carries its own. */}
			{viewing === null ? null : (
				<AttachmentViewer
					homeId={homeId}
					node={node}
					attachment={viewing}
					onDismiss={() => setViewing(null)}
					onSave={onSave}
				/>
			)}

			{menu === null ? null : (
				<AttachmentMenu
					anchor={menu.anchor}
					node={node}
					attachment={menu.attachment}
					onDismiss={() => setMenu(null)}
					onHero={() => onSave({ heroAttachmentId: menu.attachment.id })}
					onDelete={() => setConfirming(menu.attachment)}
				/>
			)}

			{confirming === null ? null : (
				<ConfirmDialog
					visible
					onDismiss={() => setConfirming(null)}
					onConfirm={() => void remove(confirming)}
					title={t("detail.attachmentsDeleteTitle", { name: confirming.name })}
					body={t("detail.attachmentsDeleteBody")}
					confirmLabel={t("detail.attachmentsDelete")}
					destructive
					testID={`delete-attachment-${confirming.id}`}
				/>
			)}
		</>
	);
}
