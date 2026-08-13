import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import {
	Appbar,
	Button,
	Divider,
	HelperText,
	Snackbar,
	Text,
	TextInput,
} from "react-native-paper";
import { InviteForm } from "@/components/homes/InviteForm";
import { PendingInvites } from "@/components/homes/PendingInvites";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { renameHome } from "@/data/homes";
import { useHomeInvites } from "@/hooks/use-home-invites";
import { type HomeNameError, homeNameError } from "@/models/home";
import { useAppTheme } from "@/theme";
import { contentWidth, space, touchTarget } from "@/theme/tokens";

/**
 * Managing one home: its name, its people, and the two ways out of it.
 *
 * Reached from the chevron on `/homes`, never from the row itself — tapping a
 * home switches to it, and everything that cannot be undone lives a level
 * further in rather than beside the thing people tap most often.
 *
 * Any member may rename the home. Only an owner sees the invite form and the
 * pending list; that is not decoration, because listing invitations is only
 * query-safe for an owner, and firing it as a member fails the whole query.
 */
export default function ManageHome() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { homeId } = useLocalSearchParams<{ homeId: string }>();
	const { user } = useAuth();
	const { homes } = useHome();

	const home = homes.find((candidate) => candidate.id === homeId) ?? null;
	const myRole = user && home ? (home.members[user.uid] ?? null) : null;
	const isOwner = myRole === "owner";

	const { invites } = useHomeInvites(home?.id ?? null, isOwner);

	const [name, setName] = useState<string | null>(null);
	const [nameError, setNameError] = useState<HomeNameError | null>(null);
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	// Uncontrolled until the first keystroke, so a rename by somebody else
	// arrives on the listener and shows up here — but never overwrites a field
	// that is being typed in.
	const nameValue = name ?? home?.name ?? "";
	const dirty = name !== null && name !== home?.name;

	const save = async () => {
		const problem = homeNameError(nameValue);
		if (problem !== null || home === null) {
			setNameError(problem);
			return;
		}

		setSaving(true);
		try {
			await renameHome(home.id, nameValue);
			setName(null);
			setNotice("manageHome.saved");
		} catch (reason) {
			console.error("Could not rename the home:", reason);
			setNotice("error.saveFailed");
		} finally {
			setSaving(false);
		}
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.back()}
				/>
				<Appbar.Content title={t("manageHome.title")} />
			</Appbar.Header>

			<ScrollView
				contentContainerStyle={{
					padding: space.md,
					gap: space.lg,
					alignSelf: "center",
					width: "100%",
					maxWidth: contentWidth.form,
				}}
			>
				{home === null ? (
					// Left behind by a home that was deleted, or that you were removed
					// from, while this screen was open.
					<Text
						variant="bodyLarge"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("homes.empty")}
					</Text>
				) : (
					<>
						<View>
							<TextInput
								mode="outlined"
								label={t("homes.nameLabel")}
								value={nameValue}
								onChangeText={(value) => {
									setName(value);
									setNameError(null);
								}}
								onSubmitEditing={save}
								error={nameError !== null}
							/>
							<HelperText type={nameError ? "error" : "info"} visible>
								{nameError ? t(nameError) : t("homes.nameHint")}
							</HelperText>
							<Button
								mode="contained"
								onPress={save}
								loading={saving}
								disabled={saving || !dirty}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("manageHome.save")}
							</Button>
						</View>

						{isOwner && user ? (
							<>
								<Divider />
								<InviteForm
									home={home}
									inviter={user}
									invitedHashes={invites.map((invite) => invite.emailHash)}
									onSent={(email) => setNotice(`sent:${email}`)}
									onError={() => setNotice("error.saveFailed")}
								/>
								<PendingInvites
									invites={invites}
									onError={() => setNotice("error.saveFailed")}
								/>
							</>
						) : null}
					</>
				)}
			</ScrollView>

			<Snackbar
				visible={notice !== null}
				onDismiss={() => setNotice(null)}
				duration={noticeDuration(notice)}
			>
				{noticeText(notice, t)}
			</Snackbar>
		</View>
	);
}

/**
 * "Invitation sent to X. They will see it the next time they open Home Backlog."
 *
 * Two sentences, because the second one is the whole truth of this feature:
 * nothing was delivered anywhere. It is given longer than a default Snackbar
 * would, since it is the only place that sentence is ever said.
 */
function noticeText(
	notice: string | null,
	t: (key: string, options?: Record<string, unknown>) => string,
): string {
	if (notice === null) return "";
	if (!notice.startsWith("sent:")) return t(notice);

	const email = notice.slice("sent:".length);
	return `${t("invite.sent", { email })} ${t("invite.sentBody")}`;
}

const longNoticeMs = 7000;

function noticeDuration(notice: string | null): number | undefined {
	return notice?.startsWith("sent:") ? longNoticeMs : undefined;
}
