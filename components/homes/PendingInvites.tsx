import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { IconButton, Text } from "react-native-paper";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { Row } from "@/components/ui/Row";
import { revokeInvite } from "@/data/homes";
import type { Invite } from "@/models/home";
import { formatElapsed } from "@/models/relative-time";
import { space, touchTarget } from "@/theme/tokens";

const revokeDialogTestID = "revoke-invite-dialog";

interface PendingInvitesProps {
	invites: readonly Invite[];
	onError: () => void;
}

/**
 * What an owner has sent and nobody has answered yet.
 *
 * The address is shown in plaintext, which the *members* list deliberately never
 * does. An owner typed this one, and a bare hash would make a typo invisible on
 * both ends — the invitation would simply never appear for anyone, with nothing
 * on screen to explain it and no way to withdraw the wrong one by name. The
 * plaintext disappears with the invite the moment it is consumed.
 */
export function PendingInvites({ invites, onError }: PendingInvitesProps) {
	const { t } = useTranslation();

	if (invites.length === 0) return null;

	return (
		<View style={{ gap: space.sm }}>
			<Text variant="titleMedium">{t("invite.pendingTitle")}</Text>
			<View>
				{invites.map((invite) => (
					<PendingInviteRow
						key={`${invite.homeId}-${invite.emailHash}`}
						invite={invite}
						onError={onError}
					/>
				))}
			</View>
		</View>
	);
}

/**
 * One row, owning its own dialog and its own anchor ref.
 *
 * A component per row rather than a ref beside the `.map()`: one ref shared
 * across the list holds whichever row rendered last, so withdrawing the first
 * invitation would return focus to the last row's button — worse than the
 * fallback it overrides.
 */
function PendingInviteRow({
	invite,
	onError,
}: {
	invite: Invite;
	onError: () => void;
}) {
	const { t, i18n } = useTranslation();
	const [confirming, setConfirming] = useState(false);
	const anchorRef = useRef<View | null>(null);

	const confirmRevoke = () => {
		setConfirming(false);
		revokeInvite(invite.homeId, invite.emailHash).catch((reason) => {
			console.error("Could not withdraw the invitation:", reason);
			onError();
		});
	};

	return (
		<>
			<Row
				title={invite.email}
				// Null until the server acknowledges `serverTimestamp()`, which is a
				// second or two on a fresh invitation — no age is better than a
				// "just now" that turns out to be wrong.
				description={
					invite.createdAt
						? formatElapsed(
								invite.createdAt.toDate(),
								new Date(),
								i18n.language,
							)
						: undefined
				}
				right={
					<IconButton
						ref={anchorRef}
						icon="close"
						accessibilityLabel={t("invite.revokeFor", { email: invite.email })}
						onPress={() => setConfirming(true)}
						style={{
							width: touchTarget,
							height: touchTarget,
							margin: space.none,
						}}
					/>
				}
			/>

			<ConfirmDialog
				visible={confirming}
				onDismiss={() => setConfirming(false)}
				onConfirm={confirmRevoke}
				title={t("invite.revokeTitle")}
				body={t("invite.revokeBody", { email: invite.email })}
				confirmLabel={t("invite.revoke")}
				destructive
				testID={`${revokeDialogTestID}-${invite.emailHash}`}
				returnFocusTo={anchorRef}
			/>
		</>
	);
}
