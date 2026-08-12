import "@/i18n";

import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { PaperProvider } from "react-native-paper";
import { OfflineBar } from "@/components/ui/OfflineBar";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { UpdateBanner } from "@/components/ui/UpdateBanner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { darkTheme, lightTheme } from "@/theme";

function AuthGate() {
	const { loading } = useAuth();

	// Where you are sent is decided by the two group layouts and by
	// `app/index.tsx`, declaratively during render. This gate only decides
	// *whether the router exists yet* — the splash replaces it rather than
	// covering it, because rendering `<Slot />` while auth is unresolved mounts
	// a route, and whichever route that is, it is a guess about a question the
	// app cannot answer yet.
	//
	// The offline bar sits above the router so every screen shows it, login
	// included; the update banner is a Snackbar and floats on top.
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
