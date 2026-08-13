import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { IconButton, List, Text } from "react-native-paper";
import { ConfirmDialog } from "@/components/ui/AppDialog";
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
	const { t, i18n } = useTranslation();
	const [revoking, setRevoking] = useState<Invite | null>(null);

	if (invites.length === 0) return null;

	const confirmRevoke = () => {
		const invite = revoking;
		setRevoking(null);
		if (!invite) return;

		revokeInvite(invite.homeId, invite.emailHash).catch((reason) => {
			console.error("Could not withdraw the invitation:", reason);
			onError();
		});
	};

	return (
		<View style={{ gap: space.sm }}>
			<Text variant="titleMedium">{t("invite.pendingTitle")}</Text>

			<View>
				{invites.map((invite) => (
					<List.Item
						key={`${invite.homeId}-${invite.emailHash}`}
						title={invite.email}
						// Null until the server acknowledges `serverTimestamp()`, which
						// is a second or two on a fresh invitation — no age is better
						// than "just now" that turns out to be wrong.
						description={
							invite.createdAt
								? formatElapsed(
										invite.createdAt.toDate(),
										new Date(),
										i18n.language,
									)
								: undefined
						}
						style={{ minHeight: touchTarget }}
						left={(props) => <List.Icon {...props} icon="email-outline" />}
						right={() => (
							<IconButton
								icon="close"
								accessibilityLabel={t("invite.revoke")}
								onPress={() => setRevoking(invite)}
								style={{ width: touchTarget, height: touchTarget, margin: 0 }}
							/>
						)}
					/>
				))}
			</View>

			<ConfirmDialog
				visible={revoking !== null}
				onDismiss={() => setRevoking(null)}
				onConfirm={confirmRevoke}
				title={t("invite.revokeTitle")}
				body={t("invite.revokeBody", { email: revoking?.email ?? "" })}
				confirmLabel={t("invite.revoke")}
				destructive
				testID={revokeDialogTestID}
			/>
		</View>
	);
}
