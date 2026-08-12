import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

/**
 * Slim status bar shown while the browser reports no connection. Sits above the
 * router so it reaches every screen, the login form included.
 *
 * The wording depends on whether there is a session. Signed in, "changes are
 * saved and will sync" is true — Firestore serves the cache and queues the
 * writes. Signed out it is a lie: there is nothing to save into, and the only
 * honest thing to say is that signing in needs a connection.
 */
export function OfflineBar() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();
	const { user, loading } = useAuth();

	// While auth is unresolved `user` is null, which is not the same as signed
	// out. Saying "you need a connection to sign in" over the splash to someone
	// who *is* signed in is the exact "the app logged me out" lie the splash
	// exists to prevent, so say nothing until there is an answer.
	if (online || loading) return null;

	return (
		<View
			accessibilityRole="alert"
			style={{
				backgroundColor: theme.colors.warningContainer,
				paddingVertical: space.xs,
				paddingHorizontal: space.md,
			}}
		>
			<Text
				variant="labelMedium"
				style={{ color: theme.colors.onWarningContainer, textAlign: "center" }}
			>
				{t(user ? "status.offline" : "status.offlineSignedOut")}
			</Text>
		</View>
	);
}
