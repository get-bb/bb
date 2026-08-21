import type { PluginCatalogSearchResult } from "@bb/server-contract";
import { useRouter } from "expo-router";
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
  Icon,
  Input,
  ListRow,
  Pill,
  Skeleton,
  Text,
  useSheet,
} from "@/ui";
import { marketplacesHref, pluginDetailHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { AddPluginSheet } from "./AddPluginSheet";
import { SettingsSection } from "./plugin-ui";
import { PluginIcon } from "./ServerSvgIcon";

function entrySubtitle(entry: PluginCatalogSearchResult): string {
  const parts = [entry.category];
  if (!entry.official) parts.push(entry.marketplaceDisplayName);
  if (!entry.compatible) {
    parts.push(entry.incompatibleReason ?? "Incompatible with this bb");
  }
  return parts.join(" · ");
}

/**
 * Plugin catalog browse (`/settings/plugins/browse`; web Extensions →
 * Plugins → Browse): `GET /plugin-catalog/search` grouped by publisher, a
 * search field, installed / incompatible markers, and a tap → install
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
      <Screen testID="plugin-browse-screen">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search plugins"
          autoCapitalize="none"
          clearButtonMode="while-editing"
          testID="plugin-browse-search"
        />
        {search.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </View>
        ) : search.isError ? (
          <View className="gap-3">
            <Text variant="caption" tone="destructive">
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
              {group.entries.map((entry) => (
                <ListRow
                  key={`${entry.marketplace}:${entry.entryId}`}
                  title={entry.displayName}
                  subtitle={entrySubtitle(entry)}
                  leading={
                    <PluginIcon
                      iconUrl={entry.iconUrl}
                      icon={entry.icon}
                      size={22}
                      color={
                        entry.compatible
                          ? tokens.foreground
                          : tokens.subtleForeground
                      }
                    />
                  }
                  trailing={
                    entry.installed ? (
                      <View className="flex-row items-center gap-2">
                        <Pill variant="secondary" size="sm">
                          Installed
                        </Pill>
                        <Icon
                          name="ChevronRight"
                          size={18}
                          color={tokens.subtleForeground}
                        />
                      </View>
                    ) : entry.compatible ? (
                      <Icon
                        name="Download"
                        size={18}
                        color={tokens.foreground}
                      />
                    ) : (
                      <Pill variant="outline" size="sm">
                        Incompatible
                      </Pill>
                    )
                  }
                  disabled={!entry.installed && !entry.compatible}
                  onPress={() => {
                    if (entry.installed) {
                      router.push(pluginDetailHref(entry.pluginId));
                      return;
                    }
                    setTarget(entry);
                    installSheet.present();
                  }}
                  titleLines={1}
                  testID={`plugin-browse-${entry.entryId}`}
                />
              ))}
            </SettingsSection>
          ))
        )}
        <Text variant="caption">
          {marketplaceCount > 0
            ? `Listing ${marketplaceCount} ${marketplaceCount === 1 ? "marketplace" : "marketplaces"}. Plugins run with full trust inside the bb server.`
            : "Plugins run with full trust inside the bb server."}
        </Text>
      </Screen>
      <AddPluginSheet
        controller={installSheet}
        target={target ? { kind: "catalog", entry: target } : null}
        onInstalled={(plugin) => router.push(pluginDetailHref(plugin.id))}
        onDismiss={() => setTarget(null)}
      />
    </>
  );
}
