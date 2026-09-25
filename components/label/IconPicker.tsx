import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Appbar, Icon, IconButton, Text, TextInput } from "react-native-paper";
import { iconColumns, searchIcons } from "@/components/label/icon-search";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { SlimFlatList } from "@/components/ui/SlimScrollView";
import { useAppTheme } from "@/theme";
import { icon, radius, size, space, touchTargetStyle } from "@/theme/tokens";

interface IconPickerProps {
	/** The glyph to draw as chosen, if one is. */
	value: string | null;
	/** Choosing closes — a picker opens, is answered, and is gone. */
	onSelect: (name: string) => void;
	onClose: () => void;
}

/**
 * The icon picker (#100): one glyph found out of the 7,448 the app can draw.
 *
 * The search is the way in and the grid is the result. A grid cell is a shape
 * by design — you are choosing how something reads at a glance, and a name
 * under every glyph would be a wall of words — so the names live in the list
 * view behind the app-bar action, which always shows the view you would
 * switch to. The list is also the only way to tell `home`, `home-outline`,
 * `home-variant` and `home-variant-outline` apart.
 *
 * The grid is virtualised (`FlatList`) and the search filters the sorted name
 * list — see `icon-search.ts` — so seven thousand glyphs cost one scroll
 * window, and the result count sits quietly under the field so a narrowed
 * search says what it found.
 */
export function IconPicker({ value, onSelect, onClose }: IconPickerProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { width } = useWindowDimensions();

	const [query, setQuery] = useState("");
	const [list, setList] = useState(false);

	const results = useMemo(() => searchIcons(query), [query]);
	const columns = iconColumns(width);

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<IconButton
					icon="close"
					style={touchTargetStyle}
					accessibilityLabel={t("common.closeDialog")}
					onPress={onClose}
				/>
				<Appbar.Content title={t("labels.iconPickerTitle")} />
				{/* The action names the view it would take you to, so both views
				    are one tap apart in either direction. */}
				<Appbar.Action
					icon={list ? "view-grid-outline" : "format-list-bulleted"}
					style={touchTargetStyle}
					accessibilityLabel={
						list ? t("labels.viewGrid") : t("labels.viewList")
					}
					onPress={() => setList((wasList) => !wasList)}
				/>
			</Appbar.Header>

			<View style={{ flex: 1, padding: space.md, gap: space.sm }}>
				<TextInput
					mode="outlined"
					label={t("labels.searchIcons")}
					value={query}
					onChangeText={setQuery}
					autoFocus
				/>

				<Text
					variant="bodySmall"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("labels.iconCount", { count: results.length })}
				</Text>

				<SlimFlatList
					// `numColumns` may not change on the fly — the key remounts the
					// list when the view or the column count does.
					key={`${list ? "list" : "grid"}-${columns}`}
					data={results}
					numColumns={list ? 1 : columns}
					keyExtractor={(name) => name}
					keyboardShouldPersistTaps="handled"
					columnWrapperStyle={list ? undefined : { gap: space.xs }}
					contentContainerStyle={{ gap: space.xs, paddingBottom: space.md }}
					ListEmptyComponent={
						<Text
							variant="bodyMedium"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("labels.iconSearchEmpty")}
						</Text>
					}
					renderItem={({ item }) =>
						list ? (
							<ListRow
								name={item}
								selected={item === value}
								onPress={() => onSelect(item)}
							/>
						) : (
							<GridCell
								name={item}
								selected={item === value}
								onPress={() => onSelect(item)}
							/>
						)
					}
				/>
			</View>
		</View>
	);
}

interface CellProps {
	name: string;
	selected: boolean;
	onPress: () => void;
}

/** One grid cell: the glyph and nothing else — a shape to choose. */
function GridCell({ name, selected, onPress }: CellProps) {
	const theme = useAppTheme();

	return (
		<Pressable
			accessible
			accessibilityRole="button"
			accessibilityLabel={name}
			accessibilityState={{ selected }}
			onPress={onPress}
			style={{
				...touchTargetStyle,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: radius.sm,
				backgroundColor: selected
					? theme.colors.primaryContainer
					: "transparent",
			}}
		>
			<PaperIcon
				name={name}
				size={icon.md}
				color={
					selected ? theme.colors.onPrimaryContainer : theme.colors.onSurface
				}
			/>
		</Pressable>
	);
}

/** One list row: the glyph in a quiet well, its real name, and the pick mark. */
function ListRow({ name, selected, onPress }: CellProps) {
	const theme = useAppTheme();

	return (
		<Pressable
			accessible
			accessibilityRole="button"
			accessibilityLabel={name}
			accessibilityState={{ selected }}
			onPress={onPress}
			style={{
				minHeight: touchTargetStyle.height,
				flexDirection: "row",
				alignItems: "center",
				gap: space.md,
				paddingVertical: space.xs,
			}}
		>
			<View
				style={{
					width: size.labelDot,
					height: size.labelDot,
					borderRadius: radius.full,
					backgroundColor: theme.colors.surfaceVariant,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<PaperIcon
					name={name}
					size={icon.sm}
					color={theme.colors.onSurfaceVariant}
				/>
			</View>
			<Text variant="bodyMedium" style={{ flexShrink: 1, flex: 1 }}>
				{name}
			</Text>
			{selected ? (
				<Icon source="check" size={icon.sm} color={theme.colors.primary} />
			) : null}
		</Pressable>
	);
}
