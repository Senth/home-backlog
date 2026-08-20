import * as Localization from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import { fallbackLocale, resolveLocale } from "@/i18n/resolve-locale";

export const resources = {
	"en-US": { translation: enUS },
	"sv-SE": { translation: svSE },
} as const;

i18n.use(initReactI18next).init({
	resources,
	lng: resolveLocale(Localization.getLocales()[0]?.languageTag),
	fallbackLng: fallbackLocale,
	interpolation: {
		// React already escapes everything it renders.
		escapeValue: false,
	},
});

export default i18n;
export { fallbackLocale, resolveLocale };
