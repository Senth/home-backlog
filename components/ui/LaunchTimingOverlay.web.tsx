import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Surface, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { elevation, radius, space, touchTarget } from "@/theme/tokens";
import { buildId } from "@/utils/build-info";
import {
	type TimingRow,
	timingMarkdown,
	timingRows,
} from "@/utils/launch-timing";

const flagKey = "home-backlog.debugTiming";

function readRows() {
	const [navigation] = performance.getEntriesByType(
		"navigation",
	) as PerformanceNavigationTiming[];
	return timingRows([
		...(navigation
			? [{ name: "launch:html", startTime: navigation.responseEnd }]
			: []),
		...performance.getEntriesByType("mark"),
	]);
}

export function LaunchTimingOverlay() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const [header, setHeader] = useState<string | null>(null);
	const [rows, setRows] = useState<TimingRow[]>([]);

	useEffect(() => {
		if (new URLSearchParams(location.search).get("debug") === "timing") {
			localStorage.setItem(flagKey, "1");
		}
		if (localStorage.getItem(flagKey) === null) return;

		const worker = navigator.serviceWorker?.controller ? "warm SW" : "cold SW";
		setHeader(
			[
				new Date().toISOString().slice(0, 10),
				buildId,
				worker,
				`${innerWidth}×${innerHeight}`,
			].join(" · "),
		);
		setRows(readRows());

		const observer = new PerformanceObserver(() => setRows(readRows()));
		observer.observe({ type: "mark" });
		return () => observer.disconnect();
	}, []);

	if (header === null) return null;

	const ink = theme.colors.inverseOnSurface;
	const mono = { color: ink, fontFamily: "monospace" };
	const numeric = {
		...mono,
		fontVariant: ["tabular-nums" as const],
		textAlign: "right" as const,
	};
	const columns = [
		{ key: "name", head: "mark", style: mono },
		{ key: "at", head: "at", style: numeric },
		{ key: "step", head: "+step", style: numeric },
	] as const;

	const close = () => {
		localStorage.removeItem(flagKey);
		setHeader(null);
	};

	const copy = () => {
		Clipboard.setStringAsync(timingMarkdown(rows, header)).catch(
			(reason: unknown) =>
				console.error("Could not copy the launch timing:", reason),
		);
	};

	return (
		<Surface
			elevation={elevation.high}
			style={{
				position: "absolute",
				top: space.xxl + space.lg,
				left: space.md,
				right: space.md,
				padding: space.md,
				gap: space.sm,
				borderRadius: radius.md,
				backgroundColor: theme.colors.inverseSurface,
			}}
		>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
			>
				<Text variant="titleMedium" style={{ flex: 1, color: ink }}>
					{t("debug.timing.title")}
				</Text>
				<Button
					mode="outlined"
					textColor={ink}
					contentStyle={{ minHeight: touchTarget }}
					onPress={copy}
				>
					{t("debug.timing.copy")}
				</Button>
				<Button
					mode="text"
					textColor={ink}
					contentStyle={{ minHeight: touchTarget }}
					onPress={close}
				>
					{t("debug.timing.close")}
				</Button>
			</View>
			<Text variant="bodySmall" style={mono}>
				{header}
			</Text>
			<View style={{ flexDirection: "row", gap: space.md }}>
				{columns.map(({ key, head, style }) => (
					<View key={key} style={key === "name" ? { flex: 1 } : null}>
						<Text variant="bodySmall" style={style}>
							{head}
						</Text>
						{rows.map((row) => (
							<Text
								key={row.name}
								variant="bodyMedium"
								style={[style, row.name === "content" && { fontWeight: "500" }]}
							>
								{row[key]}
							</Text>
						))}
					</View>
				))}
			</View>
		</Surface>
	);
}
