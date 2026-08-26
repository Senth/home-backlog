import type { User } from "firebase/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
	Button,
	HelperText,
	SegmentedButtons,
	Text,
	TextInput,
} from "react-native-paper";
import { CheckRow } from "@/components/ui/CheckRow";
import { sendInvite } from "@/data/homes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
	type Home,
	inviteProblem,
	normalizeEmail,
	type Role,
} from "@/models/home";
import { useAppTheme } from "@/theme";
import { segmentedLabelLineHeight, space, touchTarget } from "@/theme/tokens";

interface InviteFormProps {
	home: Home;
	inviter: User;
	/** Hashes of the addresses this home has already invited. */
	invitedHashes: readonly string[];
	onSent: (email: string) => void;
	onError: () => void;
}

/**
 * Inviting someone by address — the only way anybody is ever added to a home.
 *
 * Nothing is delivered. No email is sent and there is no link; the invitee sees
 * the invitation the next time they open the app, and telling them out of band
 * is the notification channel. That is the honest limit of this feature, so the
 * confirmation says so in as many words rather than implying a message went
 * somewhere.
 *
 * The four validations run against the hashes already on the home document, so
 * "already a member" is answered without any member's address being readable by
 * whoever is holding the phone.
 */
export function InviteForm({
	home,
	inviter,
	invitedHashes,
	onSent,
	onError,
}: InviteFormProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();

	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("member");
	// Off by default: joining a household is a decision about the household, and
	// being handed every project on it is a second one, made deliberately.
	const [addToAllProjects, setAddToAllProjects] = useState(false);
	const [sending, setSending] = useState(false);
	// "That does not look like an email address" is true of every address while
	// it is half typed, so that one message waits until the field is left or the
	// button is pressed. The other three only ever match a complete address, and
	// are worth saying the moment they become true.
	const [settled, setSettled] = useState(false);

	const problem = inviteProblem(email, home, inviter.uid, invitedHashes);
	const shown =
		problem && (problem.key !== "invite.invalidEmail" || settled)
			? problem
			: null;

	const submit = async () => {
		setSettled(true);
		if (problem !== null) return;
		// The button is disabled offline, but Enter in the field reaches here
		// anyway — and `setDoc` would never settle, leaving the form spinning.
		if (!online) return;

		setSending(true);
		try {
			await sendInvite(home, inviter, email, role, addToAllProjects);
			// The stored address is the folded one, so the confirmation must name
			// that and not the casing that happened to be typed.
			onSent(normalizeEmail(email));
			setEmail("");
			setRole("member");
			setAddToAllProjects(false);
			setSettled(false);
		} catch (reason) {
			console.error("Could not send the invitation:", reason);
			onError();
		} finally {
			setSending(false);
		}
	};

	return (
		<View style={{ gap: space.sm }}>
			<Text variant="titleMedium">{t("invite.sendTitle")}</Text>

			<View>
				<TextInput
					mode="outlined"
					label={t("invite.emailLabel")}
					value={email}
					onChangeText={(value) => {
						setEmail(value);
						if (value.trim() === "") setSettled(false);
					}}
					onBlur={() => setSettled(true)}
					onSubmitEditing={submit}
					autoCapitalize="none"
					autoComplete="email"
					keyboardType="email-address"
					error={shown !== null}
				/>
				{shown ? (
					<HelperText type="error" visible>
						{shown.key === "invite.alreadyMember"
							? t(shown.key, { name: shown.name })
							: t(shown.key)}
					</HelperText>
				) : null}
			</View>

			{/* `labelStyle`, not `style`: the segment's pressable is exactly as tall
			    as its label box, so a `minHeight` here would inflate the box and
			    leave the tappable area at 38. See `segmentedLabelLineHeight`. */}
			<SegmentedButtons
				value={role}
				onValueChange={(value) => setRole(value as Role)}
				buttons={[
					{
						value: "member",
						label: t("members.roleMember"),
						labelStyle: { lineHeight: segmentedLabelLineHeight },
					},
					{
						value: "owner",
						label: t("members.roleOwner"),
						labelStyle: { lineHeight: segmentedLabelLineHeight },
					},
				]}
			/>

			<CheckRow
				label={t("members.inviteAllProjects")}
				checked={addToAllProjects}
				onPress={() => setAddToAllProjects(!addToAllProjects)}
			/>

			<Button
				mode="contained"
				icon="email-plus-outline"
				onPress={submit}
				loading={sending}
				// Also while the address is unusable. Leaving it green and inert
				// makes a validation message look like something you may ignore.
				disabled={sending || !online || email.trim() === "" || problem !== null}
				contentStyle={{ minHeight: touchTarget }}
			>
				{t("invite.send")}
			</Button>
			{online ? null : (
				<Text
					variant="bodyMedium"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("invite.sendOfflineHint")}
				</Text>
			)}
		</View>
	);
}
