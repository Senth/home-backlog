import { useRouter } from "expo-router";
import { type Ref, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, type ViewInstance } from "react-native";
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

export function DangerZone({ home, myUid, onError }: DangerZoneProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();

	const [confirmLeave, setConfirmLeave] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const leaveButtonRef = useRef<ViewInstance | null>(null);
	const deleteButtonRef = useRef<ViewInstance | null>(null);

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
				ref={leaveButtonRef as Ref<typeof View>}
				mode="text"
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
				ref={deleteButtonRef as Ref<typeof View>}
				mode="text"
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
				returnFocusTo={leaveButtonRef}
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
				returnFocusTo={deleteButtonRef}
			/>
		</View>
	);
}
