import "@/i18n";

import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
	DarkTheme,
	DefaultTheme,
	ThemeProvider,
} from "@react-navigation/native";
import {
	isLoaded as isFontLoaded,
	loadAsync as loadFontAsync,
} from "expo-font";
import { Slot } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
import { darkTheme, lightTheme, useAppTheme } from "@/theme";

function AuthGate() {
	const { loading } = useAuth();
	const [fontsReady, setFontsReady] = useState(false);

	// The icon font is loaded once, here, behind the splash. Every icon that
	// mounts while it is still arriving starts a load of its own, and
	// expo-font's web loader abandons any load that takes over 12s with a
	// rejection nobody catches — one slow font fetch becomes an uncaught
	// error on every screen that renders a glyph. Gating the router on the
	// font keeps every mounted icon on expo-font's already-loaded fast path,
	// and the retry is what turns the 12s rejection into patience: the
	// failed promise is deleted from expo-font's cache, so the next attempt
	// starts fresh and the only awaiter that sees a rejection is this one.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			while (!cancelled) {
				if (isFontLoaded(MaterialCommunityIcons.getFontFamily())) break;
				try {
					await loadFontAsync(MaterialCommunityIcons.font);
					break;
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			}
			if (!cancelled) setFontsReady(true);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

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
			{loading || !fontsReady ? <SplashScreen /> : <Slot />}
			<UpdateBanner />
		</View>
	);
}

/**
 * The theme the *navigators* read. Without it every Stack and Tabs falls back
 * to react-navigation's `DefaultTheme`, which paints `rgb(242, 242, 242)` as
 * the full-screen background of every route and `rgb(216, 216, 216)` as the
 * desktop tab bar's top border — colours that belong to no palette this app
 * has. The mapping is Paper role → navigation role, so the navigator paints
 * the same surfaces the screens under it do.
 */
function NavigationTheme({ children }: { children: ReactNode }) {
	const theme = useAppTheme();

	const navigationTheme = useMemo(
		() => ({
			...(theme.dark ? DarkTheme : DefaultTheme),
			colors: {
				...(theme.dark ? DarkTheme : DefaultTheme).colors,
				primary: theme.colors.primary,
				background: theme.colors.background,
				card: theme.colors.surface,
				text: theme.colors.onSurface,
				border: theme.colors.outlineVariant,
				notification: theme.colors.error,
			},
		}),
		[theme],
	);

	return <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>;
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
				<NavigationTheme>
					<AuthProvider>
						<AuthGate />
						<StatusBar style="auto" />
					</AuthProvider>
				</NavigationTheme>
			</PaperProvider>
		</GestureHandlerRootView>
	);
}
