import "@/i18n";

import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { PaperProvider } from "react-native-paper";
import { OfflineBar } from "@/components/ui/OfflineBar";
import { SplashScreen } from "@/components/ui/SplashScreen";
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
	//
	// The splash replaces the router instead of covering it. Rendering `<Slot />`
	// while auth is unresolved mounts a route — and whichever route that is, it
	// is a guess about a question the app cannot answer yet.
	return (
		<View style={{ flex: 1 }}>
			<OfflineBar />
			{loading ? <SplashScreen /> : <Slot />}
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
