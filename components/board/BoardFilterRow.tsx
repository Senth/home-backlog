import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { PriorityDot } from "@/components/board/PriorityDot";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import { DetailRow } from "@/components/node/DetailRow";
import type { FieldSpec } from "@/components/overview/CardEditSheet";
import type { CheckItem } from "@/components/ui/CheckListPicker";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import type { CardCondition } from "@/models/filter";
import type { Member } from "@/models/home";
import type { LabelWithId } from "@/models/label";
import type { Priority } from "@/models/node";
import { doneWithinDays } from "@/models/overview";
import { useAppTheme } from "@/theme";
import { border, radius, size, space } from "@/theme/tokens";

/**
 * The board filter's nine fields, in the order the sheet renders them — the
 * card editor's vocabulary (`fieldSpecs`) minus the questions a board cannot
 * ask: no `status` (Q10 — on a board the status is the column), and none of
 * the fields that never describe work worth finding here. `labelIds` has no
 * spec in the editor — the card editor offers no labels group — so its row
 * names itself.
 */
export const filterFields = [
	"assigneeIds",
	"labelIds",
	"locationId",
	"priority",
	"effort",
	"dueDate",
	"isRoot",
	"blockedBy",
	"notes",
] as const satisfies readonly FilterField[];

/** Any field a condition can name — the board's nine, and the card editor's rest. */
export type FilterField = CardCondition["field"];

/** The glyph each row leads with — the details screen's own, per field. */
const fieldGlyphs: Record<FilterField, string> = {
	assigneeIds: "account-outline",
	labelIds: "tag-outline",
	locationId: "crosshairs-gps",
	priority: "thermometer",
	effort: "clock-outline",
	dueDate: "calendar",
	completedAt: "checkbox-marked-circle-outline",
	isRoot: "file-tree-outline",
	hasChildren: "format-list-checks",
	participantIds: "account-multiple-outline",
	blockedBy: "timer-sand",
	visibility: "eye-outline",
	createdVia: "source-branch",
	notes: "pencil-outline",
	photos: "image-outline",
	checklist: "format-list-checks",
	status: "list-status",
};

export interface FilterContext {
	/** The reader, so the people condition's `"me"` resolves to an avatar. */
	uid: string;
	members: readonly Member[];
	labels: readonly LabelWithId[];
	/** Location id → title, the leaf — the same map the card faces read. */
	locationTitles: ReadonlyMap<string, string>;
	/** The colour behind the stacked icons, which their separation ring takes. */
	surface: string;
}

/**
 * The icon a condition's value carries, where the value has one — the person
 * avatar, the stacked label glyphs, the priority dot (Q11). A location has no
 * glyph, so it stays a word. `null` when nothing applies and the word carries
 * the value alone.
 */
export function filterIcons(
	condition: CardCondition,
	ctx: FilterContext,
): ReactNode | null {
	const stack = (items: { key: string; node: ReactNode }[]) =>
		items.length === 0 ? null : (
			<View style={{ flexDirection: "row" }}>
				{items.map((item, index) => (
					<View
						key={item.key}
						style={{
							// One `space.xs` of overlap, and the surface-coloured ring
							// is what separates each icon from the one under it.
							marginLeft: index === 0 ? space.none : -space.xs,
							borderRadius: radius.full,
							borderWidth: border.hairline,
							borderColor: ctx.surface,
							overflow: "hidden",
						}}
					>
						{item.node}
					</View>
				))}
			</View>
		);

	if (condition.field === "assigneeIds" && "anyOf" in condition) {
		const people = condition.anyOf
			.filter((value) => value !== "none")
			.map((value) =>
				ctx.members.find(
					(member) => member.uid === (value === "me" ? ctx.uid : value),
				),
			)
			.filter((member): member is Member => member !== undefined);
		return stack(
			people.map((member) => ({
				key: member.uid,
				node: (
					<PersonAvatar
						name={member.displayName}
						photoURL={member.photoURL}
						px={size.avatarXs}
					/>
				),
			})),
		);
	}

	if (condition.field === "labelIds" && "anyOf" in condition) {
		return stack(
			ctx.labels
				.filter((label) => condition.anyOf.includes(label.id))
				.map((label) => ({
					key: label.id,
					node: <LabelGlyph color={label.color} icon={label.icon} />,
				})),
		);
	}

	if (condition.field === "priority" && "anyOf" in condition) {
		return stack(
			condition.anyOf
				.filter((value) => value !== "none")
				.map((value) => ({
					key: value,
					node: <PriorityDot priority={value as Priority} />,
				})),
		);
	}

	return null;
}

/**
 * The word a condition reads as, from the one vocabulary `fieldSpecs` carries
 * — the row's value, the pill's word and the pickers' rows are the same
 * strings, so the surfaces cannot drift. `null` when the condition says
 * nothing (an anyOf with nothing picked).
 */
export function filterWord(
	condition: CardCondition,
	specs: readonly FieldSpec[],
	ctx: FilterContext,
	t: ReturnType<typeof useTranslation>["t"],
): string | null {
	// The done window reads as its sentence, not its field name — the spec
	// carries no values to look up, the window is the whole answer.
	if (condition.field === "completedAt" && condition.is === "within") {
		return t("overview.cards.completedAtLine", {
			count: condition.n ?? doneWithinDays,
		});
	}
	if (condition.field === "locationId") {
		if ("anyOf" in condition) {
			return condition.anyOf
				.map((id) => ctx.locationTitles.get(id) ?? id)
				.join(", ");
		}
		return t(
			condition.is === "any"
				? "overview.cards.field.hasLocation"
				: "overview.cards.field.noLocation",
		);
	}

	const spec = specs.find((each) => each.field === condition.field);
	if (spec === undefined) return null;

	const labelOf = (value: string) =>
		spec.values.find((each) => String(each.value) === value)?.label ?? value;

	if ("anyOf" in condition) {
		const words = condition.anyOf
			.filter((value) => value !== "none")
			.map(labelOf);
		if ((condition.anyOf as readonly string[]).includes("none")) {
			words.push(t("overview.cards.field.notSet"));
		}
		return words.length === 0 ? null : words.join(", ");
	}
	// A widened "coming up" names its window; the plain one reads as the word.
	if (
		condition.field === "dueDate" &&
		condition.is === "comingUp" &&
		condition.n !== undefined
	) {
		return t("overview.cards.due.comingUpWithin", { count: condition.n });
	}
	return labelOf(String(condition.is));
}

interface BoardFilterRowProps {
	field: FilterField;
	condition: CardCondition | null;
	specs: readonly FieldSpec[];
	ctx: FilterContext;
	onPress: () => void;
	/** Clears the condition where it sits; absent from an unset row. */
	onClear?: () => void;
	clearLabel?: string;
	testID: string;
}

/**
 * One field of the board's filter as a row: glyph, name, value, and — when a
 * value is set — the ✕ that clears it without opening anything (Q8). The
 * whole row opens the field's picker.
 *
 * An unset value reads *Not set*, in the muted tier — it is the absence the
 * row exists to replace, not something to read twice.
 */
export function BoardFilterRow({
	field,
	condition,
	specs,
	ctx,
	onPress,
	onClear,
	clearLabel,
	testID,
}: BoardFilterRowProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const spec = specs.find((each) => each.field === field);
	const name = field === "labelIds" ? t("board.filter.labels") : spec?.label;

	let value: ReactNode = null;
	if (condition !== undefined && condition !== null) {
		const icons = filterIcons(condition, ctx);
		const word = icons === null ? filterWord(condition, specs, ctx, t) : null;
		value =
			icons ??
			(word === null ? null : (
				<Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
					{word}
				</Text>
			));
	}

	return (
		<DetailRow
			glyph={fieldGlyphs[field]}
			name={name ?? field}
			value={
				value ?? (
					<Text
						variant="bodyMedium"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("overview.cards.field.notSet")}
					</Text>
				)
			}
			onPress={onPress}
			onClear={onClear}
			clearLabel={clearLabel}
			testID={testID}
		/>
	);
}

/**
 * The picker rows one field offers, in display order: the spec's own values,
 * the location's places riding after its any/none pair, and avatars on the
 * people rows. The shared vocabulary, rendered as rows for both sheets.
 */
export function fieldPickerItems(
	spec: FieldSpec,
	opts: { uid: string; members: readonly Member[] },
): CheckItem[] {
	const items = spec.values.map((value) => ({
		id: String(value.value),
		title: value.label,
	}));

	if (spec.field === "assigneeIds") {
		const memberOf = (value: string) =>
			opts.members.find(
				(member) => member.uid === (value === "me" ? opts.uid : value),
			);
		return items.map((item) => {
			const member = memberOf(item.id);
			return {
				...item,
				left:
					member === undefined ? undefined : (
						<PersonAvatar
							name={member.displayName}
							photoURL={member.photoURL}
							px={size.avatarXs}
						/>
					),
			};
		});
	}

	if (spec.extraValues !== undefined) {
		return [
			...items,
			...spec.extraValues.map((value) => ({
				id: String(value.value),
				title: value.label,
			})),
		];
	}

	return items;
}

/**
 * The controlled selection the open picker starts from: an any-of's picked
 * ids, or the one `is` answer as a one-element list.
 */
export function pickerValueFor(
	condition: CardCondition | null,
): readonly string[] {
	if (condition === null) return [];
	if ("anyOf" in condition) return [...condition.anyOf];
	return [String(condition.is)];
}

/** The stored `is` value for an is-field, from the picker's string id. */
function castIs(field: FilterField, value: string): unknown {
	switch (field) {
		case "isRoot":
		case "notes":
		case "photos":
		case "checklist":
		case "hasChildren":
			return value === "true";
		default:
			return value;
	}
}

/**
 * The condition a picker's resulting selection writes, or `null` when it says
 * nothing. The any-of fields are plain multi-select; the is-fields are one
 * answer at a time — the tap that removes the set value clears the field, and
 * any other tap replaces it; the location field carries both forms, where
 * picking a place replaces any/none and picking any/none replaces the places.
 */
export function pickerConditionFromIds(
	spec: FieldSpec,
	ids: readonly string[],
	locationIds: ReadonlySet<string>,
): CardCondition | null {
	if (spec.field === "locationId") {
		const places = ids.filter((id) => locationIds.has(id));
		const flags = ids.filter((id) => id === "any" || id === "none");
		// The flag checked last wins, and either form replaces the other: the
		// editor never holds an is-answer and picked places at once.
		const flag = flags.at(-1);
		if (flag !== undefined) {
			return { field: "locationId", is: flag as "any" | "none" };
		}
		return places.length === 0 ? null : { field: "locationId", anyOf: places };
	}

	if (spec.kind === "anyOf") {
		return ids.length === 0
			? null
			: ({ field: spec.field, anyOf: ids } as CardCondition);
	}

	// The is-fields take one answer. The picker toggles, so the checked list
	// ends with the answer the last tap chose — an uncheck of the only one
	// leaves nothing, which says the field is unset.
	const last = ids.at(-1);
	return last === undefined
		? null
		: ({ field: spec.field, is: castIs(spec.field, last) } as CardCondition);
}
