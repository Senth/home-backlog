import { useIsFocused } from "@react-navigation/native";
import type { User } from "firebase/auth";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import {
	Avatar,
	Button,
	Dialog,
	Divider,
	Menu,
	Portal,
	Snackbar,
	Text,
	TouchableRipple,
} from "react-native-paper";
import { displayLabel, initials } from "@/auth/display-name";
import { type AuthErrorKey, mapAuthError } from "@/auth/errors";
import { useAuth } from "@/contexts/AuthContext";
import { useAnchorFocusGuard, useModalFocus } from "@/hooks/use-modal-focus";
import { useAppTheme } from "@/theme";
import {
	compactBreakpoint,
	contentWidth,
	radius,
	size,
	space,
	touchTarget,
} from "@/theme/tokens";

const signOutDialogTestID = "sign-out-dialog";

/**
 * What the focus trap actually looks for. Paper puts `testID` on the modal
 * wrapper and `${testID}-surface` on the dialog itself, and the wrapper
 * contains the scrim's own "Close modal" button — trapping that would put a
 * control in the cycle that is not part of the dialog.
 */
const signOutDialogSurfaceTestID = `${signOutDialogTestID}-surface`;

/** Kept for the browser reviewers to hook onto. Focus is *not* restored by
 *  this ID — three tab screens stay mounted at once, so it is not unique; the
 *  dialog gets a ref to this instance instead. */
const triggerTestID = "account-menu-trigger";

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
	const isFocused = useIsFocused();
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [error, setError] = useState<AuthErrorKey | null>(null);
	const triggerRef = useRef<View | null>(null);

	const closeConfirm = useCallback(() => setConfirmOpen(false), []);

	// Paper does nothing about focus on web: without this the dialog is reached
	// only by tabbing through the tab bar behind the scrim, and Escape does
	// nothing. A dialog that exists to be a deliberate stop has to be operable.
	useModalFocus(confirmOpen, signOutDialogSurfaceTestID, closeConfirm, {
		returnFocusTo: triggerRef,
	});

	// And Paper's `Menu` focuses this trigger on mount, unasked — see the hook.
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
					onDismiss={closeConfirm}
					testID={signOutDialogTestID}
					// Paper leaves the surface to fill its container, so on a desktop
					// monitor the dialog spans the window. Computing the width keeps
					// the inset on a phone *and* the Material 3 clamp on a monitor —
					// setting `width: "100%"` instead cancels Paper's own margin.
					style={{
						alignSelf: "center",
						width: Math.min(width - space.lg * 2, contentWidth.dialog),
					}}
				>
					<Dialog.Title>{t("account.signOut.title")}</Dialog.Title>
					<Dialog.Content>
						<Text variant="bodyMedium">{t("account.signOut.body")}</Text>
					</Dialog.Content>
					{/* Wrapping, because below ~230 px the two labels no longer fit
					    side by side and Paper's row simply overflows its own card:
					    "Cancel" — the safe answer — ends up on the scrim with its
					    left edge off the screen while "Sign out" sits square in the
					    middle. That is a phone at 200 % zoom, which is exactly the
					    person this dialog exists to protect. */}
					<Dialog.Actions style={{ gap: space.md, flexWrap: "wrap" }}>
						{/* The two answers must not look alike. Paper's default gives
						    both actions `primary`, so the one that ends your access
						    reads exactly like the one that does not — and it sits on
						    the right, under the thumb. `primary` also misses 4.5:1 on
						    this surface in the light theme; these roles clear it. */}
						<Button
							onPress={closeConfirm}
							textColor={theme.colors.onSurfaceVariant}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("common.cancel")}
						</Button>
						<Button
							onPress={handleSignOut}
							textColor={theme.colors.error}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("common.signOut")}
						</Button>
					</Dialog.Actions>
				</Dialog>

				<Snackbar visible={error !== null} onDismiss={() => setError(null)}>
					{error ? t(error) : ""}
				</Snackbar>
			</Portal>
		</>
	);
}
