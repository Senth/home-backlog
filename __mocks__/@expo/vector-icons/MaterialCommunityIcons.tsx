import { View } from "react-native";

const actual = jest.requireActual("@expo/vector-icons/MaterialCommunityIcons");

// The real set loads its font asynchronously and warns about act(); this double
// renders the glyph name as the testID and its color as the background.
function MaterialCommunityIcons({
	name,
	color,
}: {
	name: string;
	color?: string;
}) {
	return (
		<View
			testID={name}
			style={color === undefined ? undefined : { backgroundColor: color }}
		/>
	);
}
MaterialCommunityIcons.glyphMap = actual.default.glyphMap as Record<
	string,
	number
>;

export default MaterialCommunityIcons;
