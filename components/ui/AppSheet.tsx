import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { Modal, Portal } from "react-native-paper";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { useAppTheme } from "@/theme";
import { elevation, radius, space } from "@/theme/tokens";

interface AppSheetProps {
	visible: boolean;
	onDismiss: () => void;
	/** Unique per sheet: the focus trap finds the surface by `${testID}-surface`. */
	testID: string;
	children?: ReactNode;
	/** Whatever opened the sheet, so a keyboard user is not dropped on `<body>`. */
	returnFocusTo?: RefObject<View | null>;
}

/**
 * The bottom sheet beside `AppDialog` (#237): the field editors on the details
 * screen rise from the bottom edge, the phone idiom the plan's decision names —
 * a centered dialog covers the row that opened it, and the row is the context.
 *
 * `react-native-paper` ships no sheet, so this is its `Modal` bottom-anchored
 * instead of centered: the drag handle, the rounded top corners and the full
 * width are the sheet's shape, and `useModalFocus` — the same trap `AppDialog`
 * uses — supplies the focus return and Escape. Paper's own scrim label, which
 * `Dialog` has no prop to reach, `Modal` takes directly; the scrim relabel
 * rides along so the two containers stay on one behaviour.
 *
 * The content scrolls (#297): a sheet whose rows outgrow the window used to
 * hang its top — the title and the search — past the screen edge, so the
 * scrollable region is the sheet's body and the cap moves onto it. The handle
 * stays fixed above it, and a short sheet hugs its content exactly as before.
 */
export function AppSheet({
	visible,
	onDismiss,
	testID,
	children,
	returnFocusTo,
}: AppSheetProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { height } = useWindowDimensions();

	useModalFocus(visible, `${testID}-surface`, onDismiss, {
		returnFocusTo,
		scrim: { testID: `${testID}-backdrop`, label: t("common.closeDialog") },
	});

	return (
		<Portal>
			<Modal
				visible={visible}
				onDismiss={onDismiss}
				testID={testID}
				overlayAccessibilityLabel={t("common.closeDialog")}
				// `style` lands on the wrapper, which centers by default — the one
				// line that makes a sheet a sheet.
				style={{ justifyContent: "flex-end" }}
				contentContainerStyle={{
					backgroundColor: theme.colors.elevation.level3,
					elevation: elevation.high,
					borderTopLeftRadius: radius.xl,
					borderTopRightRadius: radius.xl,
					paddingHorizontal: space.lg,
					paddingTop: space.sm,
					paddingBottom: space.lg,
				}}
			>
				{/* The drag handle, decorative on purpose: it marks the surface as a
			    sheet, and the dismissal is the scrim's — a 4dp control would
			    undercut the touch floor, and the affordance it would duplicate is
			    already a full-width target. */}
				<View
					style={{
						width: space.xl,
						height: space.xs,
						borderRadius: radius.full,
						backgroundColor: theme.colors.outlineVariant,
						alignSelf: "center",
						marginBottom: space.md,
					}}
				/>
				{/* The cap the content container used to carry (#297): with the
			    handle and the sheet's own padding outside it, the whole sheet
			    still fits the window, and the rows scroll under the top edge
			    instead of past it. `keyboardShouldPersistTaps` keeps a row tap
			    on a search-plus-list sheet one tap, as `IconPicker` does. */}
				<ScrollView
					keyboardShouldPersistTaps="handled"
					style={{ maxHeight: height - space.xxl * 2 }}
				>
					{children}
				</ScrollView>
			</Modal>
		</Portal>
	);
}
