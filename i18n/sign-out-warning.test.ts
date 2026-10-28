import en from "@/i18n/locales/en-US.json";
import sv from "@/i18n/locales/sv-SE.json";

it.each(["one", "other"] as const)(
	"warns pending changes are discarded for %s",
	(plural) => {
		expect(en.outbox[`signOutPending_${plural}`]).toMatch(/discarded/);
		expect(sv.outbox[`signOutPending_${plural}`]).toMatch(/kastas/);
		expect(en.outbox[`signOutPending_${plural}`]).not.toMatch(/sync next time/);
		expect(sv.outbox[`signOutPending_${plural}`]).not.toMatch(/synkas nästa/);
	},
);
