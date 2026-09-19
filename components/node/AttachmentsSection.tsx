import { getDownloadURL, ref } from "firebase/storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Platform, View } from "react-native";
import { ActivityIndicator, Button, Icon, Text } from "react-native-paper";
import { Row } from "@/components/ui/Row";
import { storage } from "@/config/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { uploadAttachment } from "@/data/attachments";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
	type AttachmentErrorKey,
	attachmentAccept,
	attachmentErrorKey,
	formatBytes,
	isImageType,
	maxAttachmentBytes,
	thumbnailPathFor,
} from "@/models/attachment";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { border, icon, radius, space, touchTarget } from "@/theme/tokens";

interface AttachmentsSectionProps {
	homeId: string;
	/** The card these belong to — its own listener is the truth of the list. */
	node: Node;
}

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
export function AttachmentsSection({ homeId, node }: AttachmentsSectionProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const { user } = useAuth();
	const online = useOnlineStatus();

	const [urls, setUrls] = useState<Record<string, string>>({});
	const [uploading, setUploading] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [message, setMessage] = useState<AttachmentErrorKey | null>(null);

	const images = node.attachments.filter((entry) =>
		isImageType(entry.contentType),
	);
	const files = node.attachments.filter(
		(entry) => !isImageType(entry.contentType),
	);
	const [lead, ...rest] = images;

	const addFiles = useCallback(
		(list: FileList | readonly File[]) => {
			const picked = Array.from(list);
			const uid = user?.uid;
			if (picked.length === 0 || uploading || !online || uid === undefined) {
				return;
			}
			setMessage(null);
			setUploading(true);
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
				setUploading(false);
				const firstRefused = results.find(
					(result) => result.status === "rejected",
				) as PromiseRejectedResult | undefined;
				if (firstRefused !== undefined) {
					setMessage(attachmentErrorKey(firstRefused.reason));
				}
			});
		},
		[homeId, node.id, online, uploading, user],
	);

	// A download URL carries a rotating token, so it is asked for at render
	// time from the stored path (`models/node.ts` explains why none are stored)
	// and remembered per path for as long as the screen lives.
	const resolved = useRef(new Map<string, string>());
	useEffect(() => {
		const wanted: string[] = [];
		for (const entry of node.attachments) {
			if (!isImageType(entry.contentType)) continue;
			if (!resolved.current.has(entry.path)) wanted.push(entry.path);
			const thumb = thumbnailPathFor(entry.path);
			if (!resolved.current.has(thumb)) wanted.push(thumb);
		}
		if (wanted.length === 0) return;

		let cancelled = false;
		void Promise.allSettled(
			wanted.map(async (path) => {
				resolved.current.set(path, await getDownloadURL(ref(storage, path)));
			}),
		).then(() => {
			if (!cancelled) setUrls(Object.fromEntries(resolved.current));
		});
		return () => {
			cancelled = true;
		};
	}, [node.attachments]);

	const openPicker = useCallback(() => {
		if (Platform.OS !== "web" || typeof document === "undefined") return;
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = attachmentAccept;
		input.onchange = () => {
			if (input.files !== null) addFiles(input.files);
		};
		input.click();
	}, [addFiles]);

	// react-native-web has no drag props on `View`, so the section's own DOM
	// node carries them. `dragover` has to keep being prevented or the browser
	// takes the file for itself.
	const section = useRef<View>(null);
	useEffect(() => {
		const element = section.current as unknown as HTMLElement | null;
		if (
			Platform.OS !== "web" ||
			element === null ||
			typeof element.addEventListener !== "function"
		) {
			return;
		}
		const over = (event: DragEvent) => {
			event.preventDefault();
			setDragging(true);
		};
		const leave = (event: DragEvent) => {
			const from = event.relatedTarget as Element | null;
			if (from === null || !element.contains(from)) {
				setDragging(false);
			}
		};
		const drop = (event: DragEvent) => {
			event.preventDefault();
			setDragging(false);
			if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
		};
		element.addEventListener("dragover", over);
		element.addEventListener("dragleave", leave);
		element.addEventListener("drop", drop);
		return () => {
			element.removeEventListener("dragover", over);
			element.removeEventListener("dragleave", leave);
			element.removeEventListener("drop", drop);
		};
	}, [addFiles]);

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

	return (
		<View
			ref={section}
			style={{
				gap: space.md,
				borderRadius: radius.sm,
				borderWidth: border.hairline,
				borderColor: dragging ? theme.colors.outline : "transparent",
			}}
		>
			<Text
				variant="labelLarge"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{t("detail.attachments")}
			</Text>

			{/* The one the eye lands on — the first image, which the hero mode on
			    the board would draw too. */}
			{lead !== undefined && urls[lead.path] !== undefined ? (
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
			) : null}

			{chunks(rest, gridColumns).map((row) => (
				<View key={row[0]?.id} style={{ flexDirection: "row", gap: space.sm }}>
					{Array.from({ length: gridColumns }, (_, column) => {
						const entry = row[column];
						const uri =
							entry === undefined
								? undefined
								: urls[thumbnailPathFor(entry.path)];
						return (
							<View
								key={entry?.id ?? `empty-${column}`}
								style={{ flex: 1, aspectRatio: 1 }}
							>
								{entry === undefined || uri === undefined ? null : (
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
								)}
							</View>
						);
					})}
				</View>
			))}

			{files.map((entry) => (
				<Row
					key={entry.id}
					left={<Icon source={fileGlyph(entry.contentType)} size={icon.md} />}
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
			))}

			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
			>
				<Button
					mode="outlined"
					icon="plus"
					onPress={openPicker}
					disabled={!online || uploading}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("detail.attachmentsAdd")}
				</Button>
				{uploading ? (
					<ActivityIndicator
						accessibilityLabel={t("detail.attachmentsUploading")}
					/>
				) : null}
			</View>

			{!online ? (
				<Text
					variant="bodySmall"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("detail.attachmentsOffline")}
				</Text>
			) : null}

			{message === null ? null : (
				<Text variant="bodyMedium" style={{ color: theme.colors.error }}>
					{t(message, {
						limit: formatBytes(maxAttachmentBytes, i18n.language),
					})}
				</Text>
			)}
		</View>
	);
}
