/**
 * Copies `text` and reports whether it actually landed. expo-clipboard's web
 * fallback answers `true` even when `execCommand("copy")` refuses, so a denied
 * clipboard looked like a success.
 */
export function copyText(text: string): Promise<boolean> {
	return Promise.resolve()
		.then(() => navigator.clipboard.writeText(text))
		.then(
			() => true,
			() => {
				const field = document.createElement("textarea");
				field.value = text;
				document.body.append(field);
				field.select();
				try {
					return document.execCommand("copy");
				} finally {
					field.remove();
				}
			},
		);
}
