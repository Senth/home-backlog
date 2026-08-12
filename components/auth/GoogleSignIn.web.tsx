import { GoogleAuthProvider, signInWithRedirect } from "firebase/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextStyle } from "react-native";
import { Button } from "react-native-paper";
import { mapAuthError } from "@/auth/errors";
import type { GoogleSignInButtonProps } from "@/components/auth/GoogleSignIn.types";
import { auth } from "@/config/firebase";
import { touchTarget } from "@/theme/tokens";

/**
 * Undoes Paper's hardcoded `numberOfLines={1}` on the button label.
 *
 * Paper offers no prop for it, but React Native Web appends `labelStyle` after
 * its own single-line clamp in the style array, so these win. Without them the
 * only control on the login screen reads "C…" at 200 % zoom — which is the text
 * size the person least able to guess what the button does is most likely to be
 * using. The cast is because neither property exists in React Native's
 * `TextStyle`; both are web-only, and so is this file.
 */
const wrappingLabel = {
	whiteSpace: "normal",
	textOverflow: "clip",
} as unknown as TextStyle;

/**
 * Google is the only sign-in method (see `docs/PROJECT.md`).
 *
 * The web flow is a **redirect**, not a popup. A popup works in a desktop tab
 * and dead-ends in an installed PWA — it opens outside the app shell and the
 * result may never reach the opener — and the installed PWA is the shipping
 * product for the least technical person in `docs/PERSONAS.md`. A redirect has
 * no popup to block and no opener to lose, and it is one code path rather than
 * a tab path plus a standalone path that is the hardest of the two to test.
 *
 * `authDomain` points at the app's own origin so the handler is same-origin;
 * see `config/firebase.ts`. The Auth emulator serves its own handler, so local
 * development needs no real Google account.
 *
 * The result of the redirect is picked up by `AuthContext`, not here — this
 * page is gone by the time it arrives.
 */
export function GoogleSignInButton({
	onError,
	disabled,
}: GoogleSignInButtonProps = {}) {
	const { t } = useTranslation();
	const [leaving, setLeaving] = useState(false);

	const handlePress = async () => {
		setLeaving(true);
		try {
			const provider = new GoogleAuthProvider();
			provider.addScope("profile");
			provider.addScope("email");
			// Always force the account chooser. Without it Google silently reuses
			// whichever account the browser saw last, so signing out and back in
			// returns the same wrong account — and someone with a work and a
			// personal account is locked out of their own board with no way back
			// from inside the app.
			provider.setCustomParameters({ prompt: "select_account" });
			await signInWithRedirect(auth, provider);
		} catch (error) {
			console.error("Google sign-in error:", error);
			onError?.(mapAuthError(error));
			// Only on failure: a successful call navigates away, and re-enabling
			// the button would let a second tap start a second redirect.
			setLeaving(false);
		}
	};

	return (
		<Button
			mode="contained"
			icon="google"
			onPress={handlePress}
			loading={leaving}
			disabled={leaving || disabled}
			labelStyle={wrappingLabel}
			// Paper's own button is 40 dp tall, under the project's 48.
			contentStyle={{ minHeight: touchTarget }}
		>
			{t("screen.login.google")}
		</Button>
	);
}
