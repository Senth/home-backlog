import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
	Appbar,
	Button,
	Divider,
	HelperText,
	Icon,
	List,
	Snackbar,
	Text,
	TextInput,
} from "react-native-paper";
import { AutomationsList } from "@/components/homes/AutomationsList";
import { DangerZone } from "@/components/homes/DangerZone";
import { InviteForm } from "@/components/homes/InviteForm";
import { MembersList } from "@/components/homes/MembersList";
import { PendingInvites } from "@/components/homes/PendingInvites";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import { BackAction } from "@/components/ui/BackAction";
import { SlimScrollView } from "@/components/ui/SlimScrollView";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { renameHome } from "@/data/homes";
import { useHomeInvites } from "@/hooks/use-home-invites";
import {
	formatBytes,
	homeAttachmentCeiling,
	quotaShare,
	quotaWarning,
} from "@/models/attachment";
import { type HomeNameError, homeNameError } from "@/models/home";
import { useAppTheme } from "@/theme";
import { contentWidth, icon, space, touchTarget } from "@/theme/tokens";

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
	const { t, i18n } = useTranslation();
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
	const [notice, setNotice] = useState<string | null>(null);

	// Uncontrolled until the first keystroke, so a rename by somebody else
	// arrives on the listener and shows up here — but never overwrites a field
	// that is being typed in.
	const nameValue = name ?? home?.name ?? "";
	const dirty = name !== null && name !== home?.name;

	/**
	 * Renaming queues like any other edit, so this does **not** wait on the
	 * write. Firestore applies it locally at once and the listener already shows
	 * the new name; awaiting the server would leave the button spinning for the
	 * whole time somebody is offline, over a change that has visibly happened.
	 */
	const save = () => {
		const problem = homeNameError(nameValue);
		if (problem !== null || home === null) {
			setNameError(problem);
			return;
		}

		renameHome(home.id, nameValue, isOwner).catch((reason) => {
			console.error("Could not rename the home:", reason);
			setNotice("error.saveFailed");
		});
		setName(null);
		setNotice("manageHome.saved");
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				{/* Up to "My homes", never `router.back()`. This screen is reachable
				    with no in-app history — a reload, a bookmark, a pasted URL — and
				    there `back()` is a no-op that logs "GO_BACK was not handled by
				    any navigator" and leaves the arrow dead. The destination is the
				    same either way, so name it. */}
				<BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.replace("/homes")}
				/>
				<Appbar.Content title={t("manageHome.title")} />
			</Appbar.Header>

			<SlimScrollView
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
								disabled={!dirty}
								contentStyle={{ minHeight: touchTarget }}
							>
								{t("manageHome.save")}
							</Button>
						</View>

						{user ? (
							<MembersList
								home={home}
								myUid={user.uid}
								canManage={isOwner}
								onError={() => setNotice("error.saveFailed")}
							/>
						) : null}

						{/* The way in to the label set (#100). The glyphs *are* the
						    description — the set is read before the row is, and the
						    count names what a tap opens. Every member curates, so it
						    sits with the sections rather than behind the owner's. */}
						<Divider />
						<List.Item
							title={t("labels.title")}
							description={
								<View style={{ gap: space.xs }}>
									{home.labels.length > 0 ? (
										<View
											style={{
												flexDirection: "row",
												flexWrap: "wrap",
												gap: space.xs,
											}}
										>
											{home.labels.map((label) => (
												<LabelGlyph
													key={label.id}
													color={label.color}
													icon={label.icon}
												/>
											))}
										</View>
									) : null}
									<Text
										variant="bodyMedium"
										style={{ color: theme.colors.onSurfaceVariant }}
									>
										{home.labels.length > 0
											? t("labels.count", { count: home.labels.length })
											: t("labels.empty")}
									</Text>
								</View>
							}
							right={() => (
								<Icon
									source="chevron-right"
									size={icon.md}
									color={theme.colors.onSurfaceVariant}
								/>
							)}
							onPress={() => router.push(`/homes/${home.id}/labels`)}
						/>

						{/* The way in to the attachment inventory (#298). It lives
						    beside the labels row: same kind of row, same kind of
						    thing-a-home-owns. The warning rides here too, and only
						    here and on the inventory — a meter that nags below nine
						    tenths is a meter people stop reading. */}
						<Divider />
						<List.Item
							title={t("detail.attachments")}
							description={
								<View style={{ gap: space.xs }}>
									<Text
										variant="bodyMedium"
										style={{ color: theme.colors.onSurfaceVariant }}
									>
										{t("homes.attachmentsUsage", {
											used: formatBytes(home.attachmentBytes, i18n.language),
											total: formatBytes(homeAttachmentCeiling, i18n.language),
										})}
									</Text>
									{quotaWarning(home.attachmentBytes) ? (
										<Text
											variant="bodyMedium"
											style={{ color: theme.colors.warning }}
										>
											{t("homes.attachmentsAlmostFull", {
												percent: Math.round(
													quotaShare(home.attachmentBytes) * 100,
												),
											})}
										</Text>
									) : null}
								</View>
							}
							right={() => (
								<Icon
									source="chevron-right"
									size={icon.md}
									color={theme.colors.onSurfaceVariant}
								/>
							)}
							onPress={() => router.push(`/homes/${home.id}/attachments`)}
						/>

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

						{/* Above the Danger zone, because it is information rather than
						    an action — and because the one thing a member *can* do about
						    an automation somebody else owns is go and ask them. */}
						<Divider />
						<AutomationsList homeId={home.id} />

						{user ? (
							<>
								<Divider />
								<DangerZone
									home={home}
									myUid={user.uid}
									onError={() => setNotice("error.saveFailed")}
								/>
							</>
						) : null}
					</>
				)}
			</SlimScrollView>

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
