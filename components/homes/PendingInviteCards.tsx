import { useRouter } from "expo-router";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Card, Text } from "react-native-paper";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { useHome } from "@/contexts/HomeContext";
import { acceptInvite, declineInvite } from "@/data/homes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { Invite } from "@/models/home";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

const declineDialogTestID = "decline-invite-dialog";

interface PendingInviteCardsProps {
	invites: readonly Invite[];
	user: User;
	onError: () => void;
}

/**
 * The invitations waiting for you, and the only place they are ever announced.
 *
 * Nothing is delivered to an invitee — no email, no link. They find the
 * invitation here the next time they open the app, and somebody telling them
 * out of band is the notification channel. An invite *link* was designed and
 * dropped: once invitations are findable in-app its only remaining value is a
 * pre-auth "Marcus invited you to Villa Solberg", and buying that costs a
 * `/join` route, display text carried in attacker-controllable query
 * parameters, and pending state that has to survive `signInWithRedirect` — a
 * redirect that eats the URL, lands the invitee on onboarding, and leaves them
 * with a second empty household and no merge path. The trust line survives
 * here, in post-auth form, on the card.
 *
 * Joining cannot be optimistic. `acceptsInvite()` is evaluated on the server, so
 * a queued write would show membership locally and then revert — which is why
 * the button holds its pending state until the new home has actually arrived on
 * the homes listener, and only then carries you into it.
 */
export function PendingInviteCards({
	invites,
	user,
	onError,
}: PendingInviteCardsProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const online = useOnlineStatus();
	const { homes, setActiveHome } = useHome();

	const [joining, setJoining] = useState<string | null>(null);
	const [declining, setDeclining] = useState<Invite | null>(null);

	// Not navigation-as-a-side-effect-of-a-write, but as a consequence of the
	// membership being *visible*: `(tabs)` sends you straight back here if the
	// home is not on the listener yet, and that bounce is what routing on the
	// resolved promise alone would produce.
	useEffect(() => {
		if (joining === null) return;
		if (!homes.some((home) => home.id === joining)) return;

		setActiveHome(joining);
		setJoining(null);
		router.replace("/(app)/(tabs)/projects");
	}, [joining, homes, setActiveHome, router]);

	if (invites.length === 0) return null;

	const join = async (invite: Invite) => {
		setJoining(invite.homeId);
		try {
			await acceptInvite(user, invite);
		} catch (reason) {
			console.error("Could not join the home:", reason);
			setJoining(null);
			onError();
		}
	};

	const confirmDecline = () => {
		const invite = declining;
		setDeclining(null);
		if (!invite) return;

		declineInvite(invite).catch((reason) => {
			console.error("Could not decline the invitation:", reason);
			onError();
		});
	};

	return (
		<View style={{ gap: space.sm }}>
			{invites.map((invite) => {
				const busy = joining === invite.homeId;

				return (
					<Card key={`${invite.homeId}-${invite.emailHash}`} mode="outlined">
						<Card.Content>
							<Text variant="bodyLarge">
								{t("invite.pending", {
									inviter: invite.invitedByName,
									home: invite.homeName,
								})}
							</Text>
							{online ? null : (
								<Text
									variant="bodyMedium"
									style={{
										color: theme.colors.onSurfaceVariant,
										paddingTop: space.xs,
									}}
								>
									{t("invite.offlineHint")}
								</Text>
							)}
						</Card.Content>
						<Card.Actions>
							<Button
								onPress={() => setDeclining(invite)}
								disabled={busy || !online}
								textColor={theme.colors.onSurfaceVariant}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("invite.decline")}
							</Button>
							<Button
								mode="contained"
								onPress={() => join(invite)}
								loading={busy}
								disabled={busy || !online}
								contentStyle={{ minHeight: touchTarget }}
							>
								{busy ? t("invite.joining") : t("invite.join")}
							</Button>
						</Card.Actions>
					</Card>
				);
			})}

			<ConfirmDialog
				visible={declining !== null}
				onDismiss={() => setDeclining(null)}
				onConfirm={confirmDecline}
				title={t("invite.declineTitle")}
				body={t("invite.declineBody", {
					inviter: declining?.invitedByName ?? "",
				})}
				confirmLabel={t("invite.decline")}
				destructive
				testID={declineDialogTestID}
			/>
		</View>
	);
}
