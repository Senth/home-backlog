import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Chip } from "react-native-paper";
import { ChoiceField } from "@/components/node/ChoiceField";
import { AppSheet } from "@/components/ui/AppSheet";
import type { NodeChanges } from "@/data/nodes";
import { cardFace } from "@/models/attachment";
import type { Node } from "@/models/node";
import { type AttachmentDisplay, attachmentDisplays } from "@/models/node";
import { outlinedTouchTarget } from "@/theme/tokens";

interface AttachmentModeChipProps {
	node: Node;
	/** The ordinary node write — the mode is one field on the card. */
	onSave: (changes: NodeChanges) => void;
}

/**
 * What the card's face shows, chosen per card (#298).
 *
 * It sits in the gallery's header on the details screen, beside what it
 * governs: as an eleventh row in the settled order it would sit some fourteen
 * hundred pixels below the pictures it controls. It appears only when the card
 * holds at least one image — a card with only documents has one face, the
 * count, and no question to ask. Quiet by tier: an outlined chip in the same
 * register as the labels around it, not a second way forward.
 */
export function AttachmentModeChip({ node, onSave }: AttachmentModeChipProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const face = cardFace(node);

	if (face.images.length === 0) return null;

	const labelFor = (mode: AttachmentDisplay) =>
		t(
			mode === "count"
				? "detail.attachmentsModeCount"
				: mode === "thumbnails"
					? "detail.attachmentsModeThumbnails"
					: "detail.attachmentsModeHero",
		);

	return (
		<>
			<Chip
				mode="outlined"
				icon="tune"
				onPress={() => setOpen(true)}
				accessibilityLabel={t("detail.attachmentsModeChange")}
				// Paper's chip is 32dp; nothing tappable may be. Same treatment as
				// `ChoiceField`'s chips, minus the grow-to-fill.
				style={{ minHeight: outlinedTouchTarget }}
			>
				{labelFor(face.mode)}
			</Chip>

			{/* Mounted only while open, the way every editor on this screen is. */}
			{open ? (
				<AppSheet
					visible
					onDismiss={() => setOpen(false)}
					testID="attachment-mode-sheet"
				>
					<ChoiceField
						label={t("detail.attachmentsModeSheet")}
						value={face.mode}
						values={attachmentDisplays}
						labelFor={labelFor}
						onChange={(mode) => {
							setOpen(false);
							if (mode !== null) onSave({ attachmentDisplay: mode });
						}}
					/>
				</AppSheet>
			) : null}
		</>
	);
}
