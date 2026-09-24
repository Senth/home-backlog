import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Chip, IconButton, Menu, Text } from "react-native-paper";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { AppMenu } from "@/components/ui/AppMenu";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { Row } from "@/components/ui/Row";
import { removeMember, setMemberRole } from "@/data/homes";
import {
	type Home,
	isLastOwner,
	type Member,
	membersOf,
	type Role,
} from "@/models/home";
import { useAppTheme } from "@/theme";
import { size, space, touchTarget } from "@/theme/tokens";

const removeDialogTestID = "remove-member-dialog";

interface MembersListProps {
	home: Home;
	myUid: string;
	/** Only an owner may change roles or remove anyone. */
	canManage: boolean;
	onError: () => void;
}

/**
 * Who else is in this home, and what an owner may do about it.
 *
 * The section is not rendered at all for a home you are alone in — a solo
 * household never has to meet the concept of membership, and one quiet "Invite
 * someone" is the whole surface it needs.
 *
 * Every action that would leave the home without an admin is disabled with the
 * reason, rather than hidden or allowed to fail: `firestore.rules` refuses it
 * regardless, and a control that fails silently at the server teaches nothing.
 * The rule is the guarantee; this is only the explanation.
 */
export function MembersList({
	home,
	myUid,
	canManage,
	onError,
}: MembersListProps) {
	const { t } = useTranslation();
	const members = membersOf(home);

	if (members.length < 2) return null;

	return (
		<View style={{ gap: space.sm }}>
			<Text variant="titleMedium">{t("members.title")}</Text>
			<View>
				{members.map((member) => (
					<MemberRow
						key={member.uid}
						member={member}
						home={home}
						myUid={myUid}
						canManage={canManage}
						onError={onError}
					/>
				))}
			</View>
		</View>
	);
}

function MemberRow({
	member,
	home,
	myUid,
	canManage,
	onError,
}: {
	member: Member;
	home: Home;
	myUid: string;
	canManage: boolean;
	onError: () => void;
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [menuOpen, setMenuOpen] = useState(false);
	// Stable so Paper keeps its Escape handler: it attaches that to `document`
	// once, inside `show()`, and tears it down from an effect whose dependency
	// chain ends at `onDismiss`. A fresh closure each render means any re-render
	// while the menu is open leaves it with no way out but the mouse. Same
	// reasoning, and the same fix, as `components/board/CardMenu.tsx`.
	const closeMenu = useCallback(() => setMenuOpen(false), []);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const menuAnchorRef = useRef<View | null>(null);

	const isMe = member.uid === myUid;
	const lastOwner = isLastOwner(home, member.uid);
	const name = member.displayName || t("members.unknown");

	const change = (change: () => Promise<void>) => {
		setMenuOpen(false);
		change().catch((reason) => {
			console.error("Could not change the membership:", reason);
			onError();
		});
	};

	return (
		<>
			<Row
				title={name}
				description={isMe ? t("members.you") : undefined}
				left={
					<PersonAvatar
						name={name}
						photoURL={member.photoURL}
						px={size.avatarSm}
					/>
				}
				right={
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space.sm,
						}}
					>
						<Chip compact>
							{member.role === "owner"
								? t("members.roleOwner")
								: t("members.roleMember")}
						</Chip>
						{canManage ? (
							<AppMenu
								visible={menuOpen}
								onDismiss={closeMenu}
								overlayAccessibilityLabel={t("common.closeMenu")}
								anchorPosition="bottom"
								anchor={
									<IconButton
										ref={menuAnchorRef}
										icon="dots-vertical"
										accessibilityLabel={t("members.manage", { name })}
										onPress={() => setMenuOpen(true)}
										style={{
											width: touchTarget,
											height: touchTarget,
											margin: space.none,
										}}
									/>
								}
							>
								{member.role === "member" ? (
									<Menu.Item
										leadingIcon="shield-account-outline"
										title={t("members.promote")}
										onPress={() =>
											change(() =>
												setMemberRole(home.id, member.uid, "owner" as Role),
											)
										}
									/>
								) : (
									<Menu.Item
										leadingIcon="account-outline"
										title={t("members.demote")}
										disabled={lastOwner}
										onPress={() =>
											change(() =>
												setMemberRole(home.id, member.uid, "member" as Role),
											)
										}
									/>
								)}

								{isMe ? null : (
									<Menu.Item
										leadingIcon="account-remove-outline"
										title={t("members.remove")}
										disabled={lastOwner}
										onPress={() => {
											setMenuOpen(false);
											setConfirmRemove(true);
										}}
									/>
								)}

								{lastOwner ? (
									// Why the items above are greyed out. Nothing may leave a
									// home with no admin: the rest could edit forever but never
									// invite, remove or delete, and no action inside the app
									// could recover it.
									<Text
										variant="bodySmall"
										style={{
											color: theme.colors.onSurfaceVariant,
											paddingHorizontal: space.md,
											paddingBottom: space.sm,
										}}
									>
										{t("members.lastAdmin")}
									</Text>
								) : null}
							</AppMenu>
						) : null}
					</View>
				}
			/>

			<ConfirmDialog
				visible={confirmRemove}
				onDismiss={() => setConfirmRemove(false)}
				onConfirm={() => {
					setConfirmRemove(false);
					change(() => removeMember(home.id, member.uid));
				}}
				title={t("members.removeTitle", { name })}
				body={t("members.removeBody")}
				confirmLabel={t("members.remove")}
				destructive
				testID={`${removeDialogTestID}-${member.uid}`}
				// Back to the menu button on cancel. On confirm the row is gone and
				// the node detached, which `useModalFocus` already falls back from.
				returnFocusTo={menuAnchorRef}
			/>
		</>
	);
}
