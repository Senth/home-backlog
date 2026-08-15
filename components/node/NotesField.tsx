import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { maxNotesLength } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface NotesFieldProps {
	label: string;
	value: string;
	onChangeText: (notes: string) => void;
}

/**
 * What the chimney sweep said, where the spare key is, which paint it was.
 *
 * `PROJECT.md` has notes absorbing cost and budget (#70) until the real need is
 * understood, so this is the field that has to be roomy rather than exact.
 * `maxLength` matches `validNode()`, so the rules are never the first thing that
 * says no.
 */
export function NotesField({ label, value, onChangeText }: NotesFieldProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

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
				value={value}
				onChangeText={onChangeText}
			/>
		</View>
	);
}

/** Tall enough for a few lines without pushing Steps off the first screen. */
const notesRows = 5;
