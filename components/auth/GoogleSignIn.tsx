import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { Button } from "react-native-paper";
import { auth } from "@/config/firebase";
import { useAuth } from "@/contexts/AuthContext";

WebBrowser.maybeCompleteAuthSession();

const discovery = {
	authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenEndpoint: "https://oauth2.googleapis.com/token",
};

interface GoogleSignInButtonProps {
	onError?: (message: string) => void;
}

/**
 * Google is the only sign-in method (see `docs/PROJECT.md`).
 *
 * Web uses `signInWithPopup`, which the Firebase Auth emulator intercepts with
 * its own account picker — so local development against the emulators works
 * without a real Google account. Native cannot use a popup and goes through
 * `expo-auth-session` with PKCE instead.
 */
export function GoogleSignInButton({ onError }: GoogleSignInButtonProps = {}) {
	return Platform.OS === "web" ? (
		<GoogleSignInWeb onError={onError} />
	) : (
		<GoogleSignInNative onError={onError} />
	);
}

function GoogleSignInWeb({ onError }: GoogleSignInButtonProps) {
	const { t } = useTranslation();
	const [loading, setLoading] = useState(false);

	const handlePress = async () => {
		setLoading(true);
		try {
			const provider = new GoogleAuthProvider();
			provider.addScope("profile");
			provider.addScope("email");
			await signInWithPopup(auth, provider);
		} catch (error) {
			console.error("Google sign-in error:", error);
			onError?.(t("error.googleSignIn"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button
			mode="contained"
			icon="google"
			onPress={handlePress}
			loading={loading}
			disabled={loading}
		>
			{t("screen.login.google")}
		</Button>
	);
}

function GoogleSignInNative({ onError }: GoogleSignInButtonProps) {
	const { t } = useTranslation();
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
			onError?.(t("error.googleSignIn"));
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

			if (tokens.idToken) await signInWithGoogle(tokens.idToken);
		} catch (error) {
			console.error("Google sign-in error:", error);
			onError?.(t("error.googleSignIn"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button
			mode="contained"
			icon="google"
			onPress={handlePress}
			loading={loading}
			disabled={loading || !request}
		>
			{t("screen.login.google")}
		</Button>
	);
}
