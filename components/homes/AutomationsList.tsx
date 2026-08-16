import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { Row } from "@/components/ui/Row";
import { useApiClients } from "@/hooks/use-api-clients";
import { formatElapsed } from "@/models/relative-time";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface AutomationsListProps {
	homeId: string;
}

/**
 * What has written into this home that was not a person.
 *
 * Read-only, with no action of any kind on a row — and that is the honest shape,
 * not a missing feature. An API key belongs to the person who made it and only
 * they can revoke it, so a control here would either not work or would suggest
 * an authority this screen does not have.
 *
 * It exists because of a cost the feature pays deliberately. A key reaches every
 * home its owner is a member of, so somebody's agent can write into a home whose
 * owner has no way to revoke it. Two things answer that, and this is one of
 * them: the other is the mark on every node an agent writes. The owner cannot
 * revoke the key, but she can see that it exists, see which of her cards it
 * wrote, and ask. That is the same shape as membership itself, which she also
 * cannot unilaterally undo.
 *
 * Derived from writes rather than grants, because there are no grants to list —
 * "who could write here" is just "every member", which says nothing.
 */
export function AutomationsList({ homeId }: AutomationsListProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const { clients } = useApiClients(homeId);

	return (
		<View style={{ gap: space.sm }}>
			<Text variant="titleMedium">{t("manageHome.automations.title")}</Text>

			{clients.length === 0 ? (
				<Text
					variant="bodyMedium"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("manageHome.automations.empty")}
				</Text>
			) : (
				<View>
					{clients.map((client) => (
						<Row
							key={client.id}
							// The owner first: whose automation this is is the question a
							// household asks, and the key's own name is the answer to "which
							// one".
							title={`${client.ownerName} · ${client.name}`}
							description={
								client.lastUsedAt
									? formatElapsed(
											client.lastUsedAt.toDate(),
											new Date(),
											i18n.language,
										)
									: undefined
							}
						/>
					))}
				</View>
			)}
		</View>
	);
}
