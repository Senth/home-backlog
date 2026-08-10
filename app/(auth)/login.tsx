import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Snackbar, Text } from "react-native-paper";
import { GoogleSignInButton } from "@/components/auth/GoogleSignIn";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

export default function Login() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [error, setError] = useState<string | null>(null);

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

			<Snackbar visible={error !== null} onDismiss={() => setError(null)}>
				{error ?? ""}
			</Snackbar>
		</View>
	);
}
