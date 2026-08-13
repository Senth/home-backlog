import { useRouter } from "expo-router";
import type { User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ActivityIndicator, Button, Card, Text } from "react-native-paper";
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
	/** The home id a Join is waiting on, owned by the screen — see below. */
	joining: string | null;
	onJoining: (homeId: string | null) => void;
	onError: (key: string) => void;
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
 * a queued write would show membership locally and then revert — so the *screen*
 * holds the pending state until the new home has actually arrived on the homes
 * listener, and only then carries you into it.
 *
 * It has to be the screen and not this component: accepting deletes the
 * invitation, that delete applies locally at once, and a component that
 * unmounted with the last invitation would take the waiting effect with it. For
 * the same reason the invitation being joined is gone from `invites` while the
 * write is still in flight, which is what the standalone waiting card is for.
 */
export function PendingInviteCards({
	invites,
	user,
	joining,
	onJoining,
	onError,
}: PendingInviteCardsProps) {
	const { t } = useTranslation();
	const router = useRouter();
	const { homes, setActiveHome } = useHome();

	// Not navigation as a side effect of a write, but as a consequence of the
	// membership being *visible*: `(tabs)` sends you straight back here while the
	// home is not on the listener yet, and that bounce is what routing on the
	// resolved promise alone would produce.
	useEffect(() => {
		if (joining === null) return;
		if (!homes.some((home) => home.id === joining)) return;

		setActiveHome(joining);
		onJoining(null);
		router.replace("/(app)/(tabs)/projects");
	}, [joining, homes, setActiveHome, onJoining, router]);

	const join = async (invite: Invite) => {
		onJoining(invite.homeId);
		try {
			await acceptInvite(user, invite);
		} catch (reason) {
			console.error("Could not join the home:", reason);
			onJoining(null);
			onError("invite.failed");
		}
	};

	const waitingAlone =
		joining !== null && !invites.some((invite) => invite.homeId === joining);

	return (
		<View style={{ gap: space.sm }}>
			{invites.map((invite) => (
				<PendingInviteCard
					key={`${invite.homeId}-${invite.emailHash}`}
					invite={invite}
					busy={joining === invite.homeId}
					onJoin={() => join(invite)}
					onError={onError}
				/>
			))}

			{/* The invitation is already deleted locally while the membership write
			    is still on its way back, so without this the section would go blank
			    for the length of a round-trip and then simply navigate. */}
			{waitingAlone ? (
				<Card mode="outlined">
					<Card.Content
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space.md,
						}}
					>
						<ActivityIndicator accessibilityLabel={t("invite.joining")} />
						<Text variant="bodyLarge">{t("invite.joining")}</Text>
					</Card.Content>
				</Card>
			) : null}
		</View>
	);
}

/**
 * One invitation, owning its own decline dialog and anchor ref — a ref beside
 * the `.map()` would hold whichever card rendered last.
 */
function PendingInviteCard({
	invite,
	busy,
	onJoin,
	onError,
}: {
	invite: Invite;
	busy: boolean;
	onJoin: () => void;
	onError: (key: string) => void;
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();
	const [confirming, setConfirming] = useState(false);
	const declineRef = useRef<View | null>(null);

	const confirmDecline = () => {
		setConfirming(false);
		declineInvite(invite).catch((reason) => {
			// Not `invite.failed` — "Could not join" is the wrong sentence for an
			// invitation the person was trying to get rid of.
			console.error("Could not decline the invitation:", reason);
			onError("error.saveFailed");
		});
	};

	return (
		<Card mode="outlined">
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
					ref={declineRef}
					onPress={() => setConfirming(true)}
					disabled={busy || !online}
					textColor={theme.colors.onSurfaceVariant}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("invite.decline")}
				</Button>
				<Button
					mode="contained"
					onPress={onJoin}
					loading={busy}
					disabled={busy || !online}
					contentStyle={{ minHeight: touchTarget }}
				>
					{busy ? t("invite.joining") : t("invite.join")}
				</Button>
			</Card.Actions>

			<ConfirmDialog
				visible={confirming}
				onDismiss={() => setConfirming(false)}
				onConfirm={confirmDecline}
				title={t("invite.declineTitle")}
				body={t("invite.declineBody", { inviter: invite.invitedByName })}
				confirmLabel={t("invite.decline")}
				destructive
				testID={`${declineDialogTestID}-${invite.emailHash}`}
				returnFocusTo={declineRef}
			/>
		</Card>
	);
}
