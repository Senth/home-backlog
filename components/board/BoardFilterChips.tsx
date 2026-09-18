import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Chip } from "react-native-paper";
import {
	type FilterContext,
	type FilterField,
	filterFields,
	filterIcons,
	filterWord,
} from "@/components/board/BoardFilterRow";
import type { FieldSpec } from "@/components/overview/CardEditSheet";
import type { BoardFilter } from "@/models/board-filter";
import type { CardCondition } from "@/models/filter";
import { outlinedTouchTarget, space, touchTarget } from "@/theme/tokens";

/**
 * Why the pills' label carries the row's height: the chip's `minHeight` grows
 * the box, but Paper's content row inside it keeps its natural ~32dp and sits
 * at the top of what grew (on web the ripple stretches, the content does not),
 * leaving the glyphs ~7dp above the absolutely-centered ✕. A line box as tall
 * as `touchTarget` — with Paper's own label margins gone — is the one prop
 * that reaches inside the chip: it grows the pressable itself to the 48dp
 * floor, the chip's two hairlines land the box exactly on
 * `outlinedTouchTarget`, and glyph, icons and ✕ share one center line.
 */
const pillText = {
	marginVertical: space.none,
	lineHeight: touchTarget,
} as const;

interface BoardFilterChipsProps {
	filter: BoardFilter;
	/** Removes one condition — or, for the reach pill, drops back to this board. */
	onChange: (next: BoardFilter | null) => void;
	/** Opens the sheet the pills summarize — a pill's tap is a shortcut in. */
	onOpen: () => void;
	/** The fields the sheet offers, whose names the pills' words reuse. */
	specs: readonly FieldSpec[];
	ctx: FilterContext;
}

/**
 * The row of pills under the app bar (Q6), there only while the filter is
 * holding something back — the glanceable answer to "why am I not seeing
 * everything", with a ✕ on each pill so answering it is one tap.
 *
 * A pill shows the value the way the row does: an icon where the value has
 * one, its word where it has not. Several labels are **one** pill whose ✕
 * clears all of them — taking one label off means opening the field, which
 * is where that decision belongs. The reach pill closes the row: it is a
 * word, because reach has no glyph to fall back on.
 *
 * The **leading count chip appears only when the row actually overflows** its
 * width, measured the way a browser measures rather than by arithmetic:
 * `onContentSizeChange` against `onLayout`. At 200 % text in Swedish the
 * word pills scroll away, and the count still answers the question.
 */
export function BoardFilterChips({
	filter,
	onChange,
	onOpen,
	specs,
	ctx,
}: BoardFilterChipsProps) {
	const { t } = useTranslation();

	// The two measurements, and the overflow that drives the count chip. Zero
	// until the first layout lands, so nothing flashes on before it is known.
	const [box, setBox] = useState<number>(space.none);
	const [content, setContent] = useState<number>(space.none);
	const overflowing = box > space.none && content > box;

	const set = (conditions: CardCondition[]) =>
		onChange(
			conditions.length === 0 && filter.reach === "board"
				? null
				: { ...filter, conditions },
		);

	const clearField = (field: FilterField) =>
		set(filter.conditions.filter((condition) => condition.field !== field));

	const pills = filterFields.flatMap((field) => {
		const condition = filter.conditions.find((each) => each.field === field);
		if (condition === undefined) return [];

		const icons = filterIcons(condition, ctx);
		const word = icons === null ? filterWord(condition, specs, ctx, t) : null;
		const name =
			field === "labelIds"
				? t("board.filter.labels")
				: (specs.find((spec) => spec.field === field)?.label ?? field);

		return [
			<View key={field} testID={`board-filter-pill-${field}`}>
				<Chip
					mode="flat"
					showSelectedCheck={false}
					// The pill opens the sheet — without a handler Paper marks the
					// whole pill `aria-disabled`, and a screen reader announces the
					// filter as broken.
					onPress={onOpen}
					// The pill speaks for what it is; the ✕ speaks for removal.
					// They cannot share a name: the wrapper that once carried the
					// remove phrase compiled to a `<button>` around the chip's own
					// two buttons, had no handler of its own, and promised a
					// removal its press never did.
					accessibilityLabel={icons ? name : undefined}
					onClose={() => clearField(field)}
					closeIconAccessibilityLabel={t("board.filter.removeFilter", {
						what: name,
					})}
					style={{ minHeight: outlinedTouchTarget }}
					textStyle={pillText}
				>
					{icons ?? word}
				</Chip>
			</View>,
		];
	});

	const reach =
		filter.reach === "board"
			? []
			: [
					<View key="reach" testID="board-filter-pill-reach">
						<Chip
							mode="flat"
							showSelectedCheck={false}
							onPress={onOpen}
							onClose={() =>
								onChange(
									filter.conditions.length === 0
										? null
										: { ...filter, reach: "board" },
								)
							}
							closeIconAccessibilityLabel={t("board.filter.removeFilter", {
								what: t("board.filter.reach"),
							})}
							style={{ minHeight: outlinedTouchTarget }}
							textStyle={pillText}
						>
							{t("board.filter.everythingBelow")}
						</Chip>
					</View>,
				];

	const count = filter.conditions.length + reach.length;

	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			onLayout={(event) => setBox(event.nativeEvent.layout.width)}
			onContentSizeChange={setContent}
			style={{ flexGrow: space.none }}
			contentContainerStyle={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.sm,
				paddingHorizontal: space.md,
				paddingBottom: space.sm,
			}}
		>
			{overflowing ? (
				<View
					testID="board-filter-count"
					accessible
					accessibilityRole="text"
					accessibilityLabel={t("board.filter.countA11y", {
						count,
					})}
				>
					<Chip mode="flat" showSelectedCheck={false} onPress={onOpen}>
						{count}
					</Chip>
				</View>
			) : null}
			{pills}
			{reach}
		</ScrollView>
	);
}
