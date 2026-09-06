import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { Snackbar, Surface, Text } from "react-native-paper";
import type { AuthErrorKey } from "@/auth/errors";
import { GoogleSignInButton } from "@/components/auth/GoogleSignIn";
import { BrandMark } from "@/components/ui/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	denseBreakpoint,
	elevation,
	radius,
	space,
} from "@/theme/tokens";

/**
 * One layout at every width: a card centered in a scroll view and clamped to
 * `contentWidth.form`, filling the screen below that.
 *
 * The `ScrollView` is not decoration. At 200 % text scale the card outgrows a
 * phone, and content that no longer fits has to scroll rather than clip — the
 * one screen in the app where clipping means locked out.
 *
 * Signed out with no connection, nothing in the app works: Firestore's offline
 * cache only helps a session that already exists. So the button is disabled
 * with a reason rather than allowed to fail, and re-enables by itself when the
 * connection returns.
 */
export default function Login() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();
	const { redirectError, dismissRedirectError } = useAuth();
	const { width } = useWindowDimensions();
	const [error, setError] = useState<AuthErrorKey | null>(null);

	// At high zoom the padding is what starves the button label of room to wrap
	// into, so below `denseBreakpoint` the control wins and the whitespace loses.
	const dense = width < denseBreakpoint;
	const screenPadding = dense ? space.sm : space.lg;
	const cardPadding = dense ? space.md : space.xl;

	// A failed redirect arrives on the context, not from the button: the page
	// that owned the button was unloaded the moment the redirect started.
	const message = error ?? redirectError;

	const dismiss = () => {
		setError(null);
		dismissRedirectError();
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<ScrollView
				contentContainerStyle={{
					flexGrow: 1,
					alignItems: "center",
					justifyContent: "center",
					padding: screenPadding,
				}}
			>
				<Surface
					elevation={elevation.low}
					style={{
						width: "100%",
						maxWidth: contentWidth.form,
						alignItems: "center",
						gap: space.lg,
						padding: cardPadding,
						borderRadius: radius.lg,
					}}
				>
					<BrandMark />

					<View style={{ alignItems: "center", gap: space.sm }}>
						<Text
							variant="displaySmall"
							style={{ color: theme.colors.primary, textAlign: "center" }}
						>
							{t("screen.login.title")}
						</Text>
						<Text
							variant="bodyLarge"
							style={{
								color: theme.colors.onSurfaceVariant,
								textAlign: "center",
							}}
						>
							{t("screen.login.tagline")}
						</Text>
					</View>

					{/* Deliberately empty: the room the "who invited you" context line
					    of #22 will take, reserved so adding it does not move the
					    button out from under anyone's thumb. */}
					<View style={{ height: space.md }} />

					<View style={{ width: "100%", gap: space.sm }}>
						<GoogleSignInButton onError={setError} disabled={!online} />
						{online ? null : (
							<Text
								variant="bodyMedium"
								style={{
									color: theme.colors.onSurfaceVariant,
									textAlign: "center",
								}}
							>
								{t("screen.login.offlineHint")}
							</Text>
						)}
					</View>
				</Surface>
			</ScrollView>

			<Snackbar visible={message !== null} onDismiss={dismiss}>
				{message ? t(message) : ""}
			</Snackbar>
		</View>
	);
}
