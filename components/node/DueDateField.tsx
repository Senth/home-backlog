import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Text } from "react-native-paper";
import {
	DatePickerModal,
	en,
	registerTranslation,
	sv,
} from "react-native-paper-dates";
import {
	formatCalendarDay,
	fromCalendarDay,
	toCalendarDay,
} from "@/models/due-date";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

/**
 * The picker keeps its own translations, keyed by whatever string is handed to
 * its `locale` prop — so they are registered under the app's own locale tags
 * rather than the library's short codes, and one value flows through both.
 *
 * At module scope, so this has happened before anything can render the modal.
 */
registerTranslation("en-US", en);
registerTranslation("sv-SE", sv);

interface DueDateFieldProps {
	label: string;
	/** `'YYYY-MM-DD'`, or null for a card with no date. */
	value: string | null;
	onChange: (dueDate: string | null) => void;
}

/**
 * The one date a card has, as a calendar day.
 *
 * `react-native-paper-dates` rather than a `<input type="date">` behind a
 * `.web.tsx` split: the input is free and locale-aware for nothing, but it cannot
 * be themed and it needs a whole second implementation the first time a native
 * build happens, which `PROJECT.md` schedules rather than rules out. This is the
 * Paper ecosystem's own picker and takes the app's Material 3 theme without a
 * second palette.
 *
 * The picker deals in `Date`, the document in `'YYYY-MM-DD'`, and the conversion
 * goes through `models/due-date.ts` in both directions — a date reduced with
 * `toISOString()` is the day before, for half of every day, in both timezones
 * this app ships strings for.
 */
export function DueDateField({ label, value, onChange }: DueDateFieldProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();

	const [picking, setPicking] = useState(false);

	return (
		<View style={{ gap: space.sm }}>
			<Text
				variant="labelLarge"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{label}
			</Text>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
			>
				<Button
					mode="outlined"
					icon="calendar"
					onPress={() => setPicking(true)}
					contentStyle={{ minHeight: touchTarget }}
					style={{ flexShrink: 1 }}
				>
					{value === null
						? t("detail.addDate")
						: formatCalendarDay(value, i18n.language)}
				</Button>
				{/* Only once there is something to clear. A permanently visible Clear
				    on an empty field is a control that does nothing, on the screen
				    that exists to be uncluttered. */}
				{value === null ? null : (
					<Button
						onPress={() => onChange(null)}
						textColor={theme.colors.onSurfaceVariant}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("detail.clear")}
					</Button>
				)}
			</View>

			{/* Mounted only while open, the way the card's dialogs are: the modal
			    registers with the host whether or not anything is on screen. */}
			{picking ? (
				<DatePickerModal
					visible
					mode="single"
					locale={i18n.language}
					date={
						value === null ? undefined : (fromCalendarDay(value) ?? undefined)
					}
					onDismiss={() => setPicking(false)}
					onConfirm={({ date }) => {
						setPicking(false);
						onChange(date === undefined ? null : toCalendarDay(date));
					}}
				/>
			) : null}
		</View>
	);
}
