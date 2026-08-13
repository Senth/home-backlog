import { Image, View } from "react-native";
import { brandMarkSource } from "@/components/ui/brand-mark-source";
import { useAppTheme } from "@/theme";
import { radius, size } from "@/theme/tokens";

interface BrandMarkProps {
	/** Defaults to `size.brandMark`. */
	px?: number;
}

/**
 * The app icon, on the splash and the login card.
 *
 * It sits on a `primaryContainer` tile of exactly its own size, so a mark that
 * has not arrived yet is a coloured square rather than a hole, and nothing
 * moves when it does arrive. Both screens exist to say *this is not broken*,
 * and an empty gap where the logo belongs is what broken looks like — most of
 * all to the person least sure the app works at all.
 */
export function BrandMark({ px = size.brandMark }: BrandMarkProps = {}) {
	const theme = useAppTheme();

	return (
		<View
			style={{
				width: px,
				height: px,
				borderRadius: radius.lg,
				overflow: "hidden",
				backgroundColor: theme.colors.primaryContainer,
			}}
		>
			<Image
				source={brandMarkSource}
				accessibilityIgnoresInvertColors
				style={{ width: px, height: px }}
			/>
		</View>
	);
}
