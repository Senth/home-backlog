import { usePreventRemove } from "@react-navigation/native";
import { useFocusEffect, useRouter } from "expo-router";
import { getIdTokenResult } from "firebase/auth";
import { type Ref, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View, type ViewInstance } from "react-native";
import { Button, Divider, Snackbar, Text } from "react-native-paper";
import { GoogleSignInButton } from "@/components/auth/GoogleSignIn";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { AppHeader } from "@/components/ui/AppHeader";
import { BackAction } from "@/components/ui/BackAction";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { Row } from "@/components/ui/Row";
import { SlimScrollView } from "@/components/ui/SlimScrollView";
import { useAuth } from "@/contexts/AuthContext";
import { deleteAccount } from "@/data/account";
import { isOnline } from "@/hooks/use-online-status";
import { formatList } from "@/i18n/format-list";
import {
	type AccountDeletionPlan,
	accountDeletionView,
} from "@/models/account-deletion";
import { formatElapsed } from "@/models/relative-time";
import { useAppTheme } from "@/theme";
import { contentWidth, icon, space, touchTarget } from "@/theme/tokens";

export default function DeleteAccount() {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user, signOut, redirectError, dismissRedirectError } = useAuth();
	const [plan, setPlan] = useState<AccountDeletionPlan | null>(null);
	const [authTime, setAuthTime] = useState<number | null>(null);
	const [now, setNow] = useState(Date.now);
	const [confirm, setConfirm] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const deleteRef = useRef<ViewInstance | null>(null);
	const busy = useRef(false);
	usePreventRemove(deleting, () => {});

	useEffect(() => {
		if (!deleting || Platform.OS !== "web" || typeof window === "undefined")
			return;
		const prevent = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", prevent);
		return () => window.removeEventListener("beforeunload", prevent);
	}, [deleting]);

	const refreshAuth = useCallback(() => {
		if (!user) return;
		void getIdTokenResult(user, true)
			.then((token) => {
				setAuthTime(Date.parse(token.authTime));
				setNow(Date.now());
			})
			.catch(() => setError("error.offline"));
	}, [user]);

	useFocusEffect(
		useCallback(() => {
			let live = true;
			if (attempt > 0) setError(null);
			setPlan(null);
			void deleteAccount(true)
				.then((next) => {
					if (live) setPlan(next);
				})
				.catch(() => {
					if (live) setError(isOnline() ? "error.loadFailed" : "error.offline");
				});
			refreshAuth();
			const timer = setInterval(() => setNow(Date.now()), 10_000);
			return () => {
				live = false;
				clearInterval(timer);
			};
		}, [refreshAuth, attempt]),
	);

	const view = accountDeletionView(plan, authTime, now);
	const message = error ?? redirectError;
	const remove = async () => {
		if (busy.current) return;
		if (!isOnline()) {
			setError("error.offline");
			setConfirm(false);
			return;
		}
		busy.current = true;
		setDeleting(true);
		try {
			await deleteAccount(false);
		} catch (reason) {
			const failure = reason as { code?: string; message?: string };
			if (failure.message === "recent-login") setAuthTime(null);
			else setError(isOnline() ? "error.saveFailed" : "error.offline");
			if (failure.message === "blocked") setAttempt((value) => value + 1);
			setConfirm(false);
			setDeleting(false);
			busy.current = false;
			return;
		}
		try {
			await signOut("/login?deleted=1");
			router.replace("/login?deleted=1");
		} catch {
			setError("error.saveFailed");
			setDeleting(false);
			busy.current = false;
		}
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<AppHeader
				title={t("account.deleteAccount")}
				leading={
					<BackAction
						accessibilityLabel={t("homes.title")}
						onPress={() => {
							if (!busy.current) router.replace("/homes");
						}}
					/>
				}
			/>
			<SlimScrollView
				contentContainerStyle={{
					padding: space.md,
					gap: space.lg,
					alignSelf: "center",
					width: "100%",
					maxWidth: contentWidth.form,
				}}
			>
				<Text variant="bodyLarge">{t("account.delete.intro")}</Text>
				{plan ? (
					<>
						<View style={{ gap: space.md }}>
							<Text variant="titleMedium">{t("account.delete.homes")}</Text>
							{view.rows.map((home) => (
								<Row
									key={home.homeId}
									title={home.name}
									description={t(home.copy, {
										names: formatList(home.otherMembers, i18n.language),
										count: home.privateCardsDeleted,
									})}
									style={{
										paddingHorizontal: space.none,
										paddingVertical: space.none,
									}}
									left={
										<View style={{ alignSelf: "flex-start" }}>
											<PaperIcon
												name={home.icon}
												size={icon.md}
												color={theme.colors.onSurfaceVariant}
											/>
										</View>
									}
								>
									{home.outcome === "blocked" ? (
										<Button
											mode="text"
											icon="chevron-right"
											onPress={() => router.push(`/homes/${home.homeId}`)}
											contentStyle={{
												minHeight: touchTarget,
												flexDirection: "row-reverse",
											}}
											style={{ alignSelf: "flex-start" }}
										>
											{t("account.delete.manage", { home: home.name })}
										</Button>
									) : null}
								</Row>
							))}
						</View>
						<Divider />
						<View style={{ gap: space.md }}>
							<Text variant="titleMedium">{t("account.delete.also")}</Text>
							{plan.apiKeys.length ? (
								<Row
									style={{
										paddingHorizontal: space.none,
										paddingVertical: space.none,
									}}
									title={
										<Text variant="bodyMedium">
											{t("account.delete.keys", {
												count: plan.apiKeys.length,
												name: formatList(
													plan.apiKeys.map((key) => key.name),
													i18n.language,
												),
											})}
										</Text>
									}
									left={
										<View style={{ alignSelf: "flex-start" }}>
											<PaperIcon
												name="key"
												size={icon.md}
												color={theme.colors.onSurfaceVariant}
											/>
										</View>
									}
								/>
							) : null}
							<Row
								style={{
									paddingHorizontal: space.none,
									paddingVertical: space.none,
								}}
								title={
									<Text variant="bodyMedium">
										{t("account.delete.identity")}
									</Text>
								}
								left={
									<View style={{ alignSelf: "flex-start" }}>
										<PaperIcon
											name="account-outline"
											size={icon.md}
											color={theme.colors.onSurfaceVariant}
										/>
									</View>
								}
							/>
						</View>
						<Divider />
						<View style={{ gap: space.sm }}>
							{view.stale && !view.disabled ? (
								<GoogleSignInButton
									reauthenticate
									onSuccess={refreshAuth}
									onError={setError}
									disabled={deleting}
								/>
							) : (
								<Button
									ref={deleteRef as Ref<typeof View>}
									mode="text"
									icon="delete-outline"
									textColor={theme.colors.error}
									disabled={view.disabled || deleting}
									onPress={() => setConfirm(true)}
									contentStyle={{ minHeight: touchTarget }}
								>
									{t(view.label)}
								</Button>
							)}
							<Text
								variant="bodySmall"
								style={{
									color: theme.colors.onSurfaceVariant,
									textAlign: "center",
								}}
							>
								{t(view.hint, {
									home: formatList(view.blockedHomes, i18n.language),
									time:
										authTime === null
											? ""
											: formatElapsed(
													new Date(authTime),
													new Date(now),
													i18n.language,
												),
								})}
							</Text>
						</View>
					</>
				) : error ? (
					<Button
						mode="text"
						onPress={() => setAttempt((value) => value + 1)}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("common.retry")}
					</Button>
				) : null}
			</SlimScrollView>
			<ConfirmDialog
				visible={confirm}
				onDismiss={() => setConfirm(false)}
				onConfirm={() => {
					void remove();
				}}
				title={t("account.delete.confirmTitle")}
				body={t("account.delete.confirmBody")}
				confirmLabel={t("account.delete.confirmAction")}
				destructive
				loading={deleting}
				testID="delete-account-dialog"
				returnFocusTo={deleteRef}
			/>
			<Snackbar
				visible={message !== null}
				onDismiss={() => {
					setError(null);
					dismissRedirectError();
				}}
			>
				{message ? t(message) : ""}
			</Snackbar>
		</View>
	);
}
