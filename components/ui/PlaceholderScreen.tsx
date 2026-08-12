import type { ReactNode } from "react";
import { View } from "react-native";
import { Appbar, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface PlaceholderScreenProps {
	title: string;
	body: string;
	/**
	 * Quieter line under the empty state. Used for "signed in as", which is the
	 * only place a phone shows the address without a tap — and a wrong-account
	 * sign-in is otherwise indistinguishable from a broken app.
	 */
	footnote?: string;
	/** Rendered above the empty state — used for the PWA install offer. */
	children?: ReactNode;
	/** Right-hand action in the app bar. */
	action?: ReactNode;
}

/**
 * Standing in for the Projects, Locations and Maintenance screens until each
 * feature lands. Deliberately a single shared component: the real screens will
 * replace it one at a time, and nothing here should be worth keeping.
 */
export function PlaceholderScreen({
	title,
	body,
	footnote,
	children,
	action,
}: PlaceholderScreenProps) {
	const theme = useAppTheme();

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.Content title={title} />
				{action}
			</Appbar.Header>
			{children}
			<View
				style={{
					flex: 1,
					alignItems: "center",
					justifyContent: "center",
					gap: space.sm,
					padding: space.xl,
				}}
			>
				<Text
					variant="bodyLarge"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{body}
				</Text>
				{footnote ? (
					<Text
						variant="bodySmall"
						style={{
							color: theme.colors.onSurfaceVariant,
							textAlign: "center",
						}}
					>
						{footnote}
					</Text>
				) : null}
			</View>
		</View>
	);
}
