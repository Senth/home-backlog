import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
	Appbar,
	Button,
	Divider,
	SegmentedButtons,
	Switch,
	Text,
} from "react-native-paper";
import {
	BoardFilterRow,
	type FilterContext,
	fieldPickerItems,
	filterFields,
	pickerConditionFromIds,
	pickerValueFor,
} from "@/components/board/BoardFilterRow";
import { PriorityDot } from "@/components/board/PriorityDot";
import { fieldSpecs } from "@/components/overview/CardEditForm";
import { AppSheet } from "@/components/ui/AppSheet";
import {
	type CheckItem,
	CheckListPicker,
} from "@/components/ui/CheckListPicker";
import { Row } from "@/components/ui/Row";
import { useAuth } from "@/contexts/AuthContext";
import type { BoardFilter } from "@/models/board-filter";
import type { CardCondition } from "@/models/filter";
import type { Member } from "@/models/home";
import type { LabelWithId } from "@/models/label";
import type { Location } from "@/models/locations";
import type { Priority } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	border,
	radius,
	segmentedLabelLineHeight,
	size,
	space,
	touchTarget,
	touchTargetStyle,
} from "@/theme/tokens";

interface BoardFilterSheetProps {
	visible: boolean;
	onDismiss: () => void;
	filter: BoardFilter | null;
	/** Writes the whole filter; `null` clears it. */
	onChange: (next: BoardFilter | null) => void;
	/** The home's members, for the people field and its avatars. */
	members: readonly Member[];
	labels: readonly LabelWithId[];
	locations: readonly Location[];
	showEveryone: boolean;
	onShowEveryone: (value: boolean) => void;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * The *Not set* row's mark, in the priority picker's left column: an empty
 * ring at the `PriorityDot`'s exact size and shape, so the five rows read as
 * one column. Filled, any hue from the theme would sit beside four ramp hues
 * as a fifth dot; empty, it says what the row offers — the absence of a
 * priority — in the same quiet tier as an unticked row's glyph.
 */
function NotSetDot() {
	const theme = useAppTheme();

	return (
		<View
			testID="priority-not-set-dot"
			style={{
				width: size.labelDot,
				height: size.labelDot,
				borderRadius: radius.full,
				borderWidth: border.hairline,
				borderColor: theme.colors.onSurfaceVariant,
			}}
		/>
	);
}

/**
 * The board's filter, in one sheet (D8): the reach control and its sentence,
 * the moved *show everyone* switch (D8 — a preference, not a condition), and
 * the nine fields as rows (Q10 — no Status, because on a board the status is
 * the column). A row opens its field's picker — phase 5's `CheckListPicker` —
 * and a set row's ✕ clears it without opening anything (Q8).
 *
 * Everything edits the live filter through `onChange`, so the pills under the
 * app bar and the board behind the sheet follow every tap; *Done* only
 * dismisses. There is no Save for the work to be lost behind.
 *
 * The reach control is the loudest thing on the sheet on purpose — it decides
 * what the rows are even *about* — and the rows stay quiet beneath it. Names
 * and value words are the card editor's (`fieldSpecs`), so the two sheets
 * speak one vocabulary.
 */
export function BoardFilterSheet({
	visible,
	onDismiss,
	filter,
	onChange,
	members,
	labels,
	locations,
	showEveryone,
	onShowEveryone,
	returnFocusTo,
}: BoardFilterSheetProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { user } = useAuth();
	const [openField, setOpenField] = useState<string | null>(null);

	// Reset when the sheet *opens*, during render, the way `CardEditForm`
	// does: no field left open from the last visit, and nothing torn down
	// mid-edit while a listener refresh re-renders the open sheet.
	const [opened, setOpened] = useState(visible);
	if (opened !== visible) {
		setOpened(visible);
		if (visible) setOpenField(null);
	}

	const conditions = filter?.conditions ?? [];
	const conditionFor = (field: CardCondition["field"]) =>
		conditions.find((condition) => condition.field === field) ?? null;

	const specs = fieldSpecs(members, locations, labels, t, "open");
	const locationIds = new Set(locations.map((location) => location.id));

	const ctx: FilterContext = {
		uid: user?.uid ?? "",
		members,
		labels,
		locationTitles: new Map(
			locations.map((location) => [location.id, location.title]),
		),
		surface: theme.colors.elevation.level3,
	};

	const write = (next: CardCondition[]) =>
		onChange(
			next.length === 0 && (filter?.reach ?? "board") === "board"
				? null
				: {
						mode: filter?.mode ?? "open",
						reach: filter?.reach ?? "board",
						conditions: next,
					},
		);

	/** Replaces one field's condition, or clears that field whole. */
	const setCondition = (
		field: CardCondition["field"],
		next: CardCondition | null,
	) =>
		write(
			next === null
				? conditions.filter((condition) => condition.field !== field)
				: [
						...conditions.filter((condition) => condition.field !== field),
						next,
					],
		);

	const clearField = (field: CardCondition["field"]) =>
		write(conditions.filter((condition) => condition.field !== field));

	/** One row's spoken ✕: what it removes is the row's own name. */
	const clearLabel = (name: string) =>
		t("board.filter.removeFilter", { what: name });

	const open =
		openField === null ? null : (openField as CardCondition["field"]);
	const closePicker = () => setOpenField(null);

	/**
	 * The picker for the field being edited: the shared row vocabulary renders
	 * the items, and its mapping turns the checked ids back into a condition.
	 * Every group rides the fill presentation (#314) — one selection style in
	 * the sheet — and the priority group leads every row with its mark, the
	 * ramp dot and the empty ring for *Not set*; no other group carries a
	 * mark of its own for every row.
	 */
	const pickerItems = (): CheckItem[] => {
		const spec = specs.find((each) => each.field === openField);
		if (spec === undefined) return [];
		const items = fieldPickerItems(spec, {
			uid: user?.uid ?? "",
			members,
			labels,
		});
		if (openField !== "priority") return items;
		return items.map((item) => ({
			...item,
			left:
				item.id === "none" ? (
					<NotSetDot />
				) : (
					<PriorityDot priority={item.id as Priority} />
				),
		}));
	};

	const pickerValue = (): readonly string[] =>
		pickerValueFor(open === null ? null : conditionFor(open));

	const pickerChange = (ids: string[]) => {
		if (open === null) return;
		const spec = specs.find((each) => each.field === open);
		if (spec === undefined) return;
		setCondition(open, pickerConditionFromIds(spec, ids, locationIds));
	};

	return (
		<>
			<AppSheet
				visible={visible}
				onDismiss={onDismiss}
				testID="board-filter-sheet"
				returnFocusTo={returnFocusTo}
			>
				<View style={{ gap: space.md }}>
					<Text variant="titleMedium">{t("board.filter.title")}</Text>

					<View>
						<SegmentedButtons
							value={filter?.reach ?? "board"}
							onValueChange={(value) =>
								onChange({
									mode: filter?.mode ?? "open",
									reach: value as "board" | "subtree",
									conditions,
								})
							}
							buttons={[
								{
									value: "board",
									label: t("board.filter.thisBoard"),
									labelStyle: { lineHeight: segmentedLabelLineHeight },
								},
								{
									value: "subtree",
									label: t("board.filter.everythingBelow"),
									labelStyle: { lineHeight: segmentedLabelLineHeight },
								},
							]}
						/>
						{/* The sentence under the control, the same escape the card
						    editor's segmented controls use: it says what the choice
						    means, so the two answers cannot read as one four-way one. */}
						<Text
							variant="bodySmall"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{(filter?.reach ?? "board") === "board"
								? t("board.filter.thisBoardDescription")
								: t("board.filter.everythingBelowDescription")}
						</Text>
					</View>

					{/* The participant preference, moved here from `BoardMenu` (D8):
					    a switch, because it hides projects by default rather than
					    holding cards back for a reason the pills could name. */}
					<Row
						title={t("board.showEveryone")}
						right={
							<Switch
								value={showEveryone}
								onValueChange={onShowEveryone}
								accessibilityLabel={t("board.showEveryone")}
							/>
						}
					/>

					<Divider />

					<View>
						{filterFields.map((field) => {
							const condition = conditionFor(field);
							const name =
								field === "labelIds"
									? t("board.filter.labels")
									: (specs.find((spec) => spec.field === field)?.label ??
										field);
							return (
								<BoardFilterRow
									key={field}
									field={field}
									condition={condition}
									specs={specs}
									ctx={ctx}
									testID={`board-filter-row-${field}`}
									onPress={() => setOpenField(field)}
									onClear={
										condition === null ? undefined : () => clearField(field)
									}
									clearLabel={clearLabel(name)}
								/>
							);
						})}
					</View>

					{/* Clear and Done, quiet, the picker footer's own shape: the rows
					    are the sheet's work and this footer must not compete. */}
					<View
						style={{
							flexDirection: "row",
							justifyContent: "space-between",
							alignItems: "center",
						}}
					>
						<Button
							mode="text"
							onPress={() => onChange(null)}
							textColor={theme.colors.onSurfaceVariant}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("board.filter.clearAll")}
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

			{open === null || !visible ? null : (
				<CheckListPicker
					onDismiss={closePicker}
					testID={`board-filter-${open}`}
					title={specs.find((spec) => spec.field === open)?.label ?? open}
					searchLabel={t("board.filter.search")}
					items={pickerItems()}
					value={pickerValue()}
					onChange={pickerChange}
					fill
					emptySentence={
						open === "labelIds" ? t("labels.empty") : t("board.filter.empty")
					}
					searchEmptySentence={
						open === "labelIds"
							? t("labels.searchEmpty")
							: t("board.filter.searchEmpty")
					}
					note={
						open === "labelIds" ? (
							// The inherited-labels sentence the accepted mock carries:
							// the filter matches what a card inherits, exactly as the
							// card face draws it.
							<Text
								variant="bodySmall"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{t("board.filter.labelsInherited")}
							</Text>
						) : undefined
					}
				/>
			)}
		</>
	);
}

interface BoardFilterActionProps {
	/** True while the filter holds something back — the dot's whole story. */
	set: boolean;
	onPress: () => void;
	/** Shared with the sheet, so dismissal hands focus back to the funnel. */
	anchorRef: RefObject<View | null>;
}

/**
 * The board's filter action, in the app bar: a funnel, with the `size.dot`
 * mark when something is held back — the same mark `BoardMenu` hangs on its
 * dots, and the same precedent, not an invention.
 */
export function BoardFilterAction({
	set,
	onPress,
	anchorRef,
}: BoardFilterActionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	return (
		<View ref={anchorRef}>
			<Appbar.Action
				style={touchTargetStyle}
				icon="filter-variant"
				accessibilityLabel={t("board.filter.title")}
				onPress={onPress}
			/>
			{set ? (
				<View
					testID="board-filter-mark"
					style={{
						// The style prop, not `pointerEvents`: React Native Web
						// deprecated the prop and warns on every render.
						pointerEvents: "none",
						position: "absolute",
						top: space.sm,
						right: space.sm,
						width: size.dot,
						height: size.dot,
						borderRadius: radius.full,
						backgroundColor: theme.colors.primary,
					}}
				/>
			) : null}
		</View>
	);
}
