import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { HelperText, TextInput } from "react-native-paper";
import { isHexColor, parseHex, toHex } from "@/models/label-color";

interface ColorFieldProps {
	/** Paper's floating label on the field. */
	label: string;
	/** The colour exactly as picked, `#rgb` or `#rrggbb`. */
	value: string;
	/** Called with the normalised `#rrggbb` once the field holds a real colour. */
	onChange: (color: string) => void;
}

/**
 * The colour field without a platform picker (#100): a validated hex field,
 * until there is a native build to hang `<input type="color">`'s native
 * equivalent on.
 *
 * Every keystroke is only a draft; the parent hears the colour the moment the
 * field holds one, normalised through the same `parseHex`/`toHex` pair the
 * clamp uses, and stored exactly as picked — unclamped, because
 * `models/label-color.ts` clamps at draw time. While the draft is not a
 * colour, the sentence beneath says so and nothing is written.
 */
export function ColorField({ label, value, onChange }: ColorFieldProps) {
	const { t } = useTranslation();
	const [text, setText] = useState(value);

	// A pick made somewhere else in the form — a preset hue, say — re-points
	// the field; a draft that is not a colour yet never triggers this, because
	// it never reaches the parent.
	useEffect(() => setText(value), [value]);

	const commit = (next: string) => {
		setText(next);
		if (isHexColor(next)) onChange(toHex(parseHex(next)));
	};

	return (
		<View>
			<TextInput
				mode="outlined"
				label={label}
				value={text}
				onChangeText={commit}
				autoCapitalize="none"
				autoComplete="off"
			/>
			<HelperText type="error" visible={!isHexColor(text)}>
				{t("labels.colorInvalid")}
			</HelperText>
		</View>
	);
}
