import "@/i18n";

import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { PaperProvider } from "react-native-paper";
import { OfflineBar } from "@/components/ui/OfflineBar";
import { UpdateBanner } from "@/components/ui/UpdateBanner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { darkTheme, lightTheme } from "@/theme";

function AuthGate() {
	const { user, loading } = useAuth();
	const segments = useSegments();
	const router = useRouter();

	useEffect(() => {
		if (loading) return;

		const inAuthGroup = segments[0] === "(auth)";

		if (!user && !inAuthGroup) {
			router.replace("/(auth)/login");
		} else if (user && inAuthGroup) {
			router.replace("/(app)/(tabs)/projects");
		}
	}, [user, loading, segments, router.replace]);

	// The offline bar sits above the router so every screen shows it, login
	// included; the update banner is a Snackbar and floats on top.
	return (
		<View style={{ flex: 1 }}>
			<OfflineBar />
			<Slot />
			<UpdateBanner />
		</View>
	);
}

export default function RootLayout() {
	const colorScheme = useColorScheme();

	return (
		<PaperProvider theme={colorScheme === "dark" ? darkTheme : lightTheme}>
			<AuthProvider>
				<AuthGate />
				<StatusBar style="auto" />
			</AuthProvider>
		</PaperProvider>
	);
}
