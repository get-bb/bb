import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import type {
  InstalledPlugin,
  PluginCatalogInstallPlan,
  PluginCatalogResolvedSource,
  PluginCatalogSearchResult,
} from "@bb/server-contract";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import {
  catalogInstallNeedsSourceConfirmation,
  describeCatalogInstall,
  normalizePluginSourceInput,
  useInstallPlugin,
  usePluginCatalogInstallPlan,
} from "@/data/plugins";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  Button,
  GROUPED_CARD_RADIUS,
  Icon,
  Sheet,
  Spinner,
  Text,
  toast,
  type SheetController,
} from "@/ui";
import { SheetInput } from "../pickers/SheetInput";
import { PluginIcon } from "./ServerSvgIcon";

/**
 * The one-step install confirmation (web AddPluginDialog): either a free
 * source field (`npm:` / `git:` / `path:` / `builtin:`) or a catalog entry
 * pre-filled from Browse, plus the full-trust warning. Third-party listings
 * resolve their real source (tag, commit, npm version) before the button
 * enables, and that resolution rides the install as `confirmedSource`.
 */

type AddPluginTarget =
  | { kind: "source" }
  | { kind: "catalog"; entry: PluginCatalogSearchResult };

interface AddPluginSheetProps {
  controller: SheetController;
  /** Null keeps the (always mounted) sheet inert until a target is picked. */
  target: AddPluginTarget | null;
  onInstalled?: (plugin: InstalledPlugin) => void;
  onDismiss?: () => void;
}

/** A recessed panel inside the sheet (the entry facts, the trust warning). */
function SheetPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { tokens } = useTheme();
  return (
    <View
      className={className}
      style={{
        backgroundColor: tokens.surfaceRecessed,
        borderRadius: GROUPED_CARD_RADIUS,
        borderCurve: "continuous",
      }}
    >
      {children}
    </View>
  );
}

function resolvedSourceRows(
  source: PluginCatalogResolvedSource,
): { label: string; value: string }[] {
  if (source.kind === "npm") {
    return [
      {
        label: "npm package",
        value: `${source.package}@${source.range ?? source.tag ?? "latest"}`,
      },
      ...(source.registry === undefined
        ? []
        : [{ label: "registry", value: source.registry }]),
      ...(source.resolvedVersion === undefined
        ? []
        : [{ label: "resolves to", value: source.resolvedVersion }]),
      ...(source.unresolvedReason === undefined
        ? []
        : [{ label: "not resolved", value: source.unresolvedReason }]),
    ];
  }
  return [
    { label: "repository", value: source.url },
    ...(source.subdir === undefined
      ? []
      : [{ label: "subdirectory", value: source.subdir }]),
    ...(source.ref === undefined ? [] : [{ label: "ref", value: source.ref }]),
    ...(source.range === undefined
      ? []
      : [
          {
            label: "semver range",
            value:
              source.tagPrefix === undefined
                ? source.range
                : `${source.range} (tags ${source.tagPrefix}vX.Y.Z)`,
          },
        ]),
    ...(source.resolvedTag === undefined
      ? []
      : [{ label: "resolves to tag", value: source.resolvedTag }]),
    ...(source.resolvedCommit === undefined
      ? []
      : [{ label: "resolves to commit", value: source.resolvedCommit }]),
    ...(source.unresolvedReason === undefined
      ? []
      : [{ label: "not resolved", value: source.unresolvedReason }]),
  ];
}

function ThirdPartySourceDisclosure({
  plan,
  pending,
  error,
}: {
  plan: PluginCatalogInstallPlan | undefined;
  pending: boolean;
  error: unknown;
}) {
  if (pending) {
    return (
      <View className="flex-row items-center gap-2">
        <Spinner size="small" />
        <Text variant="caption">Resolving the listed source…</Text>
      </View>
    );
  }
  if (error !== null && error !== undefined) {
    return (
      <Text variant="caption" tone="warning" selectable>
        Could not resolve this listing&rsquo;s source:{" "}
        {error instanceof Error ? error.message : String(error)}
      </Text>
    );
  }
  if (plan === undefined || plan.kind !== "marketplace" || plan.official) {
    return null;
  }
  return (
    <View className="gap-1.5">
      <Text variant="caption">
        Listed by {plan.marketplaceDisplayName}, a third-party marketplace that
        BB does not review.
      </Text>
      <View className="flex-row gap-2">
        <Text variant="caption" className="w-28 shrink-0">
          author
        </Text>
        <Text variant="mono" className="min-w-0 flex-1 text-xs" selectable>
          {plan.author.name}
        </Text>
      </View>
      {resolvedSourceRows(plan.resolvedSource).map((row) => (
        <View key={row.label} className="flex-row gap-2">
          <Text variant="caption" className="w-28 shrink-0">
            {row.label}
          </Text>
          <Text variant="mono" className="min-w-0 flex-1 text-xs" selectable>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function FullTrustWarning() {
  const { tokens } = useTheme();
  return (
    <View className="flex-row gap-2 px-1">
      <Icon name="Lock" size={16} color={tokens.warningText} />
      <Text variant="footnote" tone="muted" className="min-w-0 flex-1">
        Plugins run inside the bb server with full trust: they can read your
        data, run commands on your machines, and call the network. Install only
        plugins you trust.
      </Text>
    </View>
  );
}

export function AddPluginSheet({
  controller,
  target,
  onInstalled,
  onDismiss,
}: AddPluginSheetProps) {
  const [sourceText, setSourceText] = useState("");
  const install = useInstallPlugin();
  const entry = target?.kind === "catalog" ? target.entry : null;
  const thirdParty =
    entry !== null &&
    catalogInstallNeedsSourceConfirmation(
      entry,
      CURATED_PLUGIN_MARKETPLACE_NAME,
    );
  const planQuery = usePluginCatalogInstallPlan(
    thirdParty && entry !== null
      ? { entryId: entry.entryId, marketplace: entry.marketplace }
      : null,
  );
  const plan = planQuery.data;
  const directSource =
    target?.kind === "source" ? normalizePluginSourceInput(sourceText) : null;
  const canInstall =
    target !== null &&
    !install.isPending &&
    (entry !== null
      ? !thirdParty || plan?.kind === "marketplace"
      : directSource !== null);

  const submit = () => {
    if (!canInstall) return;
    const args =
      entry !== null
        ? ({
            kind: "catalog",
            entryId: entry.entryId,
            marketplace: entry.marketplace,
            ...(thirdParty && plan?.kind === "marketplace"
              ? { confirmedSource: plan.resolvedSource }
              : {}),
          } as const)
        : ({ kind: "direct", source: directSource ?? "" } as const);
    install.mutate(args, {
      onSuccess: (plugin) => {
        haptic("success");
        toast.success(`${plugin.name ?? plugin.id} installed`);
        setSourceText("");
        controller.dismiss();
        onInstalled?.(plugin);
      },
    });
  };

  return (
    <Sheet
      controller={controller}
      title={
        target === null
          ? undefined
          : entry !== null
            ? `Install ${entry.displayName}?`
            : "Add plugin"
      }
      layout="scroll"
      deferContent={false}
      onDismiss={() => {
        setSourceText("");
        onDismiss?.();
      }}
    >
      <View className="gap-3 px-4 pb-2 pt-1" testID="add-plugin-sheet">
        {target === null ? null : (
          <>
            <Text variant="footnote" tone="muted">
              {entry === null
                ? "Install from npm, a Git repository, or a local path on the server."
                : thirdParty
                  ? "Install this plugin from the source its marketplace lists."
                  : describeCatalogInstall(entry)}
            </Text>
            {entry !== null ? (
              <SheetPanel className="gap-1.5 px-3 py-2.5">
                <View className="flex-row items-center gap-2.5">
                  <PluginIcon
                    iconUrl={entry.iconUrl}
                    icon={entry.icon}
                    size={22}
                  />
                  <Text
                    variant="headline"
                    className="min-w-0 flex-1"
                    numberOfLines={1}
                  >
                    {entry.displayName}
                  </Text>
                  <Text variant="mono" className="text-xs" numberOfLines={1}>
                    {entry.entryId}
                  </Text>
                </View>
                <Text
                  variant="mono"
                  className="text-xs"
                  numberOfLines={1}
                  selectable
                >
                  {entry.source}
                </Text>
                {thirdParty ? (
                  <ThirdPartySourceDisclosure
                    plan={plan}
                    pending={planQuery.isPending}
                    error={planQuery.error}
                  />
                ) : null}
              </SheetPanel>
            ) : (
              <SheetInput
                value={sourceText}
                onChangeText={setSourceText}
                placeholder="npm:@scope/bb-plugin, git:https://…, path:/…"
                mono
                autoCapitalize="none"
                autoFocus
                editable={!install.isPending}
                returnKeyType="go"
                onSubmitEditing={submit}
                testID="add-plugin-source-input"
              />
            )}
            <FullTrustWarning />
            <View className="flex-row justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onPress={controller.dismiss}
                disabled={install.isPending}
              >
                Cancel
              </Button>
              <Button
                onPress={submit}
                disabled={!canInstall}
                loading={install.isPending}
                icon="Download"
                testID="add-plugin-submit"
              >
                Install
              </Button>
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}
