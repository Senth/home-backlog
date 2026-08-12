import { useTranslation } from "react-i18next";
import { Image, View } from "react-native";
import { ActivityIndicator } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { size, space } from "@/theme/tokens";

const brandMark = require("@/assets/images/icon.png");

/**
 * What the app shows while it does not yet know whether anyone is signed in.
 *
 * It replaces the router rather than covering it, so no route mounts and no
 * wrong screen can appear underneath. That matters more than it sounds: the
 * old behaviour flashed the empty Projects board at a signed-out visitor, and
 * on a phone in a garage with no signal that reads as *the app logged me out
 * and my list is gone*.
 *
 * It deliberately does not resemble the login screen — a splash that looks like
 * login is a login screen that keeps refusing to accept a tap. A skeleton board
 * was rejected for showing a signed-out visitor a fake board, and a blank
 * surface for being indistinguishable from a white-screen crash.
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
			<Image
				source={brandMark}
				accessibilityIgnoresInvertColors
				style={{ width: size.brandMark, height: size.brandMark }}
			/>
			<ActivityIndicator accessibilityLabel={t("common.loading")} />
		</View>
	);
}
