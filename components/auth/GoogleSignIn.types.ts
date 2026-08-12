import type { AuthErrorKey } from "@/auth/errors";

/** Shared by the web and native `GoogleSignInButton`, which are separate files. */
export interface GoogleSignInButtonProps {
	/** Receives an i18n key, so the caller owns how the failure is shown. */
	onError?: (key: AuthErrorKey) => void;
	/** Disabled for a reason the caller states — offline, today. */
	disabled?: boolean;
}
