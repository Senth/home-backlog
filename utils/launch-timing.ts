export const launchMarks = [
	"html",
	"bundle",
	"auth",
	"font",
	"splash",
	"homes",
	"router",
	"content",
] as const;

export type LaunchMark = (typeof launchMarks)[number];

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
