import type { PluginMarketplace } from "@bb/server-contract";
import { Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
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
  confirmDestructive,
  EmptyStatePanel,
  GroupedRow,
  Icon,
  Sheet,
  Skeleton,
  Text,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { SheetInput } from "../pickers/SheetInput";
import { GroupedScreen } from "../settings/GroupedScreen";
import {
  HeaderIconButton,
  ICON_ROW_SEPARATOR_INSET,
  SettingsSection,
} from "../settings/SettingsRows";

const IS_IOS = process.env.EXPO_OS === "ios";

const MARKETPLACES_FOOTER =
  "bb reads plugin catalogs from these marketplaces. Adding one validates and caches its catalog; it never installs, updates, or runs plugin code.";

/**
 * Plugin marketplaces (`/settings/marketplaces`; web Settings →
 * Marketplaces): the list with refresh state, "+" to add one by `https://…
 * manifest`, `git:` or `path:` source, and a per-row action sheet (refresh
 * / remove) on both platforms. Adding installs nothing; removing uninstalls
 * nothing (catalog installs keep running as direct installs).
 */
export function MarketplacesScreen() {
  const list = usePluginMarketplaces();
  const add = useAddMarketplace();
  const refresh = useRefreshMarketplaces();
  const remove = useRemoveMarketplace();
  const addSheet = useSheet();
  const menu = useSheet();
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

  const confirmRemove = (marketplace: PluginMarketplace) =>
    confirmDestructive({
      title: `Remove ${marketplace.displayName}?`,
      message:
        "Plugins installed from it keep running as direct installs; bb just stops reading its catalog.",
      actionLabel: "Remove marketplace",
      onConfirm: () =>
        remove.mutate(
          { name: marketplace.name },
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
    });

  const actionsFor = (marketplace: PluginMarketplace): ActionSheetAction[] => [
    {
      key: "refresh",
      label: "Refresh",
      icon: "RotateCcw",
      onPress: () => refreshOne(marketplace.name),
    },
    ...(marketplace.official
      ? []
      : [
          {
            key: "remove",
            label: "Remove",
            icon: "Trash2" as const,
            destructive: true,
            onPress: () => confirmRemove(marketplace),
          },
        ]),
  ];

  return (
    <>
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel="Add marketplace"
            onPress={addSheet.present}
          />
        </Stack.Toolbar>
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <HeaderIconButton
                icon="Plus"
                accessibilityLabel="Add marketplace"
                onPress={addSheet.present}
                testID="marketplaces-add"
              />
            ),
          }}
        />
      )}
      <GroupedScreen testID="marketplaces-screen">
        <SettingsSection
          title={
            marketplaces.length > 0
              ? `Marketplaces (${marketplaces.length})`
              : "Marketplaces"
          }
          separatorInset={ICON_ROW_SEPARATOR_INSET}
          footnote={MARKETPLACES_FOOTER}
        >
          {list.isPending ? (
            <View className="gap-3 px-4 py-3">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-2/5" />
            </View>
          ) : list.isError ? (
            <View className="gap-3 px-4 py-3">
              <Text variant="footnote" tone="destructive" selectable>
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
              <MarketplaceRow
                key={marketplace.name}
                marketplace={marketplace}
                onOpenMenu={() => {
                  setTarget(marketplace);
                  menu.present();
                }}
              />
            ))
          )}
        </SettingsSection>
        <SettingsSection title="Manage">
          <GroupedRow
            title="Add marketplace"
            subtitle="By manifest URL, git repository, or server path"
            leading="Plus"
            leadingTone="primary"
            trailing="chevron"
            onPress={addSheet.present}
            testID="marketplaces-add-row"
          />
          {marketplaces.length > 0 ? (
            <GroupedRow
              title="Refresh all"
              subtitle="Re-read every marketplace's catalog"
              leading="RotateCcw"
              disabled={refresh.isPending}
              onPress={() => refreshOne(undefined)}
              testID="marketplaces-refresh-all"
            />
          ) : null}
        </SettingsSection>
      </GroupedScreen>

      <Sheet
        controller={addSheet}
        title="Add marketplace"
        layout="scroll"
        deferContent={false}
        onDismiss={() => setSource("")}
      >
        <View className="gap-3 px-4 pb-2 pt-1" testID="add-marketplace-sheet">
          <Text variant="footnote" tone="muted">
            {
              "An https://…/marketplace.json manifest URL, git:<url>[@ref], or path:<dir> on the server."
            }
          </Text>
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
        actions={target ? actionsFor(target) : []}
      />
    </>
  );
}

/**
 * One marketplace: no detail screen, so the row's tap (and long-press)
 * opens its action sheet. A plain row on both platforms: a native
 * pull-down would hide it from VoiceOver.
 */
function MarketplaceRow({
  marketplace,
  onOpenMenu,
}: {
  marketplace: PluginMarketplace;
  onOpenMenu: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <GroupedRow
      title={marketplace.displayName}
      subtitle={describeMarketplace(marketplace)}
      leading={marketplace.official ? "Star" : "PackageReceive"}
      value={marketplace.official ? "Official" : marketplace.sourceKind}
      trailing={
        <View className="flex-row items-center gap-2">
          {marketplace.lastError !== null ? (
            <Icon
              name="AlertTriangle"
              size={16}
              color={tokens.warningText}
              accessibilityLabel="Last refresh failed"
            />
          ) : null}
          <Icon
            name="MoreHorizontal"
            symbol="ellipsis.circle"
            size={IS_IOS ? 20 : 18}
            color={IS_IOS ? tokens.primary : tokens.subtleForeground}
          />
        </View>
      }
      onPress={onOpenMenu}
      onLongPress={onOpenMenu}
      testID={`marketplace-row-${marketplace.name}`}
    />
  );
}
