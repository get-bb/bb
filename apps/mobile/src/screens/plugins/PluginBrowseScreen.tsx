import type { PluginCatalogSearchResult } from "@bb/server-contract";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  groupCatalogEntries,
  usePluginCatalogSearch,
  usePluginMarketplaces,
} from "@/data/plugins";
import { describeError } from "@/lib/describe-error";
import { useTheme } from "@/theme";
import {
  Button,
  EmptyStatePanel,
  GroupedRow,
  Icon,
  Input,
  Skeleton,
  Text,
  useSheet,
} from "@/ui";
import { GroupedScreen } from "../settings/GroupedScreen";
import { LinkRow } from "../settings/LinkRow";
import { SettingsSection } from "../settings/SettingsRows";
import { marketplacesHref, pluginDetailHref } from "../shell/hrefs";
import { AddPluginSheet } from "./AddPluginSheet";
import { PluginIcon } from "./ServerSvgIcon";

/** Store counts are read at a glance: "1.2k installs", not the exact number. */
const INSTALL_COUNT_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const IS_IOS = process.env.EXPO_OS === "ios";

function entrySubtitle(entry: PluginCatalogSearchResult): string {
  const parts = [entry.category];
  if (!entry.official) parts.push(entry.marketplaceDisplayName);
  // Null for every third-party listing, which publishes no counts.
  if (entry.installs !== null) {
    parts.push(
      `${INSTALL_COUNT_FORMATTER.format(entry.installs)} ${entry.installs === 1 ? "install" : "installs"}`,
    );
  }
  if (!entry.compatible) {
    parts.push(entry.incompatibleReason ?? "Incompatible with this bb");
  }
  return parts.join(" · ");
}

/**
 * Plugin catalog browse (`/settings/plugins/browse`; web Extensions →
 * Plugins → Browse): `GET /plugin-catalog/search` grouped by publisher, a
 * header search bar, installed / incompatible markers, and a tap → install
 * confirmation (or the detail screen when already installed).
 */
export function PluginBrowseScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const [query, setQuery] = useState("");
  const search = usePluginCatalogSearch(query);
  const marketplaces = usePluginMarketplaces();
  const installSheet = useSheet();
  const [target, setTarget] = useState<PluginCatalogSearchResult | null>(null);
  const groups = useMemo(
    () => groupCatalogEntries(search.data ?? []),
    [search.data],
  );
  const marketplaceCount = marketplaces.data?.length ?? 0;

  return (
    <>
      {IS_IOS ? (
        <Stack.SearchBar
          placeholder="Search plugins"
          autoCapitalize="none"
          hideWhenScrolling={false}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      ) : null}
      <GroupedScreen testID="plugin-browse-screen">
        {IS_IOS ? null : (
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search plugins"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            testID="plugin-browse-search"
          />
        )}
        {search.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </View>
        ) : search.isError ? (
          <View className="gap-3">
            <Text variant="footnote" tone="destructive" selectable>
              Could not load the catalog: {describeError(search.error)}
            </Text>
            <Button
              variant="outline"
              icon="RotateCcw"
              onPress={() => void search.refetch()}
            >
              Retry
            </Button>
          </View>
        ) : groups.length === 0 ? (
          <View className="gap-3" testID="plugin-browse-empty">
            <EmptyStatePanel>
              {query.trim().length > 0
                ? `No plugins match “${query.trim()}”.`
                : "The catalog is empty. Refresh your marketplaces or add one."}
            </EmptyStatePanel>
            <Button
              variant="outline"
              icon="PackageReceive"
              onPress={() => router.push(marketplacesHref())}
            >
              Marketplaces
            </Button>
          </View>
        ) : (
          groups.map((group) => (
            <SettingsSection
              key={group.publisherKey}
              title={group.label}
              testID={`plugin-browse-group-${group.publisherKey}`}
            >
              {group.entries.map((entry) => {
                const leading = (
                  <PluginIcon
                    iconUrl={entry.iconUrl}
                    icon={entry.icon}
                    size={20}
                    color={
                      entry.compatible
                        ? tokens.foreground
                        : tokens.subtleForeground
                    }
                  />
                );
                const key = `${entry.marketplace}:${entry.entryId}`;
                if (entry.installed) {
                  return (
                    <LinkRow
                      key={key}
                      href={pluginDetailHref(entry.pluginId)}
                      title={entry.displayName}
                      subtitle={entrySubtitle(entry)}
                      leading={leading}
                      value="Installed"
                      testID={`plugin-browse-${entry.entryId}`}
                    />
                  );
                }
                return (
                  <GroupedRow
                    key={key}
                    title={entry.displayName}
                    subtitle={entrySubtitle(entry)}
                    leading={leading}
                    value={entry.compatible ? undefined : "Incompatible"}
                    trailing={
                      entry.compatible ? (
                        <Icon
                          name="Download"
                          symbol="arrow.down.circle"
                          size={22}
                          color={tokens.primary}
                          accessibilityLabel="Install"
                        />
                      ) : undefined
                    }
                    disabled={!entry.compatible}
                    onPress={() => {
                      setTarget(entry);
                      installSheet.present();
                    }}
                    testID={`plugin-browse-${entry.entryId}`}
                  />
                );
              })}
            </SettingsSection>
          ))
        )}
        <Text variant="footnote" tone="muted" className="px-4">
          {marketplaceCount > 0
            ? `Listing ${marketplaceCount} ${marketplaceCount === 1 ? "marketplace" : "marketplaces"}. Plugins run with full trust inside the bb server.`
            : "Plugins run with full trust inside the bb server."}
        </Text>
      </GroupedScreen>
      <AddPluginSheet
        controller={installSheet}
        target={target ? { kind: "catalog", entry: target } : null}
        onInstalled={(plugin) => router.push(pluginDetailHref(plugin.id))}
        onDismiss={() => setTarget(null)}
      />
    </>
  );
}
