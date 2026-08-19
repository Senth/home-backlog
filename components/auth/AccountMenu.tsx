import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import type { User } from "firebase/auth";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import {
	Divider,
	Menu,
	Portal,
	Snackbar,
	Text,
	TouchableRipple,
} from "react-native-paper";
import { displayLabel } from "@/auth/display-name";
import { type AuthErrorKey, mapAuthError } from "@/auth/errors";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useAnchorFocusGuard } from "@/hooks/use-modal-focus";
import { useAppTheme } from "@/theme";
import {
	compactBreakpoint,
	radius,
	size,
	space,
	touchTarget,
} from "@/theme/tokens";

const signOutDialogTestID = "sign-out-dialog";

/** Kept for the browser reviewers to hook onto. Focus is *not* restored by
 *  this ID — three tab screens stay mounted at once, so it is not unique; the
 *  dialog gets a ref to this instance instead. */
const triggerTestID = "account-menu-trigger";

/** The signed-in user's avatar. Same photo-over-initials behaviour the members
 *  list uses, which is why it lives in one place. */
function AccountAvatar({ user, px }: { user: User; px: number }) {
	return (
		<PersonAvatar name={displayLabel(user)} photoURL={user.photoURL} px={px} />
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
	const router = useRouter();
	const { width } = useWindowDimensions();
	const isFocused = useIsFocused();
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [error, setError] = useState<AuthErrorKey | null>(null);
	const triggerRef = useRef<View | null>(null);

	const closeConfirm = useCallback(() => setConfirmOpen(false), []);

	// Paper's `Menu` focuses this trigger on mount, unasked — see the hook. The
	// dialog's own focus trap comes with `ConfirmDialog`.
	useAnchorFocusGuard(triggerRef);

	if (!user) return null;

	// The name beside the avatar is redundancy at no cost: signing in with the
	// wrong Google account otherwise looks exactly like a working app with an
	// empty board. A phone app bar has no room for it, which is why the
	// empty-state footnote carries the address there instead.
	const showName = width >= compactBreakpoint;
	const name = displayLabel(user);

	const handleSignOut = () => {
		setConfirmOpen(false);
		signOut().catch((reason) => {
			// Silence here would close the dialog, leave the user signed in, and
			// say nothing — on the one action this whole feature exists to make
			// deliberate.
			console.error("Sign-out failed:", reason);
			setError(mapAuthError(reason));
		});
	};

	return (
		<>
			<Menu
				visible={menuOpen}
				onDismiss={() => setMenuOpen(false)}
				overlayAccessibilityLabel={t("common.closeMenu")}
				anchorPosition="bottom"
				// Otherwise the menu keeps its natural width and slides off the left
				// edge at high zoom, clipping the avatar and the sign-out icon.
				contentStyle={{ maxWidth: width - space.md * 2 }}
				anchor={
					<TouchableRipple
						ref={triggerRef}
						accessibilityRole="button"
						accessibilityLabel={t("account.label")}
						testID={triggerTestID}
						onPress={() => setMenuOpen(true)}
						borderless
						// Every visited tab stays mounted, so the app bars of the screens
						// you are *not* looking at are still in the DOM. They are
						// `aria-hidden`, but without this they keep their place in the
						// tab order: two invisible "Account" buttons between the board
						// and the tab bar, one of which opens a menu anchored to a
						// screen that is not on top.
						//
						// `tabIndex`, not `focusable`: React Native Web's `Pressable`
						// always writes a `tabIndex` of its own, and `createDOMProps`
						// only consults `focusable` when no `tabIndex` was given.
						tabIndex={isFocused ? 0 : -1}
						style={{
							justifyContent: "center",
							minWidth: touchTarget,
							minHeight: touchTarget,
							paddingHorizontal: space.sm,
							borderRadius: radius.full,
							// Room for the focus ring, which would otherwise be drawn
							// flush against the edge of the window and read as sliced.
							marginRight: space.xs,
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

				{/* The row this menu was left room for. Automations belong here
				    rather than on a home, because a key is *the person*: one
				    credential reaches every home its owner is a member of, and gains
				    a new one the moment they join it. */}
				<Menu.Item
					leadingIcon="robot-outline"
					title={t("account.automations")}
					onPress={() => {
						setMenuOpen(false);
						router.push("/automations");
					}}
				/>

				{/* Between a routine row and the one that cannot be undone. */}
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

			{/* `ConfirmDialog`, not a Paper `Dialog` of its own. This screen had
			    its own copy of the width clamp, the wrapping action row and the
			    destructive-button colours — and being a copy is how it kept
			    Paper's untranslated "Close modal" on its scrim after every other
			    dialog in the app had stopped saying it. */}
			<ConfirmDialog
				visible={confirmOpen}
				onDismiss={closeConfirm}
				onConfirm={handleSignOut}
				title={t("account.signOut.title")}
				body={t("account.signOut.body")}
				confirmLabel={t("common.signOut")}
				destructive
				testID={signOutDialogTestID}
				returnFocusTo={triggerRef}
			/>

			<Portal>
				<Snackbar visible={error !== null} onDismiss={() => setError(null)}>
					{error ? t(error) : ""}
				</Snackbar>
			</Portal>
		</>
	);
}
