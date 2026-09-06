import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ActivityIndicator } from "react-native-paper";
import { BrandMark } from "@/components/ui/BrandMark";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

/**
 * What the app shows while it does not yet know whether anyone is signed in.
 *
 * It replaces the router rather than covering it, so no route mounts and no
 * wrong screen can appear underneath. That matters more than it sounds: the
 * old behavior flashed the empty Projects board at a signed-out visitor, and
 * on a phone in a garage with no signal that reads as *the app logged me out
 * and my list is gone*.
 *
 * It deliberately does not resemble the login screen — a splash that looks like
 * login is a login screen that keeps refusing to accept a tap. A skeleton board
 * was rejected for showing a signed-out visitor a fake board, and a blank
 * surface for being indistinguishable from a white-screen crash, which is why
 * `BrandMark` paints its own tile rather than waiting for an image.
 */
export function SplashScreen() {
	const { t } = useTranslation();
	const theme = useAppTheme();

	return (
		<View
			style={{
				flex: 1,
				alignItems: "center",
				justifyContent: "center",
				gap: space.lg,
				backgroundColor: theme.colors.background,
			}}
		>
			<BrandMark />
			<ActivityIndicator accessibilityLabel={t("common.loading")} />
		</View>
	);
}
