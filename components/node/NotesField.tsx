import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { useAutosave } from "@/hooks/use-autosave";
import { useBackgrounded } from "@/hooks/use-background";
import { maxNotesLength } from "@/models/node";
import { formatClockTime } from "@/models/relative-time";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface NotesFieldProps {
	label: string;
	/** What the document says. The field is uncontrolled from the first keystroke. */
	stored: string;
	onSave: (notes: string) => void;
}

/**
 * What the chimney sweep said, where the spare key is, which paint it was.
 *
 * `PROJECT.md` has notes absorbing cost and budget (#70) until the real need is
 * understood, so this is the field that has to be roomy rather than exact.
 * `maxLength` matches `validNode()`, so the rules are never the first thing that
 * says no.
 *
 * It saves itself on four triggers, because any one of them alone loses text —
 * see `useAutosave`. The fourth, the app going to background, is the one a
 * backgrounded PWA needs: it can be killed without blur or unmount firing.
 */
export function NotesField({ label, stored, onSave }: NotesFieldProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();

	const notes = useAutosave(stored, onSave);
	useBackgrounded(notes.flush);

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
				onBlur={notes.onBlur}
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
