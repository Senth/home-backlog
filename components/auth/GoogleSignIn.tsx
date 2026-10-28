import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import {
	GoogleAuthProvider,
	reauthenticateWithCredential,
} from "firebase/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "react-native-paper";
import { mapAuthError } from "@/auth/errors";
import type { GoogleSignInButtonProps } from "@/components/auth/GoogleSignIn.types";
import { auth } from "@/config/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/theme";
import { touchTarget } from "@/theme/tokens";

WebBrowser.maybeCompleteAuthSession();

const discovery = {
	authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenEndpoint: "https://oauth2.googleapis.com/token",
};

/**
 * Native Google sign-in. Web is a separate file — `GoogleSignIn.web.tsx` — and
 * uses `signInWithRedirect`, which does not exist in Firebase's React Native
 * build.
 *
 * Native cannot use a browser redirect and goes through `expo-auth-session`
 * with PKCE instead, exchanging the code for an ID token that `AuthContext`
 * turns into a Firebase session. Native session persistence and this flow are
 * issue #8; nothing here has been verified on a device.
 */
export function GoogleSignInButton({
	onError,
	disabled,
	reauthenticate = false,
	onSuccess,
}: GoogleSignInButtonProps = {}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { signInWithGoogle } = useAuth();
	const [loading, setLoading] = useState(false);

	const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
	const redirectUri = AuthSession.makeRedirectUri();

	const [request, , promptAsync] = AuthSession.useAuthRequest(
		{
			clientId,
			redirectUri,
			scopes: ["openid", "profile", "email"],
			responseType: AuthSession.ResponseType.Code,
		},
		discovery,
	);

	const handlePress = async () => {
		if (!clientId) {
			console.warn(
				"EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set; Google sign-in is disabled.",
			);
			onError?.("error.googleSignIn");
			return;
		}

		setLoading(true);
		try {
			const result = await promptAsync();
			if (result.type !== "success" || !result.params.code) return;

			const tokens = await AuthSession.exchangeCodeAsync(
				{
					clientId,
					code: result.params.code,
					redirectUri,
					extraParams: { code_verifier: request?.codeVerifier ?? "" },
				},
				discovery,
			);

			if (tokens.idToken) {
				if (reauthenticate && auth.currentUser) {
					await reauthenticateWithCredential(
						auth.currentUser,
						GoogleAuthProvider.credential(tokens.idToken),
					);
				} else {
					await signInWithGoogle(tokens.idToken);
				}
				onSuccess?.();
			}
		} catch (error) {
			onError?.(mapAuthError(error));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button
			mode={reauthenticate ? "text" : "contained"}
			textColor={reauthenticate ? theme.colors.error : undefined}
			icon="google"
			onPress={handlePress}
			loading={loading}
			disabled={loading || disabled || !request}
			// Paper's own button is 40 dp tall, under the project's 48.
			contentStyle={{ minHeight: touchTarget }}
		>
			{t(reauthenticate ? "account.delete.signInAgain" : "screen.login.google")}
		</Button>
	);
}
