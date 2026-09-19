import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { Text } from "react-native-paper";
import { thumbnailPathFor } from "@/models/attachment";
import type { Attachment } from "@/models/node";
import { useAppTheme } from "@/theme";
import { radius, space } from "@/theme/tokens";

/**
 * Download URLs, asked for once per object path and shared by every card that
 * draws the same attachment — a board of thumbnail cards is one fetch each,
 * not one per card per render. A URL carries a rotating token, which is why
 * none are stored (`models/node.ts`); the cache lives exactly as long as the
 * session does.
 */
const resolved = new Map<string, Promise<string>>();

export function urlOf(path: string): Promise<string> {
	const cached = resolved.get(path);
	if (cached !== undefined) return cached;
	const url = (async () => {
		// Imported lazily: a card face draws no bytes until it has images to
		// draw, and no suite that renders a card should have to know Storage
		// exists.
		const { getDownloadURL, ref } = await import("firebase/storage");
		const { storage } = await import("@/config/firebase");
		return getDownloadURL(ref(storage, path));
	})();
	resolved.set(path, url);
	url.catch(() => resolved.delete(path));
	return url;
}

/** How many tiles the face draws before the badge speaks for the rest. */
const shown = 3;

interface CardThumbnailsProps {
	/** The card's images, already degraded by `cardFace`. */
	images: readonly Attachment[];
}

/**
 * The thumbnails face (#298): one row under the footer, inside the content
 * column — three tiles, each a third of the column and a third apart, so they
 * divide whatever room the card has instead of overflowing it. A short row is
 * padded to the same three cells, keeping the tile size; the third carries a
 * `+N` badge when the card holds more than the row shows.
 */
export function CardThumbnails({ images }: CardThumbnailsProps) {
	const theme = useAppTheme();
	const [urls, setUrls] = useState<Record<string, string>>({});
	const tiles = images.slice(0, shown);
	const more = images.length - tiles.length;

	useEffect(() => {
		// Sliced inside so the effect's only dependency is the attachment list
		// itself — the identity the node's listener keeps stable between
		// changes, which is what keeps this from resolving on every render.
		const drawn = images.slice(0, shown);
		if (drawn.length === 0) return;

		let cancelled = false;
		void Promise.allSettled(
			drawn.map(
				async (entry) =>
					[entry.id, await urlOf(thumbnailPathFor(entry.path))] as const,
			),
		).then((results) => {
			if (cancelled) return;
			const next: Record<string, string> = {};
			for (const result of results) {
				if (result.status === "fulfilled") {
					const [id, url] = result.value;
					next[id] = url;
				}
			}
			setUrls(next);
		});
		return () => {
			cancelled = true;
		};
	}, [images]);

	// A short row is padded to the same three cells, each placeholder named
	// rather than numbered, so a tile never stretches to fill the row.
	const cells: (Attachment | { placeholder: string })[] = [...tiles];
	for (let at = tiles.length; at < shown; at++) {
		cells.push({ placeholder: `cell-${at}` });
	}

	return (
		<View style={{ flexDirection: "row", gap: space.xs }}>
			{cells.map((cell) => {
				if ("placeholder" in cell) {
					return (
						<View key={cell.placeholder} style={{ flex: 1, aspectRatio: 1 }} />
					);
				}
				const uri = urls[cell.id];
				return (
					<View key={cell.id} style={{ flex: 1, aspectRatio: 1 }}>
						{uri === undefined ? null : (
							<Image
								source={{ uri }}
								style={{ width: "100%", height: "100%" }}
								resizeMode="cover"
								accessibilityLabel={cell.name}
							/>
						)}
						{cell !== tiles[shown - 1] || more <= 0 ? null : (
							<View
								style={{
									position: "absolute",
									bottom: space.xs,
									right: space.xs,
									backgroundColor: theme.colors.boardCard,
									borderRadius: radius.sm,
									paddingHorizontal: space.xs,
								}}
							>
								<Text
									variant="labelMedium"
									style={{ color: theme.colors.onCardMuted }}
								>
									+{more}
								</Text>
							</View>
						)}
					</View>
				);
			})}
		</View>
	);
}
