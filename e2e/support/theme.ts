import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * `theme/index.ts`'s palettes, loaded in the Playwright process.
 *
 * The craft spec judges rendered colours against `lightTheme.colors` and
 * `darkTheme.colors`, but the process running the tests is Node — and
 * `theme/index.ts` imports `react-native-paper`, whose entry requires
 * `react-native`, whose entry is Flow, which Node cannot even parse. That is
 * the same reason `e2e/support/app.ts` refuses to import components. So the
 * palettes are reconstructed here rather than imported, in two steps that each
 * keep the installed package and the app source as the source of truth:
 *
 * 1. `MD3LightTheme` / `MD3DarkTheme` come from the compiled theme modules
 *    inside the installed paper package, loaded behind a `require` hook that
 *    answers `react-native` with the one thing those modules touch at module
 *    level: `Platform`.
 * 2. `theme/index.ts` itself is transpiled with the repo's own `typescript`
 *    and evaluated with a `require` that hands back the themes from step 1 —
 *    so what this exports is the object the app actually spreads into its
 *    provider, not a copy that can drift from it.
 */

export type Scheme = "light" | "dark";

type ThemeColors = Record<string, unknown>;

const NODE_REQUIRE = createRequire(path.join(process.cwd(), "package.json"));

/** Everything the paper theme modules read from react-native at module load. */
const REACT_NATIVE_STUB = {
	Platform: { OS: "web", select: () => ({}) },
};

/**
 * The one colour comparison the browser speaks: `rgba(r, g, b, a)`. Hex and
 * `rgb()` from the theme files, and `rgba()` from `getComputedStyle`, all
 * arrive here before anything is compared.
 */
function canonicalColor(value: string): string {
	if (value === "transparent") return "rgba(0, 0, 0, 0)";
	if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
		const n = Number.parseInt(value.slice(1), 16);
		return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 1)`;
	}
	const rgb = value.match(/^rgba?\(([^)]+)\)$/);
	if (rgb !== null) {
		const [r, g, b, a = "1"] = rgb[1].split(",").map((part) => part.trim());
		return `rgba(${r}, ${g}, ${b}, ${Number(a)})`;
	}
	throw new Error(`unsupported colour value in the theme: ${value}`);
}

function collectColors(node: unknown, out: Set<string>): void {
	if (typeof node === "string") {
		out.add(canonicalColor(node));
		return;
	}
	if (node !== null && typeof node === "object") {
		for (const value of Object.values(node)) collectColors(value, out);
	}
}

function loadPaperThemes(): { light: ThemeColors; dark: ThemeColors } {
	const Module = NODE_REQUIRE("node:module") as typeof import("module");
	// `Module._load` is the module system's own resolver; intercepting the one
	// request the paper theme modules make — `react-native` — is what lets the
	// compiled MD3 themes load in a Node process at all.
	type NodeModuleSystem = {
		_load: (request: string, parent?: unknown, isMain?: boolean) => unknown;
	};
	// `Module._load` is the module system's own resolver; intercepting the one
	// request the paper theme modules make — `react-native` — is what lets the
	// compiled MD3 themes load in a Node process at all.
	const moduleSystem = Module as unknown as NodeModuleSystem;
	const originalLoad = moduleSystem._load;
	moduleSystem._load = (request, parent, isMain) => {
		if (request === "react-native") return REACT_NATIVE_STUB;
		return originalLoad.call(moduleSystem, request, parent, isMain);
	};
	return {
		light: NODE_REQUIRE(
			"react-native-paper/lib/commonjs/styles/themes/v3/LightTheme.js",
		).MD3LightTheme.colors,
		dark: NODE_REQUIRE(
			"react-native-paper/lib/commonjs/styles/themes/v3/DarkTheme.js",
		).MD3DarkTheme.colors,
	};
}

function loadThemeSource(): {
	lightTheme: { colors: ThemeColors };
	darkTheme: { colors: ThemeColors };
	priorityRamp: readonly string[];
} {
	const ts = NODE_REQUIRE("typescript") as typeof import("typescript");
	const paperThemes = loadPaperThemes();
	const requireFake = (id: string): unknown => {
		if (id !== "react-native-paper") {
			throw new Error(
				`theme files import "${id}", but this loader only supplies react-native-paper`,
			);
		}
		return {
			MD3LightTheme: { colors: paperThemes.light },
			MD3DarkTheme: { colors: paperThemes.dark },
		};
	};
	const load = (file: string): unknown => {
		const source = readFileSync(path.join(process.cwd(), file), "utf8");
		const js = ts.transpileModule(source, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ES2019,
			},
		}).outputText;
		const moduleShell = { exports: {} };
		new Function("require", "module", "exports", js)(
			requireFake,
			moduleShell,
			moduleShell.exports,
		);
		return moduleShell.exports;
	};
	const themes = load(path.join("theme", "index.ts")) as {
		lightTheme: { colors: ThemeColors };
		darkTheme: { colors: ThemeColors };
	};
	// `tokens.ts` imports nothing, so the paper-only `require` never fires for
	// it; its ramp colours are painted by the card face and belong on the
	// palette the sweeps judge against.
	const tokens = load(path.join("theme", "tokens.ts")) as {
		priorityRamp: readonly { color: string; on: string }[];
	};
	// Only the two colour fields — the ramp also carries glyph names, which
	// are words, not colours.
	return {
		...themes,
		priorityRamp: tokens.priorityRamp.flatMap((step) => [step.color, step.on]),
	};
}

const themes = loadThemeSource();

function paletteOf(source: unknown): string[] {
	const colors_ = new Set<string>();
	collectColors(source, colors_);
	return [...colors_];
}

/**
 * Every colour the two schemes can paint — the MD3 defaults `theme/index.ts`
 * spreads in, its own overrides, the board colours, the elevation ramp, and
 * the priority ramp the card gutter paints — canonicalised for comparison
 * against computed styles.
 */
export const PALETTE: Record<Scheme, string[]> = {
	light: [
		...paletteOf(themes.lightTheme.colors),
		...paletteOf(themes.priorityRamp),
	],
	dark: [
		...paletteOf(themes.darkTheme.colors),
		...paletteOf(themes.priorityRamp),
	],
};
