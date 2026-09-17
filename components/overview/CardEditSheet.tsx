import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	Button,
	Chip,
	HelperText,
	IconButton,
	Menu,
	SegmentedButtons,
	Text,
	TextInput,
} from "react-native-paper";
import { AppDialog } from "@/components/ui/AppDialog";
import { soonInDays } from "@/models/due-date";
import type { CardCondition, CardSort, SortField } from "@/models/filter";
import type { Member } from "@/models/home";
import type { Location } from "@/models/locations";
import { titleError } from "@/models/node";
import { overviewLimit, rowsPerSection } from "@/models/overview";
import {
	type Card,
	conditionForField,
	seedTitleKeys,
	withCondition,
} from "@/models/overview-cards";
import { useAppTheme } from "@/theme";
import {
	outlinedTouchTarget,
	segmentedLabelLineHeight,
	space,
	touchTarget,
} from "@/theme/tokens";

/**
 * One card, edited. A sheet over the editor, because the form is six short
 * groups rather than a screen of its own.
 *
 * Everything edits a **draft**; nothing is written until Save, so tapping
 * through the condition chips on the way to somewhere else never writes a
 * half-configured card. The conditions are Chip groups per field, one field
 * at a time, in plain words — off the read screen the vocabulary is allowed
 * to be precise, and it is: the labels here name fields, which is exactly
 * what the read screen must never do.
 *
 * The scope choice is the one `SegmentedButtons` on the surface, per the
 * spec's own call — three plain words, not a query-builder control. A
 * `completed` card has no conditions and no sort — its rows are the done
 * pair's, not a filter — so those two groups stay hidden for it.
 *
 * The field vocabulary is one list, `fieldSpecs`, and the import preview
 * reads its words from the same list: a condition says what the chips would
 * have said, or the two surfaces drift.
 */

/** `t` as this module's helpers see it — the hook's own return. */
export type Translate = ReturnType<typeof useTranslation>["t"];

/** The strings a chip group is read from, in the order the chips render. */
interface ChipValue {
	value: string | boolean;
	label: string;
}

export interface FieldSpec {
	field: CardCondition["field"];
	label: string;
	kind: "anyOf" | "is";
	values: ChipValue[];
	/**
	 * A second selection inside the one field group — the location picker's
	 * per-location chips, which ride beside the any/none pair. Selecting
	 * here writes the anyOf form; selecting an `is` value replaces it.
	 */
	extraValues?: ChipValue[];
}

/**
 * Every condition field the editor offers, in the order the field chips
 * render, with the words each of their values reads as. The one vocabulary:
 * the sheet's chips, the "Coming up" window and the import preview's
 * condition lines are all read from here.
 */
export function fieldSpecs(
	members: readonly Member[],
	locations: readonly Location[],
	t: Translate,
): FieldSpec[] {
	return [
		{
			field: "status",
			label: t("overview.cards.field.status"),
			kind: "anyOf",
			values: (["backlog", "next_up", "execution"] as const).map((status) => ({
				value: status,
				label: t(`status.${status}`),
			})),
		},
		{
			field: "priority",
			label: t("detail.priority"),
			kind: "anyOf",
			values: [
				...(["low", "normal", "high", "urgent"] as const).map((priority) => ({
					value: priority,
					label: t(`priority.${priority}`),
				})),
				{ value: "none", label: t("overview.cards.field.notSet") },
			],
		},
		{
			field: "effort",
			label: t("detail.effort"),
			kind: "anyOf",
			values: [
				...(
					["quick", "hours", "evening", "weekend", "multi_week"] as const
				).map((effort) => ({ value: effort, label: t(`effort.${effort}`) })),
				{ value: "none", label: t("overview.cards.field.notSet") },
			],
		},
		{
			field: "dueDate",
			label: t("detail.dueDate"),
			kind: "is",
			values: (["comingUp", "late", "notLate", "none"] as const).map((due) => ({
				value: due,
				label: t(`overview.cards.due.${due}`),
			})),
		},
		{
			field: "isRoot",
			label: t("overview.cards.field.root"),
			kind: "is",
			values: [
				{ value: true, label: t("overview.cards.field.isProject") },
				{ value: false, label: t("overview.cards.field.isStep") },
			],
		},
		{
			field: "hasChildren",
			label: t("detail.steps"),
			kind: "is",
			values: [
				{ value: true, label: t("overview.cards.field.withSteps") },
				{ value: false, label: t("overview.cards.field.noSteps") },
			],
		},
		{
			field: "assigneeIds",
			label: t("detail.assignees"),
			kind: "anyOf",
			values: [
				{ value: "me", label: t("overview.cards.field.me") },
				{ value: "none", label: t("overview.cards.field.unassigned") },
				...members.map((member) => ({
					value: member.uid,
					label: member.displayName,
				})),
			],
		},
		{
			field: "participantIds",
			label: t("detail.participants"),
			kind: "anyOf",
			values: [
				{ value: "me", label: t("overview.cards.field.me") },
				...members.map((member) => ({
					value: member.uid,
					label: member.displayName,
				})),
			],
		},
		{
			field: "blockedBy",
			label: t("board.blocked"),
			kind: "is",
			values: [
				{ value: "any", label: t("overview.cards.field.waiting") },
				{ value: "none", label: t("overview.cards.field.notWaiting") },
			],
		},
		{
			field: "locationId",
			label: t("overview.cards.field.location"),
			kind: "is",
			values: [
				{ value: "any", label: t("overview.cards.field.hasLocation") },
				{ value: "none", label: t("overview.cards.field.noLocation") },
			],
			extraValues: locations.map((location) => ({
				value: location.id,
				label: location.title,
			})),
		},
		{
			field: "visibility",
			label: t("overview.cards.field.visibility"),
			kind: "is",
			values: [
				{ value: "shared", label: t("overview.cards.field.shared") },
				{ value: "private", label: t("overview.cards.field.private") },
			],
		},
		{
			field: "createdVia",
			label: t("overview.cards.field.createdVia"),
			kind: "is",
			values: [
				{ value: "app", label: t("overview.cards.field.inApp") },
				{ value: "api", label: t("detail.createdViaApi") },
			],
		},
		{
			field: "notes",
			label: t("detail.notes"),
			kind: "is",
			values: [
				{ value: true, label: t("overview.cards.field.withNotes") },
				{ value: false, label: t("overview.cards.field.noNotes") },
			],
		},
		{
			field: "photos",
			label: t("overview.cards.field.photos"),
			kind: "is",
			values: [
				{ value: true, label: t("overview.cards.field.withPhotos") },
				{ value: false, label: t("overview.cards.field.noPhotos") },
			],
		},
		{
			field: "checklist",
			label: t("overview.cards.field.checklist"),
			kind: "is",
			values: [
				{ value: true, label: t("overview.cards.field.withChecklist") },
				{ value: false, label: t("overview.cards.field.noChecklist") },
			],
		},
	];
}

interface CardEditSheetProps {
	visible: boolean;
	/** The card to edit, or `null` for a new one. */
	card: Card | null;
	/** The card's scope, which is where it is stored rather than a field. */
	scope: "global" | "home" | "shared";
	/** The home's members, for the two people fields. */
	members: readonly Member[];
	/** The home's locations, for the location picker. */
	locations: readonly Location[];
	onDismiss: () => void;
	onSave: (draft: Card, scope: "global" | "home" | "shared") => void;
}

const newCard = (): Card => ({
	id: "",
	kind: "open",
	seedId: null,
	title: "",
	conditions: [],
	sort: null,
	shown: rowsPerSection,
	max: overviewLimit,
	empty: { mode: "say", key: "overview.cards.empty.generic" },
	rank: "",
});

/** The sort a fresh card offers first, and the label each field reads as. */
const SORT_FIELDS = ["dueDate", "priority", "effort", "status"] as const;

const SORT_LABELS: Record<SortField, string> = {
	dueDate: "detail.dueDate",
	priority: "detail.priority",
	effort: "detail.effort",
	status: "overview.cards.field.status",
	// The completed card sorts by completion, and its sheet hides the sort
	// group — the label exists only so the map is honest about every field.
	completedAt: "overview.cards.sort.completedAt",
};

export function CardEditSheet({
	visible,
	card,
	scope: initialScope,
	members,
	locations,
	onDismiss,
	onSave,
}: CardEditSheetProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const [draft, setDraft] = useState<Card>(() => card ?? newCard());
	const [scope, setScope] = useState(initialScope);
	const [field, setField] = useState<CardCondition["field"] | null>(null);
	const [sortOpen, setSortOpen] = useState(false);
	const [titleProblem, setTitleProblem] = useState<string | null>(null);

	// Reset when the sheet *opens*, during render, the way `TitleDialog` does.
	// Not in an effect: a listener refresh mid-edit re-renders the sheet, and
	// the draft must survive that — only opening it again starts a new one.
	const [opened, setOpened] = useState(visible);
	if (opened !== visible) {
		setOpened(visible);
		if (visible) {
			setDraft(card ?? newCard());
			setScope(initialScope);
			setField(null);
			setSortOpen(false);
			setTitleProblem(null);
		}
	}

	const setConditions = (next: CardCondition | null) =>
		setDraft({ ...draft, conditions: withCondition(draft.conditions, next) });

	const fields = fieldSpecs(members, locations, t);

	// The clamp lives on the way out rather than in the stepper, so a held
	// count can be raised above the shown one without the shown one chasing it
	// through two renders. A seed's own title is `null` — the box starts empty
	// for it, and saving stores the card's own words.
	const save = () => {
		const title = draft.title ?? "";
		// A seed with no title of its own keeps following its i18n key: an
		// empty box on a seed is the default name, not a missing one. Saving
		// such a card writes `null` back, and clearing the field reverts a
		// renamed seed to its default.
		const keepsDefault = draft.seedId !== null && title.trim() === "";
		if (!keepsDefault) {
			const problem = titleError(title);
			if (problem !== null) {
				setTitleProblem(problem);
				return;
			}
		}

		const max = Math.min(Math.max(draft.max, 1), overviewLimit);
		onSave(
			{
				...draft,
				title: keepsDefault ? null : title.trim(),
				max,
				shown: Math.min(Math.max(draft.shown, 1), max),
			},
			scope,
		);
		onDismiss();
	};

	return (
		<AppDialog
			visible={visible}
			onDismiss={onDismiss}
			title={
				card === null
					? t("overview.cards.editor.add")
					: t("overview.cards.edit.title")
			}
			testID="overview-card-edit"
			actions={[
				<Button
					key="cancel"
					onPress={onDismiss}
					textColor={theme.colors.onSurfaceVariant}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("common.cancel")}
				</Button>,
				<Button
					key="save"
					onPress={save}
					mode="contained"
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("manageHome.save")}
				</Button>,
			]}
		>
			<SheetBody
				draft={draft}
				scope={scope}
				fields={fields}
				field={field}
				sortOpen={sortOpen}
				titleProblem={titleProblem}
				onScope={setScope}
				onField={setField}
				onConditions={setConditions}
				onSortOpen={setSortOpen}
				onSort={(sort) => setDraft({ ...draft, sort })}
				onTitle={(title) => {
					setDraft({ ...draft, title });
					setTitleProblem(null);
				}}
				onShown={(shown) => setDraft({ ...draft, shown })}
				onMax={(max) => setDraft({ ...draft, max })}
			/>
		</AppDialog>
	);
}

interface SheetBodyProps {
	draft: Card;
	scope: "global" | "home" | "shared";
	fields: FieldSpec[];
	field: CardCondition["field"] | null;
	sortOpen: boolean;
	titleProblem: string | null;
	onScope: (scope: "global" | "home" | "shared") => void;
	onField: (field: CardCondition["field"] | null) => void;
	onConditions: (next: CardCondition | null) => void;
	onSortOpen: (open: boolean) => void;
	onSort: (sort: Card["sort"]) => void;
	onTitle: (title: string) => void;
	onShown: (shown: number) => void;
	onMax: (max: number) => void;
}

/**
 * The form itself, inside the dialog's scrolling content. One group per row:
 * the title, the scope, the conditions and their one open field, the sort,
 * and the two row budgets.
 */
function SheetBody({
	draft,
	scope,
	fields,
	field,
	sortOpen,
	titleProblem,
	onScope,
	onField,
	onConditions,
	onSortOpen,
	onSort,
	onTitle,
	onShown,
	onMax,
}: SheetBodyProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { height } = useWindowDimensions();

	return (
		<ScrollView style={{ maxHeight: height - space.xxl * 4 }}>
			<View style={{ gap: space.lg, paddingBottom: space.sm }}>
				<View>
					<TextInput
						mode="outlined"
						label={t("board.titleLabel")}
						value={draft.title ?? ""}
						onChangeText={onTitle}
						onSubmitEditing={() => onTitle(draft.title ?? "")}
						selectTextOnFocus
						error={titleProblem !== null}
						// An untouched seed has no title of its own; the box shows
						// the name it currently travels under, in grey, rather
						// than an empty field that reads as lost data.
						placeholder={
							draft.seedId === null ? undefined : t(seedTitleKeys[draft.seedId])
						}
					/>
					<HelperText type="error" visible={titleProblem !== null}>
						{titleProblem === null ? "" : t(titleProblem)}
					</HelperText>
					{draft.seedId !== null && (draft.title ?? "") === "" ? (
						<HelperText type="info" visible>
							{t("overview.cards.edit.followsDefault")}
						</HelperText>
					) : null}
				</View>

				<SegmentedButtons
					value={scope}
					onValueChange={(value) => onScope(value as typeof scope)}
					buttons={[
						{
							value: "global",
							label: t("overview.cards.editor.scope.global"),
							labelStyle: { lineHeight: segmentedLabelLineHeight },
						},
						{
							value: "home",
							label: t("overview.cards.editor.scope.home"),
							labelStyle: { lineHeight: segmentedLabelLineHeight },
						},
						{
							value: "shared",
							label: t("overview.cards.editor.scope.shared"),
							labelStyle: { lineHeight: segmentedLabelLineHeight },
						},
					]}
				/>

				{draft.kind === "open" ? (
					<>
						<View style={{ gap: space.sm }}>
							<Text
								variant="labelLarge"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{t("overview.cards.field.conditions")}
							</Text>
							<View
								style={{
									flexDirection: "row",
									flexWrap: "wrap",
									gap: space.sm,
								}}
							>
								{fields.map((spec) => {
									const applied =
										conditionForField(draft.conditions, spec.field) !== null;

									return (
										<Chip
											key={spec.field}
											mode={applied ? "flat" : "outlined"}
											selected={applied}
											showSelectedCheck={false}
											aria-pressed={applied}
											onPress={() =>
												onField(field === spec.field ? null : spec.field)
											}
											style={{
												minHeight: outlinedTouchTarget,
												flexGrow: 1,
											}}
										>
											{spec.label}
										</Chip>
									);
								})}
							</View>
						</View>

						{field === null ? null : (
							<ConditionValues
								spec={fields.find((each) => each.field === field) as FieldSpec}
								conditions={draft.conditions}
								onChange={onConditions}
							/>
						)}

						{field === "dueDate" ? (
							<ComingUpWindow
								condition={conditionForField(draft.conditions, "dueDate")}
								onChange={onConditions}
							/>
						) : null}

						<View style={{ gap: space.sm }}>
							<Text
								variant="labelLarge"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{t("overview.cards.sort.label")}
							</Text>
							<Menu
								visible={sortOpen}
								onDismiss={() => onSortOpen(false)}
								anchor={
									<Button
										mode="outlined"
										icon="sort"
										onPress={() => onSortOpen(true)}
										contentStyle={{ minHeight: touchTarget }}
										style={{ alignSelf: "flex-start" }}
									>
										{draft.sort === null
											? t("overview.cards.sort.boardOrder")
											: t(SORT_LABELS[draft.sort.field])}
									</Button>
								}
							>
								<Menu.Item
									title={t("overview.cards.sort.boardOrder")}
									onPress={() => {
										onSortOpen(false);
										onSort(null);
									}}
								/>
								{SORT_FIELDS.map((sortField) => (
									<Menu.Item
										key={sortField}
										title={t(SORT_LABELS[sortField])}
										onPress={() => {
											onSortOpen(false);
											onSort({
												field: sortField,
												direction: draft.sort?.direction ?? "asc",
											});
										}}
									/>
								))}
							</Menu>
							{draft.sort === null ? null : (
								<DirectionChips sort={draft.sort} onSort={onSort} />
							)}
						</View>
					</>
				) : null}

				<Stepper
					label={t("overview.cards.edit.shown")}
					value={draft.shown}
					min={1}
					max={draft.max}
					onChange={onShown}
				/>
				<Stepper
					label={t("overview.cards.edit.held")}
					value={draft.max}
					min={draft.shown}
					max={overviewLimit}
					onChange={onMax}
				/>
			</View>
		</ScrollView>
	);
}

/**
 * Ascending or descending, offered once a field is chosen. A separate
 * component so the non-null `sort` is a prop — narrowing `draft.sort` inside
 * a callback does not survive the capture.
 */
function DirectionChips({
	sort,
	onSort,
}: {
	sort: CardSort;
	onSort: (sort: CardSort) => void;
}) {
	const { t } = useTranslation();

	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
			{(["asc", "desc"] as const).map((direction) => {
				const selected = sort.direction === direction;

				return (
					<Chip
						key={direction}
						mode={selected ? "flat" : "outlined"}
						selected={selected}
						showSelectedCheck={false}
						aria-pressed={selected}
						onPress={() => onSort({ ...sort, direction })}
						style={{ minHeight: outlinedTouchTarget }}
					>
						{t(
							direction === "asc"
								? "overview.cards.sort.ascending"
								: "overview.cards.sort.descending",
						)}
					</Chip>
				);
			})}
		</View>
	);
}

/**
 * The "Coming up" window: late is always late, and *soon* is within `n` days
 * — the spec's one editable number on a condition. The stepper shows the
 * effective window, `soonInDays` while the condition carries no `n` of its
 * own, and writing the default back drops it, so a card the reader never
 * widened stores no window at all.
 */
function ComingUpWindow({
	condition,
	onChange,
}: {
	condition: CardCondition | null;
	onChange: (next: CardCondition | null) => void;
}) {
	const { t } = useTranslation();

	if (
		condition === null ||
		condition.field !== "dueDate" ||
		condition.is !== "comingUp"
	) {
		return null;
	}

	const write = (n: number) =>
		onChange(
			n === soonInDays
				? { field: "dueDate", is: "comingUp" }
				: { field: "dueDate", is: "comingUp", n },
		);

	return (
		<Stepper
			label={t("overview.cards.edit.withinDays")}
			value={condition.n ?? soonInDays}
			min={1}
			max={30}
			onChange={write}
		/>
	);
}

/** One value group for the field being edited. */
function ConditionValues({
	spec,
	conditions,
	onChange,
}: {
	spec: FieldSpec;
	conditions: readonly CardCondition[];
	onChange: (next: CardCondition | null) => void;
}) {
	const current = conditionForField(conditions, spec.field);

	const select = (value: string | boolean) => {
		if (spec.kind === "anyOf") {
			const anyOf = (current as { anyOf: string[] } | null)?.anyOf ?? [];
			const next = anyOf.includes(String(value))
				? anyOf.filter((each) => each !== String(value))
				: [...anyOf, String(value)];
			// `FieldSpec` carries the model's own field literals and the values
			// they were built from; `toCondition` re-checks both on the way back
			// out of storage.
			onChange(
				next.length === 0
					? null
					: ({ field: spec.field, anyOf: next } as CardCondition),
			);
			return;
		}

		const same = (current as { is: string | boolean } | null)?.is === value;
		onChange(same ? null : ({ field: spec.field, is: value } as CardCondition));
	};

	return (
		<View style={{ gap: space.sm }}>
			<Text variant="bodyMedium">{spec.label}</Text>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
				{spec.values.map((chip) => {
					const selected =
						spec.kind === "anyOf"
							? ((current as { anyOf: string[] } | null)?.anyOf ?? []).includes(
									String(chip.value),
								)
							: (current as { is: string | boolean } | null)?.is === chip.value;

					return (
						<Chip
							key={String(chip.value)}
							mode={selected ? "flat" : "outlined"}
							selected={selected}
							showSelectedCheck={false}
							aria-pressed={selected}
							onPress={() => select(chip.value)}
							style={{
								minHeight: outlinedTouchTarget,
								flexGrow: 1,
							}}
						>
							{chip.label}
						</Chip>
					);
				})}
			</View>

			<PickerChips spec={spec} current={current} onChange={onChange} />
		</View>
	);
}

/**
 * The location picker: one chip per location, multi-select, riding beside
 * the any/none pair in the same field group. Selecting writes the anyOf
 * form; unticking the last one removes the condition — a location filter
 * with nothing picked says nothing, like every other any-of.
 */
function PickerChips({
	spec,
	current,
	onChange,
}: {
	spec: FieldSpec;
	current: CardCondition | null;
	onChange: (next: CardCondition | null) => void;
}) {
	const picker = spec.extraValues ?? [];
	if (picker.length === 0) return null;

	const currentAnyOf =
		(current as { anyOf: readonly string[] } | null)?.anyOf ?? [];

	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
			{picker.map((chip) => {
				const selected = currentAnyOf.includes(String(chip.value));

				return (
					<Chip
						key={String(chip.value)}
						mode={selected ? "flat" : "outlined"}
						selected={selected}
						showSelectedCheck={false}
						aria-pressed={selected}
						onPress={() => {
							const anyOf = selected
								? currentAnyOf.filter((each) => each !== String(chip.value))
								: [...currentAnyOf, String(chip.value)];
							onChange(
								anyOf.length === 0
									? null
									: ({ field: spec.field, anyOf } as CardCondition),
							);
						}}
						style={{
							minHeight: outlinedTouchTarget,
							flexGrow: 1,
						}}
					>
						{chip.label}
					</Chip>
				);
			})}
		</View>
	);
}

/** A number the reader nudges, because a text field invites typing 300. */
function Stepper({
	label,
	value,
	min,
	max,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
}) {
	const { t } = useTranslation();

	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
			<Text variant="bodyMedium" style={{ flex: 1 }}>
				{label}
			</Text>
			<IconButton
				icon="minus"
				onPress={() => onChange(Math.max(min, value - 1))}
				disabled={value <= min}
				accessibilityLabel={t("overview.cards.edit.fewer")}
				style={{ width: touchTarget, height: touchTarget, margin: space.none }}
			/>
			<Text
				variant="titleMedium"
				style={{ minWidth: space.xxl, textAlign: "center" }}
			>
				{value}
			</Text>
			<IconButton
				icon="plus"
				onPress={() => onChange(Math.min(max, value + 1))}
				disabled={value >= max}
				accessibilityLabel={t("overview.cards.edit.more")}
				style={{ width: touchTarget, height: touchTarget, margin: space.none }}
			/>
		</View>
	);
}
