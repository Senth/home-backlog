import type { ComponentProps } from "react";
import { Snackbar } from "react-native-paper";
import { useOutbox } from "@/contexts/OutboxContext";

export function OutboxSnackbar({
	intentId,
	...props
}: ComponentProps<typeof Snackbar> & { intentId?: string }) {
	const { intents, feedbackVisible } = useOutbox();
	if (
		intentId &&
		(feedbackVisible || !intents.some((intent) => intent.id === intentId))
	)
		return null;
	return <Snackbar {...props} />;
}
