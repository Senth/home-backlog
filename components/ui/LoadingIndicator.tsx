import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StyleProp, ViewStyle } from "react-native";
import { ActivityIndicator } from "react-native-paper";
import { motion } from "@/theme/tokens";

export function LoadingIndicator({ style }: { style?: StyleProp<ViewStyle> }) {
	const { t } = useTranslation();
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => setVisible(true), motion.loadingDelay);
		return () => clearTimeout(timer);
	}, []);

	return visible ? (
		<ActivityIndicator accessibilityLabel={t("common.loading")} style={style} />
	) : null;
}
