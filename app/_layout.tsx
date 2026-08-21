import "@/i18n";

import { Slot } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PaperProvider } from "react-native-paper";
import { OfflineBar } from "@/components/ui/OfflineBar";
import { PaperIcon } from "@/components/ui/PaperIcon";
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
	const { t } = useTranslation();

	// The gesture root has to be the outermost view in the tree, above the
	// portals Paper's dialogs and menus render into: a card dragged on a board
	// is handled by a gesture, and on native a gesture outside this view is
	// never recognised at all.
	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			{/* Expo Router manages the document title through react-helmet, which
			    renders an *empty* `<title>` when no screen sets one — so the page
			    had no accessible name and a screen reader announced the URL. A
			    static title in `+html.tsx` cannot fix it: helmet's element wins.
			    Per-screen titles belong to the screens; this is the fallback. */}
			<Head>
				<title>{t("app.name")}</title>
			</Head>
			<PaperProvider
				theme={colorScheme === "dark" ? darkTheme : lightTheme}
				// Paper's icons are decorative glyphs that React Native Web exposes
				// as unnamed `role="img"` elements. `PaperIcon` hides them, leaving
				// the control's own label as the only thing announced.
				settings={{ icon: PaperIcon }}
			>
				<AuthProvider>
					<AuthGate />
					<StatusBar style="auto" />
				</AuthProvider>
			</PaperProvider>
		</GestureHandlerRootView>
	);
}
