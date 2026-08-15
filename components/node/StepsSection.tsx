import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ActivityIndicator, Button, Divider, Text } from "react-native-paper";
import { TitleDialog } from "@/components/board/TitleDialog";
import { Row } from "@/components/ui/Row";
import { useAuth } from "@/contexts/AuthContext";
import { createNode } from "@/data/nodes";
import { useNodes } from "@/hooks/use-nodes";
import { type Node, rankAtEnd } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

interface StepsSectionProps {
	homeId: string;
	/** The card these are the steps of. */
	node: Node;
	onOpenBoard: () => void;
}

/**
 * What is under this card, and the one way to add to it.
 *
 * It runs the **real board queries** — `useNodes` with this node as the parent,
 * the same two listeners and the same index a board load uses — rather than
 * reading `childCount`. That is what closes the one direction of counter drift
 * that could hide work: a card whose counter has gone low shows no chevron, but
 * its details still list every step it really has, with *Open board*.
 *
 * The list is deliberately read-only beyond adding. Reordering, moving between
 * columns, renaming and deleting all stay on the board, so there is one place
 * that does the complicated things.
 *
 * A household never meets the word "board" until it has made one, so this is
 * *Steps* and the button is *Add step*; *Open board* appears only once a step
 * exists.
 */
export function StepsSection({ homeId, node, onOpenBoard }: StepsSectionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { user } = useAuth();

	const [adding, setAdding] = useState(false);

	const { nodes: steps, loading } = useNodes(homeId, node.id);
	const done = steps.filter((step) => step.status === "done").length;

	/**
	 * Queued, never awaited, and it **stays on this screen** — somebody typing
	 * three steps in a row should not have the screen move under them.
	 *
	 * The status is the first of this node's frozen columns, which is what the
	 * board's own add row would have used, and the rank is the end of it.
	 */
	const add = (title: string) => {
		if (user === null) return;

		const status = node.columns[0];
		const last = steps.filter((step) => step.status === status).at(-1);

		createNode(homeId, user.uid, {
			title,
			rank: rankAtEnd(last?.rank ?? null),
			parent: node,
			status,
		});
	};

	return (
		<View style={{ gap: space.sm }}>
			<Text
				variant="labelLarge"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{t("detail.steps")}
			</Text>

			{loading ? (
				<ActivityIndicator accessibilityLabel={t("common.loading")} />
			) : (
				<Text variant="bodyMedium">
					{steps.length === 0
						? t("detail.stepsNone")
						: t("detail.stepsDone", { done, total: steps.length })}
				</Text>
			)}

			{steps.length === 0 ? null : (
				<View>
					{steps.map((step) => (
						<View key={step.id}>
							<Divider />
							<Row
								title={step.title}
								description={t(`status.${step.status}`)}
							/>
						</View>
					))}
					<Divider />
				</View>
			)}

			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
				<Button
					mode="contained-tonal"
					icon="plus"
					onPress={() => setAdding(true)}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("detail.addStep")}
				</Button>
				{/* Only once there is something to open. Until then this card is not a
				    board, and offering to open one is offering an empty screen. */}
				{steps.length === 0 ? null : (
					<Button
						icon="view-column-outline"
						onPress={onOpenBoard}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("detail.openBoard")}
					</Button>
				)}
			</View>

			{adding ? (
				<TitleDialog
					visible
					onDismiss={() => setAdding(false)}
					heading={t("detail.addStep")}
					confirmLabel={t("board.add")}
					onSubmit={add}
					testID={`add-step-${node.id}`}
				/>
			) : null}
		</View>
	);
}
