import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

/**
 * Screens where nothing a person can do queues, so the bar must not say it will.
 *
 * `/automations` is the whole of it today: minting a key calls a function and
 * revoking one has to reach the server, and both are disabled offline with a
 * reason of their own. A board is the opposite — every write there queues — and
 * `/homes` is in between, because switching home works from cache and only
 * creating one does not.
 *
 * A list rather than a prop, because the bar is mounted once above the router
 * and a screen has no way to reach up into it. Adding an online-only screen
 * means adding it here; the cost of forgetting is the sentence this exists to
 * prevent.
 */
const onlineOnlyScreens = ["/automations"];

/**
 * Slim status bar shown while the browser reports no connection. Sits above the
 * router so it reaches every screen, the login form included.
 *
 * The wording depends on what is actually true where you are standing. Signed
 * in on an ordinary screen, "changes are saved and will sync" holds — Firestore
 * serves the cache and queues the writes. Signed out it is a lie: there is
 * nothing to save into. And on an online-only screen it is a different lie, and
 * a worse one, because the screen's own disabled button says the opposite three
 * centimetres below it — somebody who reads only the banner walks away believing
 * a key they tried to create is waiting to be sent.
 */
export function OfflineBar() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();
	const pathname = usePathname();
	const { user, loading } = useAuth();

	// While auth is unresolved `user` is null, which is not the same as signed
	// out. Saying "you need a connection to sign in" over the splash to someone
	// who *is* signed in is the exact "the app logged me out" lie the splash
	// exists to prevent, so say nothing until there is an answer.
	if (online || loading) return null;

	const queues =
		user !== null &&
		!onlineOnlyScreens.some((screen) => pathname.startsWith(screen));
	const message = user
		? queues
			? "status.offline"
			: "status.offlineNoQueue"
		: "status.offlineSignedOut";

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
				{t(message)}
			</Text>
		</View>
	);
}
