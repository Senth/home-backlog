import { waitForPendingWrites } from "firebase/firestore";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform } from "react-native";
import { Snackbar } from "react-native-paper";
import { db } from "@/config/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { isUnavailable } from "@/data/nodes";
import { replayIntent } from "@/data/outbox-replay";
import {
	type OutboxIntent,
	readOutbox,
	updateOutbox,
	withOutboxLock,
} from "@/data/outbox-store";
import { isOnline } from "@/hooks/use-online-status";
import {
	classifyReplayError,
	type ErrorKey,
	enqueue,
	removeIntent,
} from "@/models/outbox";
import { contentWidth } from "@/theme/tokens";

type Refusal = { intent: OutboxIntent; reason: ErrorKey };
type OutboxContextType = {
	intents: OutboxIntent[];
	submit: (
		intent: OutboxIntent,
		runOnline: () => Promise<void>,
	) => Promise<"saved" | "queued">;
	undo: (id: string) => Promise<void>;
};

const OutboxContext = createContext<OutboxContextType | undefined>(undefined);

export function OutboxProvider({ children }: { children: ReactNode }) {
	const { user, loading } = useAuth();
	const uid = user?.uid;
	const { t } = useTranslation();
	const [intents, setIntents] = useState<OutboxIntent[]>([]);
	const [refusals, setRefusals] = useState<Refusal[]>([]);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!uid || loading) return;
		let live = true;
		const publish = (queue: OutboxIntent[]) => {
			if (live) setIntents(queue);
		};
		const drain = async () => {
			if (!live || !isOnline()) return;
			const refused: Refusal[] = [];
			try {
				await withOutboxLock(`outbox:${uid}`, async () => {
					if (!live || !isOnline()) return;
					await waitForPendingWrites(db);
					while (live && isOnline()) {
						const queue = await readOutbox(uid);
						publish(queue);
						const intent = queue[0];
						if (!intent || !live) break;
						try {
							await replayIntent(intent, uid);
						} catch (reason) {
							const outcome = classifyReplayError(reason);
							if (outcome === "retry") break;
							if (outcome !== "drop")
								refused.push({ intent, reason: outcome.refused });
						}
						publish(
							await updateOutbox(uid, (current) =>
								removeIntent(current, intent.id),
							),
						);
					}
				});
			} catch (reason) {
				if (live && classifyReplayError(reason) !== "retry") setFailed(true);
			}
			if (live && refused.length) setRefusals(refused);
		};
		const reconnect = () => {
			void drain();
		};
		void readOutbox(uid)
			.then((queue) => {
				publish(queue);
				reconnect();
			})
			.catch(() => {
				if (live) setFailed(true);
			});
		if (Platform.OS === "web" && typeof window !== "undefined") {
			window.addEventListener("online", reconnect);
			return () => {
				live = false;
				window.removeEventListener("online", reconnect);
			};
		}
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") reconnect();
		});
		return () => {
			live = false;
			subscription.remove();
		};
	}, [uid, loading]);

	const submit = useCallback(
		async (intent: OutboxIntent, runOnline: () => Promise<void>) => {
			if (!uid) throw new Error("Outbox requires a signed-in user");
			if (isOnline()) {
				try {
					await runOnline();
					return "saved" as const;
				} catch (reason) {
					if (!isUnavailable(reason)) throw reason;
				}
			}
			setIntents(await updateOutbox(uid, (queue) => enqueue(queue, intent)));
			return "queued" as const;
		},
		[uid],
	);

	const undo = useCallback(
		async (id: string) => {
			if (!uid) throw new Error("Outbox requires a signed-in user");
			setIntents(await updateOutbox(uid, (queue) => removeIntent(queue, id)));
		},
		[uid],
	);
	const value = useMemo(
		() => ({ intents, submit, undo }),
		[intents, submit, undo],
	);
	const first = refusals[0];
	let message = failed ? t("error.saveFailed") : "";
	if (first) {
		const { intent, reason } = first;
		message =
			intent.targetTitle && reason === "error.moveOwnSubtree"
				? t("outbox.refusedMoveCycle", {
						name: intent.title,
						target: intent.targetTitle,
					})
				: intent.targetTitle && reason === "error.targetGone"
					? t("outbox.refusedTargetGone", {
							name: intent.title,
							target: intent.targetTitle,
						})
					: t("outbox.refusedOther", { name: intent.title, reason: t(reason) });
		if (refusals.length > 1)
			message += ` ${t("outbox.andMore", { count: refusals.length - 1 })}`;
	}

	return (
		<OutboxContext.Provider value={value}>
			{children}
			<Snackbar
				visible={Boolean(first) || failed}
				onDismiss={() => {
					setRefusals([]);
					setFailed(false);
				}}
				style={{ maxWidth: contentWidth.snackbar, alignSelf: "center" }}
			>
				{message}
			</Snackbar>
		</OutboxContext.Provider>
	);
}

export function useOutbox() {
	const context = useContext(OutboxContext);
	if (context === undefined)
		throw new Error("useOutbox must be used within an OutboxProvider");
	return context;
}
