export const launchMarks = [
	"html",
	"bundle",
	"auth",
	"refresh",
	"lookup",
	"font",
	"splash",
	"homes",
	"router",
	"content",
] as const;

export type LaunchMark = (typeof launchMarks)[number];

export function networkEntries(
	resources: { name: string; responseEnd: number }[],
) {
	const matches = new Map<"refresh" | "lookup", number>();
	for (const resource of resources) {
		if (
			!matches.has("refresh") &&
			resource.name.includes("securetoken.googleapis.com/v1/token")
		) {
			matches.set("refresh", resource.responseEnd);
		}
		if (
			!matches.has("lookup") &&
			resource.name.includes(
				"identitytoolkit.googleapis.com/v1/accounts:lookup",
			)
		) {
			matches.set("lookup", resource.responseEnd);
		}
	}
	return [...matches].map(([name, startTime]) => ({
		name: `launch:${name}`,
		startTime,
	}));
}

export interface TimingRow {
	name: LaunchMark;
	at: number;
	step: number;
}

export function markLaunch(name: LaunchMark) {
	if (typeof performance?.getEntriesByName !== "function") return;
	const label = `launch:${name}`;
	if (performance.getEntriesByName(label).length === 0) performance.mark(label);
}

export function timingRows(
	entries: { name: string; startTime: number }[],
): TimingRow[] {
	const times = new Map(entries.map((entry) => [entry.name, entry.startTime]));
	let last = 0;
	return launchMarks
		.flatMap((name) => {
			const time = times.get(`launch:${name}`);
			return time === undefined ? [] : [{ name, at: Math.round(time) }];
		})
		.sort((a, b) => a.at - b.at)
		.map(({ name, at }) => {
			const row = { name, at, step: at - last };
			last = at;
			return row;
		});
}

export function timingMarkdown(rows: TimingRow[], header: string) {
	return [
		header,
		"",
		"| mark | at | +step |",
		"| --- | --: | --: |",
		...rows.map((row) => `| ${row.name} | ${row.at} | ${row.step} |`),
	].join("\n");
}
