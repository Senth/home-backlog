import type { User } from "firebase/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import {
	Avatar,
	Button,
	Dialog,
	Divider,
	Menu,
	Portal,
	Text,
	TouchableRipple,
} from "react-native-paper";
import { displayLabel, initials } from "@/auth/display-name";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/theme";
import {
	compactBreakpoint,
	contentWidth,
	radius,
	size,
	space,
	touchTarget,
} from "@/theme/tokens";

/**
 * The avatar, with initials underneath it.
 *
 * The photo is a `googleusercontent.com` request, so it can be slow, blocked or
 * simply unavailable offline. Painting the initials *over* the image and
 * removing them only once it has loaded means the app bar never shows a hole,
 * never shifts layout, and keeps the initials if the request fails.
 */
function AccountAvatar({ user, px }: { user: User; px: number }) {
	const theme = useAppTheme();
	const [photoLoaded, setPhotoLoaded] = useState(false);
	const [photoFailed, setPhotoFailed] = useState(false);
	const photoURL = user.photoURL;

	return (
		<View style={{ width: px, height: px }}>
			{photoURL && !photoFailed ? (
				<Avatar.Image
					size={px}
					source={{ uri: photoURL }}
					onLoad={() => setPhotoLoaded(true)}
					onError={() => setPhotoFailed(true)}
				/>
			) : null}
			{photoLoaded ? null : (
				<Avatar.Text
					size={px}
					label={initials(user)}
					style={{
						position: "absolute",
						backgroundColor: theme.colors.primaryContainer,
					}}
					labelStyle={{ color: theme.colors.onPrimaryContainer }}
				/>
			)}
		</View>
	);
}

/**
 * Who you are signed in as, and the only way out.
 *
 * It sits in the app bar of every tab screen, so it is in the same place
 * wherever the user is. It is built as an *account* menu with room for more
 * rows rather than a sign-out drawer, because "Switch home" (#21) lands here.
 *
 * Sign out is two deliberate steps — the menu, then a confirmation dialog. For
 * the developer sign-out is trivially reversible; for someone whose phone has
 * remembered their Google password for years it is total loss of access until a
 * family member visits. Google sign-in is the only method (`docs/PROJECT.md`),
 * so the mitigation has to be making sign-out hard to hit by accident.
 */
export function AccountMenu() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { user, signOut } = useAuth();
	const { width } = useWindowDimensions();
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

	if (!user) return null;

	// The name beside the avatar is redundancy at no cost: signing in with the
	// wrong Google account otherwise looks exactly like a working app with an
	// empty board. A phone app bar has no room for it, which is why the
	// empty-state footnote carries the address there instead.
	const showName = width >= compactBreakpoint;
	const name = displayLabel(user);

	return (
		<>
			<Menu
				visible={menuOpen}
				onDismiss={() => setMenuOpen(false)}
				anchorPosition="bottom"
				anchor={
					<TouchableRipple
						accessibilityRole="button"
						accessibilityLabel={t("account.label")}
						onPress={() => setMenuOpen(true)}
						borderless
						style={{
							justifyContent: "center",
							minWidth: touchTarget,
							minHeight: touchTarget,
							paddingHorizontal: space.sm,
							borderRadius: radius.full,
						}}
					>
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "center",
								gap: space.sm,
							}}
						>
							<AccountAvatar user={user} px={size.avatarSm} />
							{showName ? <Text variant="labelLarge">{name}</Text> : null}
						</View>
					</TouchableRipple>
				}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.md,
						paddingHorizontal: space.md,
						paddingVertical: space.sm,
					}}
				>
					<AccountAvatar user={user} px={size.avatarMd} />
					<View style={{ flexShrink: 1 }}>
						<Text variant="titleMedium">{name}</Text>
						<Text
							variant="bodySmall"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{user.email}
						</Text>
					</View>
				</View>

				<Divider />

				<Menu.Item
					leadingIcon="logout"
					title={t("common.signOut")}
					onPress={() => {
						setMenuOpen(false);
						setConfirmOpen(true);
					}}
				/>
			</Menu>

			<Portal>
				<Dialog
					visible={confirmOpen}
					onDismiss={() => setConfirmOpen(false)}
					style={{
						alignSelf: "center",
						width: "100%",
						maxWidth: contentWidth.dialog,
					}}
				>
					<Dialog.Title>{t("account.signOut.title")}</Dialog.Title>
					<Dialog.Content>
						<Text variant="bodyMedium">{t("account.signOut.body")}</Text>
					</Dialog.Content>
					<Dialog.Actions>
						<Button onPress={() => setConfirmOpen(false)}>
							{t("common.cancel")}
						</Button>
						<Button
							onPress={() => {
								setConfirmOpen(false);
								void signOut();
							}}
						>
							{t("common.signOut")}
						</Button>
					</Dialog.Actions>
				</Dialog>
			</Portal>
		</>
	);
}
