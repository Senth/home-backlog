import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Text } from "react-native-paper";
import { AppDialog } from "@/components/ui/AppDialog";
import { type FlipProgress, flipVisibility } from "@/data/nodes";
import type { Node, Visibility } from "@/models/node";
import { useAppTheme } from "@/theme";
import { touchTarget } from "@/theme/tokens";

const progressTestID = "visibility-progress-dialog";

interface Flip {
	node: Node;
	target: Visibility;
	/**
	 * What the root's participants become. Omitted by the visibility control,
	 * which changes only the visibility; given by the participants control on an
	 * already-private project, which changes only the list.
	 */
	participantIds?: readonly string[];
	title: string;
}

/**
 * Running a top-down subtree write, and holding the screen while it goes out.
 *
 * Two callers, and they are the same operation wearing different labels: making
 * a project private or shared, and changing who is in on one that is *already*
 * private — because there the participants list is the ACL, and the rules
 * require every descendant to carry all of its parent's participants. A plain
 * update on that path would hand somebody a project whose steps they still
 * could not read, and an empty board is the worst possible answer to "you have
 * been let in".
 *
 * `flipVisibility` cannot be a batch — a rule's `get()` reads committed state,
 * so a child written ahead of its parent fails inheritance — so this is *n*
 * sequential server-checked writes, and everything below follows from that:
 *
 * - **the dialog cannot be dismissed while writing.** Letting somebody walk
 *   away mid-flip is how a mixed subtree gets abandoned;
 * - **failure offers *Try again*, which re-reads and finishes**, because
 *   `flipVisibility` drops every document already at the target;
 * - **walking away from a failure is survivable**: cards keep the old
 *   visibility, degraded and honest, and `subtreeOf()`'s union means they can
 *   never orphan.
 *
 * The caller disables its own control offline rather than letting this fail
 * after the fact.
 */
export function useFlip(homeId: string) {
	const [flip, setFlip] = useState<Flip | null>(null);
	const [progress, setProgress] = useState<FlipProgress | null>(null);
	const [failed, setFailed] = useState(false);

	const start = async (next: Flip, uid: string) => {
		setFlip(next);
		setFailed(false);
		setProgress({ done: 0, total: 0 });

		try {
			await flipVisibility(homeId, next.node, next.target, uid, {
				participantIds: next.participantIds,
				onProgress: setProgress,
			});
			setFlip(null);
			setProgress(null);
		} catch (reason) {
			console.error("Could not change who can see this project:", reason);
			setFailed(true);
		}
	};

	return {
		flip,
		progress,
		failed,
		/** Begin, or begin again after a failure — the retry re-reads the subtree. */
		run: (next: Flip, uid: string) => {
			void start(next, uid);
		},
		close: () => {
			setFlip(null);
			setProgress(null);
			setFailed(false);
		},
	};
}

export type FlipState = ReturnType<typeof useFlip>;

/** What `useFlip` puts on the screen. Renders nothing until a flip is running. */
export function FlipDialog({ state, uid }: { state: FlipState; uid: string }) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const { flip, progress, failed, run, close } = state;
	if (flip === null || progress === null) return null;

	return (
		<AppDialog
			visible
			// Not dismissable while the writes are going out. Once it has failed
			// there is something to decide, so the actions arrive.
			onDismiss={failed ? close : noop}
			title={flip.title}
			testID={progressTestID}
			actions={
				failed
					? [
							<Button
								key="close"
								onPress={close}
								textColor={theme.colors.onSurfaceVariant}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("common.dismiss")}
							</Button>,
							<Button
								key="retry"
								onPress={() => run(flip, uid)}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("visibility.retry")}
							</Button>,
						]
					: []
			}
		>
			<Text variant="bodyMedium">
				{t(failed ? "visibility.failed" : "visibility.progress", {
					done: progress.done,
					total: progress.total,
				})}
			</Text>
		</AppDialog>
	);
}

function noop() {}
