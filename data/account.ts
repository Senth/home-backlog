import { httpsCallable } from "firebase/functions";
import { functions } from "@/config/firebase";
import type { AccountDeletionPlan } from "@/models/account-deletion";

export async function deleteAccount(
	dryRun: boolean,
): Promise<AccountDeletionPlan> {
	const call = httpsCallable<{ dryRun: boolean }, AccountDeletionPlan>(
		functions,
		"deleteAccount",
		{ timeout: 540_000 },
	);
	return (await call({ dryRun })).data;
}
