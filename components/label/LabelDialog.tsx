import type { ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import {
	Button,
	Card,
	HelperText,
	Icon,
	Portal,
	Text,
	TextInput,
	ThemeProvider,
} from "react-native-paper";
import { CardGutter } from "@/components/board/CardGutter";
import { IconPicker } from "@/components/label/IconPicker";
import { AppDialog, ConfirmDialog } from "@/components/ui/AppDialog";
import { ColorField } from "@/components/ui/ColorField";
import { useHome } from "@/contexts/HomeContext";
import {
	createLabel,
	deleteLabel,
	recolourLabel,
	reiconLabel,
	renameLabel,
} from "@/data/homes";
import { useLabelColors } from "@/hooks/use-label-colors";
import {
	type LabelTitleError,
	type LabelWithId,
	labelError,
} from "@/models/label";
import { type Node, rankAtEnd } from "@/models/node";
import {
	darkTheme,
	defaultLabelHue,
	type LabelHueName,
	labelHues,
	lightTheme,
	useAppTheme,
} from "@/theme";
import { border, icon, radius, size, space, touchTarget } from "@/theme/tokens";

interface LabelDialogProps {
	homeId: string;
	/** The label being edited, or `null` on the create path. */
	label: LabelWithId | null;
	onDismiss: () => void;
	/** A queued write was refused — the dialog has already closed. */
	onError: () => void;
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

/** The gutter's sample card: a priority is all the gutter reads off a node. */
const previewNode: Pick<Node, "priority"> = { priority: "normal" };

const hueNames = Object.keys(labelHues) as LabelHueName[];

/**
 * Creating and editing one label (#100), in one shape — nothing moves between
 * the two: the preview, the name, the icon and the colour hold their places,
 * and only the actions row grows a Delete on the edit path.
 *
 * The live preview is the point of the dialog. A hue picked from a row of
 * swatches says nothing about what it does to a card, so both schemes render
 * the settled card face — the real gutter, priority, hairline and label glyph
 * included — and every keystroke and pick lands in the preview at once. Each
 * half is forced to its scheme with Paper's `ThemeProvider`, so the components
 * underneath resolve the same tokens the real board does.
 *
 * The icon row opens the full-screen `IconPicker` in its own portal: a picker
 * opens, is answered, and is gone. Writes queue like every other edit, so
 * saving dismisses at once; a refused write surfaces through the screen's
 * snackbar, the way `renameHome` argues for.
 */
export function LabelDialog({
	homeId,
	label,
	onDismiss,
	onError,
	testID,
	returnFocusTo,
}: LabelDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { homes } = useHome();

	const [title, setTitle] = useState(label?.title ?? "");
	const [icon, setIcon] = useState(label?.icon ?? "star");
	const [color, setColor] = useState(label?.color ?? defaultLabelHue);
	const [titleProblem, setTitleProblem] = useState<LabelTitleError | null>(
		null,
	);
	const [pickingIcon, setPickingIcon] = useState(false);
	const [deleting, setDeleting] = useState(false);
	// Open from the start when the stored colour is already a custom one —
	// the field is where its value is visible.
	const [customOpen, setCustomOpen] = useState(
		label !== null && !(label.color in labelHues),
	);
	const deleteAnchor = useRef<View | null>(null);

	const labels = homes.find((home) => home.id === homeId)?.labels ?? [];

	/** The label as it is being drawn — what the preview and the gutter read. */
	const draft: LabelWithId = {
		id: label?.id ?? "draft",
		title: title.trim() === "" ? t("labels.previewFallback") : title,
		icon,
		color,
		rank: label?.rank ?? "a0",
	};

	const save = () => {
		const problem = labelError(title);
		if (problem !== null) {
			setTitleProblem(problem);
			return;
		}

		onDismiss();
		if (label === null) {
			createLabel(homeId, {
				title,
				icon,
				color,
				rank: rankAtEnd(labels.at(-1)?.rank ?? null),
			}).catch((reason) => {
				console.error("Could not create the label:", reason);
				onError();
			});
			return;
		}

		// Only what changed — two members editing different labels merge at
		// the field path, so three untouched writes would queue for nothing.
		const writes: Promise<void>[] = [];
		if (title.trim() !== label.title)
			writes.push(renameLabel(homeId, label.id, title));
		if (icon !== label.icon) writes.push(reiconLabel(homeId, label.id, icon));
		if (color !== label.color)
			writes.push(recolourLabel(homeId, label.id, color));
		if (writes.length > 0)
			Promise.all(writes).catch((reason) => {
				console.error("Could not save the label:", reason);
				onError();
			});
	};

	const remove = () => {
		if (label === null) return;
		setDeleting(false);
		onDismiss();
		deleteLabel(homeId, label.id).catch((reason) => {
			console.error("Could not delete the label:", reason);
			onError();
		});
	};

	return (
		<View>
			{pickingIcon ? (
				<Portal>
					<IconPicker
						value={icon}
						onSelect={(name) => {
							setIcon(name);
							setPickingIcon(false);
						}}
						onClose={() => setPickingIcon(false)}
					/>
				</Portal>
			) : (
				<AppDialog
					visible
					onDismiss={onDismiss}
					title={t(label === null ? "labels.newLabel" : "labels.editTitle")}
					testID={testID}
					returnFocusTo={returnFocusTo}
					actions={[
						...(label === null
							? []
							: [
									<Button
										key="delete"
										ref={deleteAnchor}
										mode="text"
										textColor={theme.colors.error}
										onPress={() => setDeleting(true)}
										contentStyle={{ minHeight: touchTarget }}
									>
										{t("labels.delete")}
									</Button>,
								]),
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
							mode="contained-tonal"
							onPress={save}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t(label === null ? "labels.add" : "labels.save")}
						</Button>,
					]}
				>
					<View style={{ gap: space.lg }}>
						<View style={{ gap: space.sm }}>
							<Text
								variant="labelLarge"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{t("labels.onCard")}
							</Text>
							<View style={{ flexDirection: "row", gap: space.sm }}>
								<SchemePreview scheme="light" label={draft} />
								<SchemePreview scheme="dark" label={draft} />
							</View>
						</View>

						<View>
							<TextInput
								mode="outlined"
								label={t("labels.nameLabel")}
								value={title}
								onChangeText={(next) => {
									setTitle(next);
									setTitleProblem(null);
								}}
								error={titleProblem !== null}
							/>
							{/* The slot is reserved either way, so the sentence
							    appearing does not move the actions row. */}
							<HelperText type="error" visible={titleProblem !== null}>
								{titleProblem === null ? "" : t(titleProblem)}
							</HelperText>
						</View>

						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
							}}
						>
							<Text
								variant="labelLarge"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{t("labels.iconLabel")}
							</Text>
							<Button
								mode="text"
								icon={icon}
								onPress={() => setPickingIcon(true)}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("labels.changeIcon")}
							</Button>
						</View>

						<View style={{ gap: space.sm }}>
							<Text
								variant="labelLarge"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{t("labels.colorLabel")}
							</Text>
							<View
								style={{
									flexDirection: "row",
									flexWrap: "wrap",
									gap: space.xs,
								}}
							>
								{hueNames.map((hue) => (
									<HueSwatch
										key={hue}
										hue={hue}
										selected={color === hue}
										onSelect={() => setColor(hue)}
									/>
								))}
								<CustomSwatch
									color={color}
									selected={!(color in labelHues)}
									onOpen={() => setCustomOpen(true)}
								/>
							</View>
							{customOpen ? (
								<ColorField
									label={t("labels.customColour")}
									value={color}
									onChange={setColor}
								/>
							) : null}
						</View>
					</View>
				</AppDialog>
			)}

			{deleting && label !== null ? (
				<ConfirmDialog
					visible
					onDismiss={() => setDeleting(false)}
					onConfirm={remove}
					title={t("labels.deleteTitle", { name: label.title })}
					body={t("labels.deleteBody")}
					confirmLabel={t("labels.delete")}
					destructive
					testID={`${testID}-delete`}
					returnFocusTo={deleteAnchor}
				/>
			) : null}
		</View>
	);
}

interface SchemePreviewProps {
	scheme: "light" | "dark";
	label: LabelWithId;
}

/**
 * One half of the preview: the settled card face, forced to a scheme. The
 * crumbs, the title and the gutter are the real components, so the preview
 * cannot drift from the board — a change to the card face is a change here.
 */
function SchemePreview({ scheme, label }: SchemePreviewProps) {
	const { t } = useTranslation();
	const theme = scheme === "light" ? lightTheme : darkTheme;

	return (
		<View style={{ flex: 1, gap: space.xs }}>
			<Text
				variant="labelMedium"
				style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}
			>
				{scheme === "light"
					? t("labels.previewLight")
					: t("labels.previewDark")}
			</Text>
			<ThemeProvider theme={theme}>
				<Card
					mode="outlined"
					style={{
						backgroundColor: theme.colors.boardCard,
						borderColor: theme.colors.boardCardBorder,
					}}
				>
					<View style={{ flexDirection: "row", minHeight: touchTarget }}>
						<CardGutter node={previewNode} labels={[label]} />
						<View
							style={{
								flex: 1,
								paddingTop: space.sm,
								paddingBottom: space.sm,
								paddingHorizontal: space.sm,
							}}
						>
							<Text
								variant="labelMedium"
								numberOfLines={1}
								style={{ color: theme.colors.onCardMuted }}
							>
								{t("labels.previewCrumbFirst")}
								<Icon
									source="chevron-right"
									size={icon.sm}
									color={theme.colors.onCardMuted}
								/>
								{t("labels.previewCrumbSecond")}
							</Text>
							<Text variant="bodyLarge" style={{ marginTop: space.xs }}>
								{t("labels.previewTitle")}
							</Text>
						</View>
					</View>
				</Card>
			</ThemeProvider>
		</View>
	);
}

interface SwatchProps {
	/** The accessible name — the swatch is a shape, and a shape says nothing. */
	accessibilityLabel: string;
	selected: boolean;
	onSelect: () => void;
}

/**
 * One colour swatch: the dot inside a full `touchTarget` pressable, with a
 * hairline ring on the chosen one and a check in the dot's own on-colour —
 * the same mark the icon picker's list rows make. The dot is `avatarSm`, so
 * the ring reads around the colour, not over it.
 */
function Swatch({
	accessibilityLabel,
	selected,
	onSelect,
	children,
}: SwatchProps & { children: ReactNode }) {
	const theme = useAppTheme();

	return (
		<Pressable
			accessible
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ selected }}
			onPress={onSelect}
			style={{
				width: touchTarget,
				height: touchTarget,
				borderRadius: radius.full,
				alignItems: "center",
				justifyContent: "center",
				// The ring is a conditional spread: `border` has no zero width,
				// and a 0 belongs to no scale this repo keeps.
				...(selected
					? {
							borderWidth: border.hairline,
							borderColor: theme.colors.onSurface,
						}
					: {}),
			}}
		>
			{children}
		</Pressable>
	);
}

function HueSwatch({
	hue,
	selected,
	onSelect,
}: {
	hue: LabelHueName;
	selected: boolean;
	onSelect: () => void;
}) {
	const { t } = useTranslation();
	const { fill, on } = useLabelColors(hue);

	return (
		<Swatch
			accessibilityLabel={t(`labels.hue.${hue}`)}
			selected={selected}
			onSelect={onSelect}
		>
			<View
				style={{
					width: size.avatarSm,
					height: size.avatarSm,
					borderRadius: radius.full,
					backgroundColor: fill,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{selected ? <Icon source="check" size={icon.sm} color={on} /> : null}
			</View>
		</Swatch>
	);
}

function CustomSwatch({
	color,
	selected,
	onOpen,
}: {
	color: string;
	selected: boolean;
	onOpen: () => void;
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const isCustom = !(color in labelHues);
	const { fill, on } = useLabelColors(color);

	return (
		<Swatch
			accessibilityLabel={t("labels.customColour")}
			selected={selected}
			onSelect={onOpen}
		>
			<View
				style={{
					width: size.avatarSm,
					height: size.avatarSm,
					borderRadius: radius.full,
					backgroundColor: isCustom ? fill : theme.colors.surfaceVariant,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon
					source="pencil"
					size={icon.sm}
					color={isCustom ? on : theme.colors.onSurfaceVariant}
				/>
			</View>
		</Swatch>
	);
}
