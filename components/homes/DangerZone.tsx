import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Text } from "react-native-paper";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { deleteHome, removeMember } from "@/data/homes";
import { type Home, isLastOwner } from "@/models/home";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

const leaveDialogTestID = "leave-home-dialog";
const deleteDialogTestID = "delete-home-dialog";

interface DangerZoneProps {
	home: Home;
	myUid: string;
	onError: () => void;
}

/**
 * The two ways out of a home, and why only one of them is usually offered.
 *
 * **Leaving** is refused to the last admin, in `firestore.rules` and not only
 * here. A home with no admin can still be edited by everyone left in it, but
 * never invited to, never tidied and never deleted — and no action inside the
 * app could recover it.
 *
 * **Deleting** is offered only when you are the home's sole member. Deleting the
 * home document does not delete its nodes, locations and recurring rules: every
 * one of those rules resolves membership through a `get()` on the home, so once
 * it is gone those documents are unreachable by anyone, permanently, while still
 * stored and still billed. There is no Cloud Function to cascade them (#1 is
 * open and unbuilt, #39 covers the atomicity gap). Alone, the cascade is bounded
 * and usually empty, and it cannot revoke anybody else's access as a side
 * effect. It exists at all because the last-admin rule would otherwise trap a
 * sole owner with every home they ever created by accident.
 */
export function DangerZone({ home, myUid, onError }: DangerZoneProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();

	const [confirmLeave, setConfirmLeave] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const alone = Object.keys(home.members).length === 1;
	const trapped = isLastOwner(home, myUid);

	// Back to "My homes" rather than into whatever remains: the home this screen
	// is about no longer exists for this person, and the ladder will pick up a
	// single remaining home from there anyway.
	const leaveFor = (act: () => Promise<void>) => {
		act()
			.then(() => router.replace("/homes"))
			.catch((reason) => {
				console.error("Could not leave or delete the home:", reason);
				onError();
			});
	};

	return (
		<View style={{ gap: space.sm }}>
			<Button
				icon="exit-to-app"
				onPress={() => setConfirmLeave(true)}
				disabled={trapped}
				textColor={theme.colors.error}
				contentStyle={{ minHeight: touchTarget }}
			>
				{t("manageHome.leave")}
			</Button>
			{trapped ? (
				<Text
					variant="bodySmall"
					style={{
						color: theme.colors.onSurfaceVariant,
						textAlign: "center",
					}}
				>
					{t("members.lastAdmin")}
				</Text>
			) : null}

			<Button
				icon="delete-outline"
				onPress={() => setConfirmDelete(true)}
				disabled={!alone}
				textColor={theme.colors.error}
				contentStyle={{ minHeight: touchTarget }}
			>
				{t("manageHome.delete")}
			</Button>
			{alone ? null : (
				<Text
					variant="bodySmall"
					style={{
						color: theme.colors.onSurfaceVariant,
						textAlign: "center",
					}}
				>
					{t("manageHome.deleteOnlyAlone")}
				</Text>
			)}

			<ConfirmDialog
				visible={confirmLeave}
				onDismiss={() => setConfirmLeave(false)}
				onConfirm={() => {
					setConfirmLeave(false);
					leaveFor(() => removeMember(home.id, myUid));
				}}
				title={t("manageHome.leaveTitle", { home: home.name })}
				body={t("manageHome.leaveBody")}
				confirmLabel={t("manageHome.leave")}
				destructive
				testID={leaveDialogTestID}
			/>

			<ConfirmDialog
				visible={confirmDelete}
				onDismiss={() => setConfirmDelete(false)}
				onConfirm={() => {
					setConfirmDelete(false);
					leaveFor(() => deleteHome(home.id));
				}}
				title={t("manageHome.deleteTitle", { home: home.name })}
				body={t("manageHome.deleteBody")}
				confirmLabel={t("manageHome.deleteConfirm")}
				destructive
				testID={deleteDialogTestID}
			/>
		</View>
	);
}
