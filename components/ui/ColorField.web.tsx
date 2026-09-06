import { createElement } from "react";
import { parseHex, toHex } from "@/models/label-color";
import { space, touchTarget } from "@/theme/tokens";

interface ColorFieldProps {
	/** The accessible name — a raw `<input>` has no visible label of its own. */
	label: string;
	/** The color exactly as picked, `#rgb` or `#rrggbb`. */
	value: string;
	/** Called with the browser's own `#rrggbb`, stored raw like any other pick. */
	onChange: (color: string) => void;
}

/**
 * The color field on the web (#100): the platform's own `<input type="color">`.
 *
 * The browser has shipped a color picker for a decade; owning a second one in
 * React Native would be bytes spent reproducing it worse. The element is built
 * with `createElement` rather than JSX because the app has no `react-dom`
 * types in scope — this file only ever loads on web, where the host renderer
 * *is* the DOM.
 *
 * The input accepts only the long lowercase form, so the stored value is
 * normalized on the way in through the same `parseHex`/`toHex` pair the clamp
 * uses — one grammar for hex everywhere. What comes back is stored exactly as
 * picked, unclamped: `models/label-color.ts` clamps at draw time.
 */
export function ColorField({ label, value, onChange }: ColorFieldProps) {
	return createElement("input", {
		type: "color",
		"aria-label": label,
		// An unparseable stored value reads as black here, exactly as it does
		// wherever else it is drawn — `parseHex`'s contract.
		value: toHex(parseHex(value)).toLowerCase(),
		onChange: (event: { target: { value: string } }) =>
			onChange(event.target.value),
		style: {
			width: touchTarget,
			height: touchTarget,
			padding: space.none,
			border: "none",
		},
	});
}
