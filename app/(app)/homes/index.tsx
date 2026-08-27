import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import {
	Appbar,
	Button,
	Divider,
	HelperText,
	IconButton,
	List,
	Snackbar,
	Text,
	TextInput,
} from "react-native-paper";
import { displayLabel } from "@/auth/display-name";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { PendingInviteCards } from "@/components/homes/PendingInviteCards";
import { AppDialog } from "@/components/ui/AppDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { createHome } from "@/data/homes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { usePendingInvites } from "@/hooks/use-pending-invites";
import { type HomeNameError, homeNameError } from "@/models/home";
import { useAppTheme } from "@/theme";
import { contentWidth, space, touchTarget } from "@/theme/tokens";

const createDialogTestID = "create-home-dialog";

/**
 * "My homes" — a level of navigation, not a menu.
 *
 * Switching home is going up and picking another one, which is why this is a
 * real route above the boards rather than a row in the account menu. A menu
 * leaves the active home invisible until tapped; here the app bar says where
 * you are on every screen, and the destructive actions stay two levels away
 * from the row people tap most often.
 *
 * With no homes and no invitations this same screen *is* onboarding: one
 * prefilled field and one button, no wizard and no choice screen.
 */
export default function Homes() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const online = useOnlineStatus();
	const { user } = useAuth();
	const { homes, activeHome, failed, retry, retrying, setActiveHome } =
		useHome();
	const { invites } = usePendingInvites();

	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [nameError, setNameError] = useState<HomeNameError | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const createButtonRef = useRef<View | null>(null);
	/**
	 * Which home a Join is waiting on, held *here* rather than inside the cards.
	 *
	 * Accepting deletes the invitation, and that delete applies locally the
	 * instant it is issued — so the invites list empties before the new home has
	 * arrived on the homes listener, which needs a server round-trip. If the
	 * cards owned this state, the section would unmount and take with it the very
	 * effect that waits for the home, stranding the invitee on this screen with
	 * no spinner and no explanation.
	 */
	const [joining, setJoining] = useState<string | null>(null);

	const closeCreate = useCallback(() => setCreateOpen(false), []);

	const openCreate = () => {
		// Prefilled, so the fastest path through onboarding is one tap. It is a
		// suggestion and not a decision — the field is focused and selectable.
		setName(t("homes.defaultName", { name: displayLabel(user) }));
		setNameError(null);
		setCreateOpen(true);
	};

	const openHome = (homeId: string) => {
		setActiveHome(homeId);
		router.replace("/(app)/(tabs)/overview");
	};

	const submitCreate = async () => {
		const problem = homeNameError(name);
		if (problem !== null || user === null) {
			setNameError(problem);
			return;
		}
		// The button is disabled offline, but Enter in the field reaches here
		// anyway — and the write below would then never settle, leaving the
		// dialog spinning with nothing to say.
		if (!online) return;

		setSaving(true);
		try {
			// Not optimistic: the id the app has to switch to is the one Firestore
			// hands back, and offline this promise would never settle — which is
			// why the button is disabled with a reason rather than left to hang.
			const homeId = await createHome(user, name);
			setCreateOpen(false);
			openHome(homeId);
		} catch (reason) {
			console.error("Could not create the home:", reason);
			setError("error.saveFailed");
		} finally {
			setSaving(false);
		}
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.Content title={t("homes.title")} />
				{/* The only way out of the app when you are in no home at all: this
				    screen is where the gate sends you, and the boards are unreachable
				    until a home exists. */}
				<AccountMenu />
			</Appbar.Header>

			<ScrollView
				contentContainerStyle={{
					padding: space.md,
					gap: space.md,
					alignSelf: "center",
					width: "100%",
					maxWidth: contentWidth.form,
				}}
			>
				{/* Said instead of the empty state, and instead of the create button
				    below: this screen's empty state *is* onboarding, and offering to
				    set up a first home to somebody who has had one for a year is the
				    app believing a broken connection. With homes already in hand it
				    explains why they may be stale. `retry` is the way back that used
				    to mean force quitting. */}
				{failed ? (
					<View style={{ gap: space.md, paddingVertical: space.lg }}>
						<Text
							variant="bodyLarge"
							style={{
								color: theme.colors.onSurfaceVariant,
								textAlign: "center",
							}}
						>
							{t("homes.loadFailed")}
						</Text>
						<Button
							mode="contained-tonal"
							icon="refresh"
							onPress={retry}
							loading={retrying}
							disabled={retrying}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("common.retry")}
						</Button>
					</View>
				) : null}

				{homes.length === 0 ? (
					failed ? null : (
						<Text
							variant="bodyLarge"
							style={{
								color: theme.colors.onSurfaceVariant,
								textAlign: "center",
								paddingVertical: space.lg,
							}}
						>
							{t("homes.empty")}
						</Text>
					)
				) : (
					<List.Section>
						{homes.map((home) => (
							<List.Item
								key={home.id}
								title={home.name}
								description={t("homes.memberCount", {
									count: Object.keys(home.members).length,
								})}
								onPress={() => openHome(home.id)}
								style={{ minHeight: touchTarget }}
								left={(props) => <List.Icon {...props} icon="home-outline" />}
								right={(props) => (
									<View style={{ flexDirection: "row", alignItems: "center" }}>
										{home.id === activeHome?.id ? (
											// `accessible` alone renders a bare `div` carrying an
											// `aria-label`, which ARIA forbids on an element with no
											// role — axe reports `aria-prohibited-attr` and a screen
											// reader may ignore the label entirely. The check mark is
											// the only thing marking the current home, so the label
											// has to survive: giving the wrapper an image role is what
											// makes the attribute legal on it.
											<View
												accessible
												accessibilityRole="image"
												accessibilityLabel={t("homes.current")}
											>
												<List.Icon
													{...props}
													icon="check"
													color={theme.colors.primary}
												/>
											</View>
										) : null}
										<IconButton
											icon="chevron-right"
											accessibilityLabel={t("manageHome.manageNamed", {
												home: home.name,
											})}
											onPress={() => router.push(`/homes/${home.id}`)}
											style={{
												width: touchTarget,
												height: touchTarget,
												margin: space.none,
											}}
										/>
									</View>
								)}
							/>
						))}
					</List.Section>
				)}

				{/* `joining` keeps this mounted after the invitation is consumed —
				    see the state's own comment. */}
				{user && (invites.length > 0 || joining !== null) ? (
					<>
						<Divider />
						<PendingInviteCards
							invites={invites}
							user={user}
							joining={joining}
							onJoining={setJoining}
							onError={setError}
						/>
					</>
				) : null}

				{/* Gone while the load is failed, not merely unaccompanied by the
				    empty state. "Could not load your homes" above "Create a new home"
				    is still the app inviting a second home from somebody who already
				    has one — and a load that failed is a connection that would not
				    carry `createHome` either. Try again is the way forward here. */}
				{failed ? null : (
					<>
						<Divider />

						<Button
							ref={createButtonRef}
							mode="contained"
							icon="plus"
							onPress={openCreate}
							disabled={!online}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("homes.create")}
						</Button>
						{online ? null : (
							<Text
								variant="bodyMedium"
								style={{
									color: theme.colors.onSurfaceVariant,
									textAlign: "center",
								}}
							>
								{t("homes.offlineHint")}
							</Text>
						)}
					</>
				)}
			</ScrollView>

			<AppDialog
				visible={createOpen}
				onDismiss={closeCreate}
				title={t("homes.create")}
				testID={createDialogTestID}
				returnFocusTo={createButtonRef}
				actions={[
					<Button
						key="cancel"
						onPress={closeCreate}
						textColor={theme.colors.onSurfaceVariant}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("common.cancel")}
					</Button>,
					<Button
						key="create"
						onPress={submitCreate}
						loading={saving}
						disabled={saving}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("homes.createAction")}
					</Button>,
				]}
			>
				<TextInput
					mode="outlined"
					label={t("homes.nameLabel")}
					value={name}
					onChangeText={(value) => {
						setName(value);
						setNameError(null);
					}}
					onSubmitEditing={submitCreate}
					autoFocus
					selectTextOnFocus
					error={nameError !== null}
				/>
				<HelperText type={nameError ? "error" : "info"} visible>
					{nameError ? t(nameError) : t("homes.nameHint")}
				</HelperText>
			</AppDialog>

			<Snackbar visible={error !== null} onDismiss={() => setError(null)}>
				{error ? t(error) : ""}
			</Snackbar>
		</View>
	);
}
