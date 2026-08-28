import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Button,
	Divider,
	HelperText,
	IconButton,
	Snackbar,
	Text,
	TextInput,
} from "react-native-paper";
import { AppDialog, ConfirmDialog } from "@/components/ui/AppDialog";
import { BackAction } from "@/components/ui/BackAction";
import { Row } from "@/components/ui/Row";
import { useAuth } from "@/contexts/AuthContext";
import { createApiKey, revokeApiKey } from "@/data/api-keys";
import { useApiKeys } from "@/hooks/use-api-keys";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { type ApiKey, type KeyNameError, keyNameError } from "@/models/api-key";
import { formatElapsed } from "@/models/relative-time";
import { useAppTheme } from "@/theme";
import { contentWidth, radius, space, touchTarget } from "@/theme/tokens";

const createDialogTestID = "create-api-key-dialog";
const secretDialogTestID = "api-key-secret-dialog";
const revokeDialogTestID = "revoke-api-key-dialog";

/**
 * The keys a person has given to their own programs.
 *
 * Outside the tabs, like `/homes/[homeId]`, so it gets a back arrow rather than
 * a permanent place in the tab bar — most households will visit this screen
 * once, or never. It is reached from the account menu, because a key is **the
 * person** rather than the home: one credential reaches every home its owner is
 * a member of, and gains a new one the moment they join it. A per-home screen
 * would say the opposite.
 *
 * Both actions here need the server, so both are disabled offline with a reason
 * — the same pattern creating a home and sending an invitation use. Queuing a
 * revoke optimistically would show a key as gone while it kept working, which is
 * a lie on the one screen where it matters.
 */
export default function Automations() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const online = useOnlineStatus();
	const { user } = useAuth();
	const { keys, loading } = useApiKeys(user?.uid ?? null);

	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [nameError, setNameError] = useState<KeyNameError | null>(null);
	const [saving, setSaving] = useState(false);
	const [token, setToken] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const createButtonRef = useRef<View | null>(null);

	const closeCreate = useCallback(() => setCreateOpen(false), []);

	const openCreate = () => {
		setName("");
		setNameError(null);
		setCreateOpen(true);
	};

	const submitCreate = async () => {
		const problem = keyNameError(name);
		if (problem !== null) {
			setNameError(problem);
			return;
		}
		// The action is disabled offline, but Enter in the field reaches here
		// anyway — and the call below would then hang with nothing to say.
		if (!online) return;

		setSaving(true);
		try {
			const minted = await createApiKey(name);
			setCreateOpen(false);
			// The one and only time this string exists anywhere but the caller's
			// machine. Only its SHA-256 is stored.
			setToken(minted.token);
		} catch (reason) {
			console.error("Could not create the API key:", reason);
			setNotice("error.saveFailed");
		} finally {
			setSaving(false);
		}
	};

	const copyToken = async () => {
		if (token === null) return;
		try {
			await Clipboard.setStringAsync(token);
			setNotice("automations.copied");
		} catch (reason) {
			// The token is on screen and selectable, so a clipboard a browser
			// refuses is an inconvenience rather than a dead end.
			console.error("Could not copy the API key:", reason);
		}
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				{/* Named rather than `router.back()`: this screen is reachable with no
				    in-app history — a reload, a bookmark, a pasted URL — and there
				    `back()` is a no-op that leaves the arrow dead. */}
				<BackAction
					accessibilityLabel={t("tab.projects")}
					onPress={() =>
						router.canGoBack()
							? router.back()
							: router.replace("/(app)/(tabs)/projects")
					}
				/>
				<Appbar.Content title={t("automations.title")} />
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
				<Text
					variant="bodyMedium"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("automations.intro")}
				</Text>

				<Divider />

				{loading ? (
					// "Nothing is connected yet." is a *fact*, and it must not be said
					// while the answer is still arriving — somebody with three keys
					// would read it on every cold open.
					<ActivityIndicator
						accessibilityLabel={t("common.loading")}
						style={{ marginTop: space.lg }}
					/>
				) : keys.length === 0 ? (
					<Text
						variant="bodyLarge"
						style={{
							color: theme.colors.onSurfaceVariant,
							textAlign: "center",
							paddingVertical: space.lg,
						}}
					>
						{t("automations.empty")}
					</Text>
				) : (
					<View>
						{keys.map((key) => (
							<ApiKeyRow
								key={key.id}
								apiKey={key}
								uid={user?.uid ?? null}
								online={online}
								onError={() => setNotice("error.saveFailed")}
							/>
						))}
					</View>
				)}

				<Divider />

				<Button
					ref={createButtonRef}
					mode="contained"
					icon="plus"
					onPress={openCreate}
					disabled={!online}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("automations.create")}
				</Button>
				{online ? null : (
					<Text
						variant="bodyMedium"
						style={{
							color: theme.colors.onSurfaceVariant,
							textAlign: "center",
						}}
					>
						{t("automations.offlineHint")}
					</Text>
				)}
			</ScrollView>

			{/* The name is required *before* the secret is revealed, because a key
			    named later is a key never named — and an unnamed key is one nobody
			    dares revoke. */}
			<AppDialog
				visible={createOpen}
				onDismiss={closeCreate}
				title={t("automations.create")}
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
						disabled={saving || name.trim().length === 0}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("automations.createAction")}
					</Button>,
				]}
			>
				<TextInput
					mode="outlined"
					label={t("automations.nameLabel")}
					value={name}
					onChangeText={(value) => {
						setName(value);
						setNameError(null);
					}}
					onSubmitEditing={submitCreate}
					autoFocus
					error={nameError !== null}
				/>
				<HelperText type={nameError ? "error" : "info"} visible>
					{nameError ? t(nameError) : t("automations.nameHint")}
				</HelperText>
			</AppDialog>

			{/* Dismissing is the only way out: there is no "show again", because
			    there is nothing to show again. Only the hash is stored. */}
			<AppDialog
				visible={token !== null}
				onDismiss={() => setToken(null)}
				title={t("automations.secret.title")}
				testID={secretDialogTestID}
				returnFocusTo={createButtonRef}
				actions={[
					<Button
						key="copy"
						icon="content-copy"
						onPress={copyToken}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("automations.copy")}
					</Button>,
					<Button
						key="done"
						mode="contained"
						onPress={() => setToken(null)}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("common.done")}
					</Button>,
				]}
			>
				<View style={{ gap: space.md }}>
					<Text variant="bodyMedium">{t("automations.secret.body")}</Text>
					{/* Selectable, so a browser that refuses the clipboard is an
					    inconvenience rather than a lost key. `bodySmall` because the
					    token is 80-odd characters and wrapping it is the point. */}
					<Text
						variant="bodySmall"
						selectable
						accessibilityLabel={t("automations.secret.title")}
						style={{
							backgroundColor: theme.colors.surfaceVariant,
							color: theme.colors.onSurfaceVariant,
							padding: space.md,
							borderRadius: radius.sm,
						}}
					>
						{token ?? ""}
					</Text>
				</View>
			</AppDialog>

			<Snackbar visible={notice !== null} onDismiss={() => setNotice(null)}>
				{notice ? t(notice) : ""}
			</Snackbar>
		</View>
	);
}

/**
 * One key, owning its own dialog and its own anchor ref.
 *
 * A component per row rather than one ref beside the `.map()`: a shared ref
 * holds whichever row rendered last, so revoking the first key would return
 * focus to the last row's button. The same reason `PendingInvites` splits.
 */
function ApiKeyRow({
	apiKey,
	uid,
	online,
	onError,
}: {
	apiKey: ApiKey;
	uid: string | null;
	online: boolean;
	onError: () => void;
}) {
	const { t, i18n } = useTranslation();
	const [confirming, setConfirming] = useState(false);
	const anchorRef = useRef<View | null>(null);

	const confirmRevoke = () => {
		setConfirming(false);
		if (uid === null) return;
		revokeApiKey(uid, apiKey.id).catch((reason) => {
			console.error("Could not revoke the API key:", reason);
			onError();
		});
	};

	return (
		<>
			<Row
				// The tail is what tells four keys apart at a glance — the leading part
				// of a token is the uid and the key id, which every key of one person
				// shares.
				title={`${apiKey.name} ····${apiKey.tail}`}
				description={
					apiKey.lastUsedAt
						? t("automations.lastUsed", {
								when: formatElapsed(
									apiKey.lastUsedAt.toDate(),
									new Date(),
									i18n.language,
								),
							})
						: t("automations.neverUsed")
				}
				right={
					<IconButton
						ref={anchorRef}
						icon="close"
						accessibilityLabel={t("automations.revoke.for", {
							name: apiKey.name,
						})}
						disabled={!online}
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
				title={t("automations.revoke.title", { name: apiKey.name })}
				body={t("automations.revoke.body")}
				confirmLabel={t("automations.revoke.action")}
				destructive
				testID={`${revokeDialogTestID}-${apiKey.id}`}
				returnFocusTo={anchorRef}
			/>
		</>
	);
}
