import { useState } from "react";
import { View } from "react-native";
import { Avatar } from "react-native-paper";
import { initials } from "@/auth/display-name";
import { useAppTheme } from "@/theme";

/**
 * Somebody's photo, with their initials underneath it.
 *
 * The photo is a `googleusercontent.com` request, so it can be slow, blocked or
 * simply unavailable offline. Painting the initials *over* the image and
 * removing them only once it has loaded means a list of people never shows a
 * hole, never shifts layout, and keeps the initials if the request fails.
 */
export function PersonAvatar({
	name,
	photoURL,
	px,
}: {
	name: string;
	photoURL: string | null;
	px: number;
}) {
	const theme = useAppTheme();
	const [photoLoaded, setPhotoLoaded] = useState(false);
	const [photoFailed, setPhotoFailed] = useState(false);
	// Reset in render, not in an effect: swapping photoURL (an account switch)
	// must put the initials back on the very next paint, before the new photo
	// answers, and must clear a failure pinned to the old URL.
	const [prevURL, setPrevURL] = useState(photoURL);
	if (prevURL !== photoURL) {
		setPrevURL(photoURL);
		setPhotoLoaded(false);
		setPhotoFailed(false);
	}

	return (
		<View style={{ width: px, height: px }}>
			{photoURL && !photoFailed ? (
				<Avatar.Image
					size={px}
					source={{ uri: photoURL }}
					onLoad={() => setPhotoLoaded(true)}
					onError={() => setPhotoFailed(true)}
				/>
			) : null}
			{photoLoaded ? null : (
				<Avatar.Text
					size={px}
					label={initials({ displayName: name })}
					style={{
						position: "absolute",
						backgroundColor: theme.colors.primaryContainer,
					}}
					labelStyle={{ color: theme.colors.onPrimaryContainer }}
				/>
			)}
		</View>
	);
}
