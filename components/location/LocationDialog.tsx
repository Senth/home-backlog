import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
	Button,
	HelperText,
	Icon,
	Portal,
	Text,
	TextInput,
} from "react-native-paper";
import { ColorSwatches } from "@/components/label/ColorSwatches";
import { IconPicker } from "@/components/label/IconPicker";
import { AppDialog } from "@/components/ui/AppDialog";
import { useAuth } from "@/contexts/AuthContext";
import { createLocation, editLocation } from "@/data/locations";
import { useLocationColors } from "@/hooks/use-location-colors";
import {
	defaultLocationColor,
	defaultLocationIcon,
	type Location,
	type LocationTitleError,
	locationTitleError,
} from "@/models/locations";
import { rankAtEnd } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

interface LocationDialogProps {
	homeId: string;
	/** The place being edited, or `null` on the create path. */
	location: Location | null;
	/** The place a new one is created under — `null` is the top level. */
	parent: Location | null;
	/** The existing siblings, so a new place lands at the end. */
	siblings: readonly Location[];
	onDismiss: () => void;
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * Creating and editing one place (#205), in one dialog on `LabelDialog`'s
 * shape: the name is read first, the icon second, the color quiet beneath it.
 * One editor for the document — the old rename path is gone, and creating a
 * place opens this same dialog with the defaults filled in, so a place with
 * nothing chosen still saves and still draws the default glyph.
 *
 * Writes queue like every other edit, so saving dismisses at once; a refused
 * write surfaces through the screen's snackbar, the way `renameHome` argues
 * for. The edit writes only what changed, so two members editing different
 * facts about one place merge at the field path.
 */
export function LocationDialog({
	homeId,
	location,
	parent,
	siblings,
	onDismiss,
	testID,
	returnFocusTo,
}: LocationDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { user } = useAuth();

	const [title, setTitle] = useState(location?.title ?? "");
	const [icon, setIcon] = useState(location?.icon ?? defaultLocationIcon);
	const [color, setColor] = useState(location?.color ?? defaultLocationColor);
	const [titleProblem, setTitleProblem] = useState<LocationTitleError | null>(
		null,
	);
	const [pickingIcon, setPickingIcon] = useState(false);
	// The preview and the palette row both show the tone the tree will draw
	// (#328), so a chosen color reads the same in the dialog as on the map.
	const glyphColor = useLocationColors(color).fill;

	const save = () => {
		// Trimmed once, here, like the removed rename path did: the stored
		// title has no leading or trailing spaces, and the change detection
		// below compares like with like.
		const trimmed = title.trim();
		const problem = locationTitleError(trimmed);
		if (problem !== null) {
			setTitleProblem(problem);
			return;
		}
		if (user === null) return;

		onDismiss();
		if (location === null) {
			createLocation(homeId, user.uid, {
				title: trimmed,
				icon,
				color,
				parent,
				rank: rankAtEnd(siblings.at(-1)?.rank ?? null),
			});
			return;
		}

		// Only what changed — two members editing different facts merge at the
		// field path, so untouched writes would queue for nothing.
		const changes: { title?: string; icon?: string; color?: string } = {};
		if (trimmed !== location.title) changes.title = trimmed;
		if (icon !== location.icon) changes.icon = icon;
		if (color !== location.color) changes.color = color;
		if (Object.keys(changes).length > 0)
			editLocation(homeId, location.id, changes);
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
					title={t(location === null ? "locations.add" : "locations.edit")}
					testID={testID}
					returnFocusTo={returnFocusTo}
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
							mode="contained-tonal"
							onPress={save}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t(location === null ? "board.add" : "labels.save")}
						</Button>,
					]}
				>
					<View style={{ gap: space.lg }}>
						<View>
							<TextInput
								mode="outlined"
								label={t("locations.nameLabel")}
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
								onPress={() => setPickingIcon(true)}
								contentStyle={{ minHeight: touchTarget }}
								// The glyph is the preview in the chosen color; a string
								// source would draw it in the button's own text color.
								icon={({ size }) => (
									<Icon source={icon} size={size} color={glyphColor} />
								)}
							>
								{t("labels.changeIcon")}
							</Button>
						</View>

						<ColorSwatches
							value={color}
							onChange={setColor}
							variant="location"
						/>
					</View>
				</AppDialog>
			)}
		</View>
	);
}
