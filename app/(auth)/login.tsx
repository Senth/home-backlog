import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Snackbar, Text } from "react-native-paper";
import type { AuthErrorKey } from "@/auth/errors";
import { GoogleSignInButton } from "@/components/auth/GoogleSignIn";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

export default function Login() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { redirectError, dismissRedirectError } = useAuth();
	const [error, setError] = useState<AuthErrorKey | null>(null);

	// The redirect failure arrives on the context, not from the button — the
	// button's own page was unloaded when the redirect started.
	const message = error ?? redirectError;

	const dismiss = () => {
		setError(null);
		dismissRedirectError();
	};

	return (
		<View
			style={{
				flex: 1,
				justifyContent: "center",
				padding: space.xl,
				gap: space.lg,
				backgroundColor: theme.colors.background,
			}}
		>
			<View style={{ gap: space.sm }}>
				<Text variant="displaySmall" style={{ color: theme.colors.primary }}>
					{t("screen.login.title")}
				</Text>
				<Text
					variant="bodyLarge"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("screen.login.tagline")}
				</Text>
			</View>

			<GoogleSignInButton onError={setError} />

			<Snackbar visible={message !== null} onDismiss={dismiss}>
				{message ? t(message) : ""}
			</Snackbar>
		</View>
	);
}
