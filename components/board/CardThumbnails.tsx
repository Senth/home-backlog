import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { Text } from "react-native-paper";
import { badgeAttachmentId, thumbnailPathFor } from "@/models/attachment";
import type { Attachment } from "@/models/node";
import { useAppTheme } from "@/theme";
import { radius, space } from "@/theme/tokens";

/**
 * Download URLs, asked for once per object path and shared by every surface
 * that draws the same attachment — the board's card faces, the details
 * gallery and the inventory rows are one fetch each, not one per card per
 * render. A URL carries a rotating token, which is why none are stored
 * (`models/node.ts`); the cache lives exactly as long as the session does. A
 * path Storage answers does not exist keeps its **rejection** cached: asking
 * again on a later render cannot succeed, and the fetch itself is the 404
 * the console logs — only a transient failure (offline, a flap) is allowed
 * to retry.
 */
const resolved = new Map<string, Promise<string>>();

export function urlOf(path: string): Promise<string> {
	const cached = resolved.get(path);
	if (cached !== undefined) return cached;
	const url = (async () => {
		// Required here, not at the top of the module, so evaluating a card
		// face still touches no Storage — the modules are read only when the
		// first URL is asked for. `import()` cannot be it: jest executes a
		// dynamic import only under --experimental-vm-modules, and the tests
		// of the surfaces that now share this cache must reach it.
		const { getDownloadURL, ref } = require("firebase/storage");
		const { storage } = require("@/config/firebase");
		return getDownloadURL(ref(storage, path));
	})();
	resolved.set(path, url);
	url.catch((reason) => {
		if (
			(reason as { code?: string } | null)?.code !== "storage/object-not-found"
		)
			resolved.delete(path);
	});
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
 * padded to the same three cells, keeping the tile size; the `+N` badge rides
 * the last tile that actually draws (`badgeAttachmentId`), so it never floats
 * in a cell whose picture cannot resolve.
 */
export function CardThumbnails({ images }: CardThumbnailsProps) {
	const theme = useAppTheme();
	const [urls, setUrls] = useState<Record<string, string>>({});
	const tiles = images.slice(0, shown);
	const more = images.length - tiles.length;

	// The drawn paths, not the array identity, are what the effect answers to:
	// `cardFace` hands the face a fresh array every render, so keying on the
	// list would re-ask Storage for every tile on every parent render — and
	// re-ask for a tile that has no object, which is the 404 the console
	// kept logging.
	const drawnPaths = tiles.map((entry) => entry.path).join("\u0000");

	// biome-ignore lint/correctness/useExhaustiveDependencies: the fetch is keyed on the drawn paths, which is what keeps one fetch per object.
	useEffect(() => {
		if (tiles.length === 0) return;

		let cancelled = false;
		void Promise.allSettled(
			tiles.map(
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
	}, [drawnPaths]);

	// A short row is padded to the same three cells, each placeholder named
	// rather than numbered, so a tile never stretches to fill the row.
	const cells: (Attachment | { placeholder: string })[] = [...tiles];
	for (let at = tiles.length; at < shown; at++) {
		cells.push({ placeholder: `cell-${at}` });
	}

	// The badge speaks for the images beyond the row, so it sits on the last
	// tile that actually draws — never on a slot whose thumbnail is missing.
	const badgeOn = badgeAttachmentId(tiles, urls, more);

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
						{cell.id !== badgeOn ? null : (
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
