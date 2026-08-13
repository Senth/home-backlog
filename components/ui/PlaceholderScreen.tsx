import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar, Text } from "react-native-paper";
import { useHome } from "@/contexts/HomeContext";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface PlaceholderScreenProps {
	body: string;
	/**
	 * Quieter line under the empty state. Used for "signed in as", which is the
	 * only place a phone shows the address without a tap — and a wrong-account
	 * sign-in is otherwise indistinguishable from a broken app.
	 */
	footnote?: string;
	/** Rendered above the empty state — used for the PWA install offer. */
	children?: ReactNode;
	/** Right-hand action in the app bar. */
	action?: ReactNode;
}

/**
 * Standing in for the Projects, Locations and Maintenance screens until each
 * feature lands. Deliberately a single shared component: the real screens will
 * replace it one at a time, and nothing here should be worth keeping.
 *
 * The app bar names the *home*, not the screen — the bottom tab bar already
 * names the screen, and which home you are in has to be visible without a tap.
 * Without it, work on the cabin gets recorded on the house board and nothing on
 * screen ever said otherwise. The back action is the way up to "My homes",
 * which is where switching happens.
 */
export function PlaceholderScreen({
	body,
	footnote,
	children,
	action,
}: PlaceholderScreenProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { activeHome } = useHome();

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
				{action}
			</Appbar.Header>
			{children}
			<View
				style={{
					flex: 1,
					alignItems: "center",
					justifyContent: "center",
					gap: space.sm,
					padding: space.xl,
				}}
			>
				<Text
					variant="bodyLarge"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{body}
				</Text>
				{footnote ? (
					<Text
						variant="bodySmall"
						style={{
							color: theme.colors.onSurfaceVariant,
							textAlign: "center",
						}}
					>
						{footnote}
					</Text>
				) : null}
			</View>
		</View>
	);
}
