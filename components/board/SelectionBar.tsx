import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { Appbar, Button } from "react-native-paper";
import { AppHeader } from "@/components/ui/AppHeader";
import type { useCardSelection } from "@/hooks/use-card-selection";
import {
	compactBreakpoint,
	space,
	touchTarget,
	touchTargetStyle,
} from "@/theme/tokens";

export function SelectCardsAction({ onPress }: { onPress: () => void }) {
	const { t } = useTranslation();
	return (
		<Appbar.Action
			icon="checkbox-multiple-marked-outline"
			accessibilityLabel={t("board.selectCards")}
			onPress={onPress}
			style={touchTargetStyle}
		/>
	);
}

export function SelectionBar({
	selection,
}: {
	selection: ReturnType<typeof useCardSelection>;
}) {
	const { t } = useTranslation();
	const { width } = useWindowDimensions();
	const anchor = useRef<View>(null);
	const count = selection.state.ids.length;
	return (
		<AppHeader
			title={t("board.selectedCount", { count })}
			leading={
				<Appbar.Action
					icon="close"
					accessibilityLabel={t("board.stopSelecting")}
					onPress={selection.clear}
					style={touchTargetStyle}
				/>
			}
		>
			{width >= compactBreakpoint ? (
				<View ref={anchor} style={{ marginRight: space.md }}>
					<Button
						mode="outlined"
						icon="arrow-right-bold-outline"
						disabled={count === 0}
						onPress={() => selection.openMove(anchor.current)}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("board.moveTo")}
					</Button>
				</View>
			) : null}
		</AppHeader>
	);
}
