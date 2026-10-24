import type { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import type { ReactElement } from "react";
import TabsLayout from "@/app/(app)/(tabs)/_layout";
import en from "@/i18n/locales/en-US.json";
import sv from "@/i18n/locales/sv-SE.json";
import { lightTheme } from "@/theme";

let mockWidth = 195;
let mockHeight = 844;
let mockTabs = en.tab;

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({ width: mockWidth, height: mockHeight }),
}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => mockTabs[key.slice(4) as keyof typeof mockTabs],
	}),
}));
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: { id: "home-1" } }),
}));
jest.mock("@/theme", () => {
	const theme = jest.requireActual("@/theme");
	return { ...theme, useAppTheme: () => theme.lightTheme };
});
jest.mock("expo-router", () => ({
	Tabs: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe.each([
	[
		"en-US",
		en.tab,
		[
			"Over\u00adview",
			"Proj\u00adects",
			"Loca\u00adtions",
			"Main\u00adtenance",
		],
	],
	[
		"sv-SE",
		sv.tab,
		["Över\u00adsikt", "Projekt", "Platser", "Under\u00adhåll"],
	],
] as const)("%s tab labels", (_locale, translations, narrowLabels) => {
	it.each([195, 320, 390, 720, 1024, 1440, 2560])(
		"keeps whole words and names that match the visible label at %ipx",
		(width) => {
			mockWidth = width;
			mockTabs = translations;
			const layout = TabsLayout().props.children;
			const screens = layout.props.children as ReactElement<{
				name: keyof typeof translations;
				options: BottomTabNavigationOptions;
			}>[];
			for (const [index, screen] of screens.entries()) {
				const options = {
					...(typeof layout.props.screenOptions === "function"
						? layout.props.screenOptions({ route: { name: screen.props.name } })
						: layout.props.screenOptions),
					...screen.props.options,
				} as BottomTabNavigationOptions;
				const full = translations[screen.props.name];
				const shown = width < 320 || width >= 720 ? narrowLabels[index] : full;
				expect(options.title).toBe(full);
				expect(options.tabBarAccessibilityLabel).toBe(shown);
				if (typeof options.tabBarLabel !== "function") {
					throw new Error("Expected custom tab label renderer");
				}
				const label = options.tabBarLabel({
					focused: true,
					color: lightTheme.colors.primary,
					position: "below-icon",
					children: full,
				}) as ReactElement<{ children: string; "aria-label": string }>;
				expect(label.props.children).toBe(shown);
				expect(label.props["aria-label"]).toBe(full);
			}
		},
	);
});

it.each([
	[195, 844, "bottom", "below-icon"],
	[390, 844, "bottom", "below-icon"],
	[719, 390, "bottom", "beside-icon"],
	[720, 390, "left", "below-icon"],
	[1024, 900, "left", "below-icon"],
	[1440, 900, "left", "below-icon"],
	[2560, 1440, "left", "below-icon"],
] as const)(
	"chooses navigation at %ix%i",
	(width, height, position, labelPosition) => {
		mockWidth = width;
		mockHeight = height;
		const layout = TabsLayout().props.children;
		const options = layout.props.screenOptions({ route: { name: "overview" } });
		expect(options.tabBarPosition).toBe(position);
		expect(options.tabBarVariant).toBe(
			position === "left" ? "material" : "uikit",
		);
		expect(options.tabBarLabelPosition).toBe(labelPosition);
	},
);
