import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { PriorityDot } from "@/components/board/PriorityDot";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import { DetailRow } from "@/components/node/DetailRow";
import type { FieldSpec } from "@/components/overview/CardEditSheet";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import type { CardCondition } from "@/models/filter";
import type { Member } from "@/models/home";
import type { LabelWithId } from "@/models/label";
import type { Priority } from "@/models/node";
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
] as const satisfies readonly CardCondition["field"][];

export type FilterField = (typeof filterFields)[number];

/** The glyph each row leads with — the details screen's own, per field. */
const fieldGlyphs: Record<FilterField, string> = {
	assigneeIds: "account-outline",
	labelIds: "tag-outline",
	locationId: "crosshairs-gps",
	priority: "thermometer",
	effort: "clock-outline",
	dueDate: "calendar",
	isRoot: "file-tree-outline",
	blockedBy: "timer-sand",
	notes: "pencil-outline",
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
