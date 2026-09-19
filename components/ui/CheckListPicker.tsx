import { type ReactNode, type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Text, TextInput } from "react-native-paper";
import { AppSheet } from "@/components/ui/AppSheet";
import { CheckRow } from "@/components/ui/CheckRow";
import { foldTitle } from "@/models/fold-title";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

/** One tickable row: its stable id, the words it is found and named by, and its mark. */
export interface CheckItem {
	id: string;
	title: string;
	/**
	 * A mark of identity ahead of the checkbox — the label glyph in the label
	 * picker's rows. Absent for a plain tickable row.
	 */
	left?: ReactNode;
}

interface CheckListPickerProps {
	onDismiss: () => void;
	/** Unique per sheet: the focus trap finds the surface by `${testID}-surface`. */
	testID: string;
	returnFocusTo?: RefObject<View | null>;
	/** The sheet's heading, and the one action beside it. */
	title?: string;
	headerAction?: ReactNode;
	/** The search field's own words — what the search searches is the caller's to say. */
	searchLabel: string;
	/** Every row offered, in display order; the search filters by folded title. */
	items: readonly CheckItem[];
	/** The checked ids — controlled. The picker owns no selection state. */
	value: readonly string[];
	onChange: (value: string[]) => void;
	/** Rows a caller's rule closes — the label cap's disabled unapplied rows. */
	disabled?: (item: CheckItem) => boolean;
	/** The sentence when the list itself is empty. */
	emptySentence?: string;
	/** The sentence when the search matches nothing. */
	searchEmptySentence?: string;
	/**
	 * A sentence between the rows and the footer, in a slot the layout has
	 * already paid for — the label cap's, not a picker rule of its own.
	 */
	note?: ReactNode;
	/**
	 * Rows drawn as `CheckRow`'s fill presentation instead of checkboxes —
	 * the filter's priority group, which reads like the details screen's
	 * picker. Opt-in: every other caller keeps its checkbox rows.
	 */
	fill?: boolean;
}

/**
 * The search-and-check body every picker shares: the sheet, the search field
 * with `foldTitle`'s diacritic folding, one `CheckRow` per item, and a footer
 * of **Clear** and **Done**.
 *
 * The selection is controlled — `value` in, `onChange` out, no selection
 * state of its own — so a caller whose rows are written through server-side
 * transforms (the labels) and one whose selection is local state (the
 * filter's) drive the same component without forking it. What a caller's
 * rules are — a cap, a write shape, where *New* navigates — stays in the
 * caller; the picker knows only rows, a search and the two footer actions.
 */
export function CheckListPicker({
	onDismiss,
	testID,
	returnFocusTo,
	title,
	headerAction,
	searchLabel,
	items,
	value,
	onChange,
	disabled,
	emptySentence,
	searchEmptySentence,
	note,
	fill,
}: CheckListPickerProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [text, setText] = useState("");

	const needle = foldTitle(text.trim());
	const visibleItems = items.filter((item) =>
		foldTitle(item.title).includes(needle),
	);

	const toggle = (item: CheckItem, checked: boolean) =>
		onChange(
			checked ? value.filter((id) => id !== item.id) : [...value, item.id],
		);

	return (
		<AppSheet
			visible
			onDismiss={onDismiss}
			testID={testID}
			returnFocusTo={returnFocusTo}
		>
			<View style={{ gap: space.md }}>
				{title !== undefined || headerAction !== undefined ? (
					<View style={{ flexDirection: "row", alignItems: "center" }}>
						{title !== undefined ? (
							<Text variant="titleMedium" style={{ flex: 1 }}>
								{title}
							</Text>
						) : null}
						{headerAction}
					</View>
				) : null}

				<TextInput
					mode="flat"
					label={searchLabel}
					value={text}
					onChangeText={setText}
					left={<TextInput.Icon icon="magnify" />}
					testID={`${testID}-search`}
					autoFocus
				/>

				<View style={{ gap: space.xs }}>
					{items.length === 0 && emptySentence !== undefined ? (
						<Text variant="bodyMedium">{emptySentence}</Text>
					) : null}

					{visibleItems.length === 0 && items.length > 0 ? (
						<Text variant="bodyMedium">{searchEmptySentence}</Text>
					) : null}

					{visibleItems.map((item) => {
						const checked = value.includes(item.id);
						return (
							<CheckRow
								key={item.id}
								left={item.left}
								label={item.title}
								checked={checked}
								disabled={disabled?.(item)}
								fill={fill}
								onPress={() => toggle(item, checked)}
							/>
						);
					})}
				</View>

				{note}

				{/* Clear and Done, quiet: both are text buttons, and Clear takes
				    the muted tier — the rows are the surface's work, and the
				    footer must not compete with them. */}
				<View
					style={{
						flexDirection: "row",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<Button
						mode="text"
						onPress={() => onChange([])}
						textColor={theme.colors.onSurfaceVariant}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("common.clear")}
					</Button>
					<Button
						mode="text"
						onPress={onDismiss}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("common.done")}
					</Button>
				</View>
			</View>
		</AppSheet>
	);
}
