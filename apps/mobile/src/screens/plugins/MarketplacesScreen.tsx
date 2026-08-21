import type { PluginMarketplace } from "@bb/server-contract";
import { Stack } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  describeMarketplace,
  normalizeMarketplaceSourceInput,
  useAddMarketplace,
  usePluginMarketplaces,
  useRefreshMarketplaces,
  useRemoveMarketplace,
} from "@/data/plugins";
import { describeError } from "@/lib/describe-error";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  EmptyStatePanel,
  Icon,
  ListRow,
  Pill,
  Sheet,
  Skeleton,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { SheetInput } from "../pickers/SheetInput";
import { Screen } from "../shell/Screen";
import { SettingsSection } from "./plugin-ui";

/**
 * Plugin marketplaces (`/settings/marketplaces`; web Settings →
 * Marketplaces): the list with refresh state, "+" to add one by `https://…
 * manifest`, `git:` or `path:` source, long-press → refresh / remove. Adding
 * installs nothing; removing uninstalls nothing (catalog installs keep
 * running as direct installs).
 */
export function MarketplacesScreen() {
  const { tokens } = useTheme();
  const list = usePluginMarketplaces();
  const add = useAddMarketplace();
  const refresh = useRefreshMarketplaces();
  const remove = useRemoveMarketplace();
  const addSheet = useSheet();
  const menu = useSheet();
  const confirmRemove = useSheet();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState<PluginMarketplace | null>(null);
  const marketplaces = list.data ?? [];
  const normalizedSource = normalizeMarketplaceSourceInput(source);

  const submitAdd = () => {
    if (normalizedSource === null || add.isPending) return;
    add.mutate(
      { source: normalizedSource },
      {
        onSuccess: (marketplace) => {
          haptic("success");
          setSource("");
          addSheet.dismiss();
          toast.success(`Added ${marketplace.displayName}`, {
            description: `${marketplace.entryCount} plugins listed. Adding a marketplace installs nothing.`,
          });
        },
      },
    );
  };

  const refreshOne = (name: string | undefined) => {
    refresh.mutate(
      { name },
      {
        onSuccess: (results) => {
          const failed = results.filter((result) => !result.ok);
          if (failed.length === 0) {
            toast.success(
              name === undefined
                ? "Marketplaces refreshed"
                : "Marketplace refreshed",
            );
            return;
          }
          toast.error("Refreshing the marketplace failed", {
            description: `${failed[0]?.error ?? "Unknown error"}. The last catalog bb validated is still in use.`,
          });
        },
      },
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add marketplace"
              hitSlop={8}
              onPress={addSheet.present}
              testID="marketplaces-add"
            >
              <Icon name="Plus" size={22} color={tokens.foreground} />
            </Pressable>
          ),
        }}
      />
      <Screen testID="marketplaces-screen">
        <Text variant="caption">
          bb reads plugin catalogs from these marketplaces. Adding one validates
          and caches its catalog; it never installs, updates, or runs plugin
          code.
        </Text>
        <SettingsSection
          title={
            marketplaces.length > 0
              ? `Marketplaces (${marketplaces.length})`
              : "Marketplaces"
          }
        >
          {list.isPending ? (
            <View className="gap-3 px-4 py-3">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-2/5" />
            </View>
          ) : list.isError ? (
            <View className="gap-3 px-4 py-3">
              <Text variant="caption" tone="destructive">
                Could not load marketplaces: {describeError(list.error)}
              </Text>
              <Button
                variant="outline"
                size="sm"
                icon="RotateCcw"
                onPress={() => void list.refetch()}
              >
                Retry
              </Button>
            </View>
          ) : marketplaces.length === 0 ? (
            <View className="px-4 py-4" testID="marketplaces-empty">
              <EmptyStatePanel>No marketplaces registered.</EmptyStatePanel>
            </View>
          ) : (
            marketplaces.map((marketplace) => (
              <ListRow
                key={marketplace.name}
                title={marketplace.displayName}
                subtitle={describeMarketplace(marketplace)}
                leading={marketplace.official ? "Star" : "PackageReceive"}
                trailing={
                  <View className="flex-row items-center gap-2">
                    {marketplace.lastError !== null ? (
                      <Icon
                        name="AlertTriangle"
                        size={16}
                        color={tokens.warningText}
                      />
                    ) : null}
                    {marketplace.official ? (
                      <Pill variant="secondary" size="sm">
                        Official
                      </Pill>
                    ) : (
                      <Pill variant="outline" size="sm">
                        {marketplace.sourceKind}
                      </Pill>
                    )}
                  </View>
                }
                onPress={() => {
                  setTarget(marketplace);
                  menu.present();
                }}
                onLongPress={() => {
                  setTarget(marketplace);
                  haptic("impact-heavy");
                  menu.present();
                }}
                testID={`marketplace-row-${marketplace.name}`}
              />
            ))
          )}
        </SettingsSection>
        <SettingsSection title="Manage">
          <ListRow
            title="Add marketplace"
            subtitle="By manifest URL, git repository, or server path"
            leading="Plus"
            trailing="chevron"
            onPress={addSheet.present}
            testID="marketplaces-add-row"
          />
          {marketplaces.length > 0 ? (
            <ListRow
              title="Refresh all"
              subtitle="Re-read every marketplace's catalog"
              leading="RotateCcw"
              disabled={refresh.isPending}
              onPress={() => refreshOne(undefined)}
              testID="marketplaces-refresh-all"
            />
          ) : null}
        </SettingsSection>
      </Screen>

      <Sheet
        controller={addSheet}
        layout="scroll"
        deferContent={false}
        onDismiss={() => setSource("")}
      >
        <View className="gap-3 px-4 pb-2 pt-1" testID="add-marketplace-sheet">
          <View className="gap-1">
            <Text variant="heading">Add marketplace</Text>
            <Text variant="caption">
              {
                "An https://…/marketplace.json manifest URL, git:<url>[@ref], or path:<dir> on the server."
              }
            </Text>
          </View>
          <SheetInput
            value={source}
            onChangeText={setSource}
            placeholder="https://example.com/marketplace.json"
            mono
            autoCapitalize="none"
            keyboardType="url"
            autoFocus
            editable={!add.isPending}
            returnKeyType="go"
            onSubmitEditing={submitAdd}
            testID="add-marketplace-source-input"
          />
          <View className="flex-row justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onPress={addSheet.dismiss}
              disabled={add.isPending}
            >
              Cancel
            </Button>
            <Button
              onPress={submitAdd}
              disabled={normalizedSource === null}
              loading={add.isPending}
              icon="Plus"
              testID="add-marketplace-submit"
            >
              Add
            </Button>
          </View>
        </View>
      </Sheet>

      <ActionSheet
        controller={menu}
        title={target?.displayName}
        message={
          target
            ? [
                target.description,
                target.source,
                target.lastError !== null
                  ? `Last refresh failed: ${target.lastError}`
                  : null,
              ]
                .filter((part): part is string => !!part)
                .join("\n")
            : undefined
        }
        actions={
          target
            ? [
                {
                  key: "refresh",
                  label: "Refresh",
                  icon: "RotateCcw",
                  onPress: () => refreshOne(target.name),
                },
                ...(target.official
                  ? []
                  : [
                      {
                        key: "remove",
                        label: "Remove",
                        icon: "Trash2" as const,
                        destructive: true,
                        onPress: () => confirmRemove.present(),
                      },
                    ]),
              ]
            : []
        }
      />

      <ActionSheet
        controller={confirmRemove}
        title={target ? `Remove ${target.displayName}?` : undefined}
        message="Plugins installed from it keep running as direct installs; bb just stops reading its catalog."
        actions={
          target
            ? [
                {
                  key: "confirm-remove",
                  label: "Remove marketplace",
                  icon: "Trash2",
                  destructive: true,
                  onPress: () =>
                    remove.mutate(
                      { name: target.name },
                      {
                        onSuccess: (result) => {
                          toast.success("Marketplace removed", {
                            description:
                              result.convertedPluginIds.length === 0
                                ? undefined
                                : `Kept as direct installs: ${result.convertedPluginIds.join(", ")}`,
                          });
                        },
                      },
                    ),
                },
              ]
            : []
        }
      />
    </>
  );
}
