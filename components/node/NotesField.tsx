import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { IconButton, Text, TextInput } from "react-native-paper";
import { useAutosave } from "@/hooks/use-autosave";
import { useBackgrounded } from "@/hooks/use-background";
import { maxNotesLength } from "@/models/node";
import { formatClockTime } from "@/models/relative-time";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget, touchTargetStyle } from "@/theme/tokens";

interface NotesFieldProps {
	label: string;
	/** What the document says. The field is uncontrolled from the first keystroke. */
	stored: string;
	onSave: (notes: string) => void;
}

/**
 * What the chimney sweep said, where the spare key is, which paint it was.
 *
 * **The note reads as text on arrival** (#237 phase 2): it is the only free
 * text anyone wrote here, so it renders `bodyLarge` under its label, and the
 * pencil — or the label — is what opens the editor. A note is read far more
 * often than it is written, and an outlined box around a paragraph of it made
 * every visit feel like filling in a form.
 *
 * The editor is the field this always was. `PROJECT.md` has notes absorbing
 * cost and budget (#70) until the real need is understood, so it is the field
 * that has to be roomy rather than exact. `maxLength` matches `validNode()`,
 * so the rules are never the first thing that says no. It saves itself on four
 * triggers, because any one of them alone loses text — see `useAutosave`. The
 * fourth, the app going to background, is the one a backgrounded PWA needs: it
 * can be killed without blur or unmount firing. Blur also closes the editor:
 * the write and the way back out are the same gesture.
 */
export function NotesField({ label, stored, onSave }: NotesFieldProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const [editing, setEditing] = useState(false);

	const notes = useAutosave(stored, onSave);
	useBackgrounded(notes.flush);

	if (!editing) {
		return (
			<View style={{ gap: space.sm }}>
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={label}
						onPress={() => setEditing(true)}
						style={{
							flex: 1,
							minHeight: touchTarget,
							justifyContent: "center",
						}}
					>
						<Text
							variant="labelLarge"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{label}
						</Text>
					</Pressable>
					<IconButton
						icon="pencil"
						size={icon.sm}
						accessibilityLabel={t("detail.notesEdit")}
						onPress={() => setEditing(true)}
						style={touchTargetStyle}
					/>
				</View>
				{stored === "" ? null : <Text variant="bodyLarge">{stored}</Text>}
			</View>
		);
	}

	return (
		<View style={{ gap: space.sm }}>
			<Text
				variant="labelLarge"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{label}
			</Text>
			<TextInput
				mode="outlined"
				multiline
				numberOfLines={notesRows}
				maxLength={maxNotesLength}
				placeholder={t("detail.notesPlaceholder")}
				value={notes.value}
				onChangeText={notes.onChangeText}
				onBlur={() => {
					notes.onBlur();
					setEditing(false);
				}}
				autoFocus
			/>
			{/* Even a write that succeeds says nothing, and silence reads as "did not
			    take" to anyone who has pressed Save on every device they have owned.
			    This reports the *local* write, which is durable immediately;
			    `OfflineBar` says the rest. */}
			{notes.savedAt === null ? null : (
				<Text
					variant="bodySmall"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("detail.saved", {
						time: formatClockTime(notes.savedAt, i18n.language),
					})}
				</Text>
			)}
		</View>
	);
}

/** Tall enough for a few lines without pushing Steps off the first screen. */
const notesRows = 5;
