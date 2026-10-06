import { machineRemovalLabels } from "./machine-removal-display";
import type { Host } from "@bb/domain";
import type {
  EnvironmentDisplayInfo,
  EnvironmentDisplayProviderLookup,
} from "@bb/core-ui";
import { resolveEnvironmentDisplayProvider } from "@bb/core-ui";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import type { IconName } from "@bb/shared-ui/icon";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { PersistentHostIconName } from "@/lib/host-display";
import type { MachineLabelHost } from "@/components/machines/MachineLabel";
import type { MachineProviderPresentation } from "@/components/plugin/MachineProviderIcon";

export type EnvironmentWorkspaceDisplayProviderLookup =
  | { status: "loading" }
  | {
      status: "loaded";
      provider: SystemEnvironmentProvider | null;
      environmentProviderId: string | null;
    };

export type EnvironmentSummaryChromeHost = MachineLabelHost;

export const UNNAMED_ENVIRONMENT_LABEL = "Environment";
export const REUSE_ENVIRONMENT_ICON_NAME: IconName = "Folder02";

export function isHostAmbiguous(
  hasMultipleMachines: boolean,
  hostType: Host["type"] | null,
): boolean {
  return hasMultipleMachines || hostType !== "persistent";
}

interface EnvironmentWorkspaceLabelArgs {
  display: EnvironmentDisplayInfo;
  providerLookup: EnvironmentWorkspaceDisplayProviderLookup;
}

interface EnvironmentWorkspaceSummaryDisplayArgs extends EnvironmentWorkspaceLabelArgs {
  hostType: Host["type"] | null;
  hasMultipleMachines: boolean;
  hostName: string | null;
}

interface EnvironmentWorkspaceSummaryDisplay {
  label: string;
  compactLabel: string;
  icon: IconName;
  providerName: string | null;
}

interface EnvironmentWorkspaceLabelWithLocalityArgs extends EnvironmentWorkspaceLabelArgs {
  locality: "local" | "remote";
}

interface EnvironmentWorkspaceInfoDisplayArgs extends EnvironmentWorkspaceLabelWithLocalityArgs {
  hostName: string | null;
}

interface EnvironmentWorkspaceInfoDisplay {
  label: string;
  icon: IconName;
  machineName: string | null;
}

export function findEnvironmentDisplayProvider(
  providers: readonly SystemEnvironmentProvider[] | undefined,
  environmentProviderId: string | null,
): EnvironmentWorkspaceDisplayProviderLookup {
  if (environmentProviderId === null) {
    return { status: "loaded", provider: null, environmentProviderId: null };
  }
  if (providers === undefined) {
    return { status: "loading" };
  }
  return {
    status: "loaded",
    environmentProviderId,
    provider:
      providers.find((candidate) => candidate.id === environmentProviderId) ??
      null,
  };
}

export function getEnvironmentProviderDisplayName(
  providerLookup: EnvironmentWorkspaceDisplayProviderLookup,
): string | null {
  if (providerLookup.status === "loading") return null;
  if (providerLookup.provider !== null) {
    return providerLookup.provider.displayName;
  }
  return providerLookup.environmentProviderId === null
    ? null
    : `${providerLookup.environmentProviderId} (not installed)`;
}

function getEnvironmentWorkspaceLabel({
  display,
  providerLookup,
  locality,
}: EnvironmentWorkspaceLabelWithLocalityArgs): string {
  if (display.lifecycle === "provisioning") return "Provisioning";
  if (display.lifecycle === "removed") return "Unavailable — machine removed";
  if (
    display.lifecycle === "removing" ||
    display.lifecycle === "cleanup-failed"
  )
    return machineRemovalLabels[display.lifecycle];
  if (display.lifecycle === "destroyed") return "Environment unavailable";
  return (
    getEnvironmentProviderDisplayName(providerLookup) ??
    (locality === "remote" ? "Remote" : "Local")
  );
}

export function getEnvironmentWorkspaceSummaryDisplay({
  display,
  providerLookup,
  hasMultipleMachines,
  hostType,
  hostName,
}: EnvironmentWorkspaceSummaryDisplayArgs): EnvironmentWorkspaceSummaryDisplay | null {
  if (display.lifecycle === "provisioning") {
    return {
      label: "Provisioning",
      compactLabel: "Provisioning",
      icon: "Loading",
      providerName: null,
    };
  }
  if (
    display.lifecycle === "destroyed" ||
    display.lifecycle === "removed" ||
    display.lifecycle === "removing" ||
    display.lifecycle === "cleanup-failed"
  ) {
    const label = getEnvironmentWorkspaceLabel({
      display,
      providerLookup,
      locality: "remote",
    });
    return {
      label,
      compactLabel: label,
      icon: getEnvironmentLabelIconName(providerLookup),
      providerName: getEnvironmentProviderDisplayName(providerLookup),
    };
  }
  if (providerLookup.status === "loading") {
    return null;
  }
  if (isHostAmbiguous(hasMultipleMachines, hostType) && hostName !== null) {
    return {
      label: hostName,
      compactLabel: hostName,
      icon: getEnvironmentLabelIconName(providerLookup),
      providerName: getEnvironmentProviderDisplayName(providerLookup),
    };
  }
  const providerDisplayName = getEnvironmentProviderDisplayName(providerLookup);
  return providerDisplayName === null
    ? null
    : {
        label: providerDisplayName,
        compactLabel: providerDisplayName,
        icon: getEnvironmentLabelIconName(providerLookup),
        providerName: getEnvironmentProviderDisplayName(providerLookup),
      };
}

export function getEnvironmentWorkspaceInfoDisplay({
  display,
  providerLookup,
  hostName,
  locality,
}: EnvironmentWorkspaceInfoDisplayArgs): EnvironmentWorkspaceInfoDisplay {
  return {
    label: getEnvironmentWorkspaceLabel({
      display,
      providerLookup,
      locality,
    }),
    icon: getEnvironmentLabelIconName(providerLookup),
    machineName: hostName,
  };
}

export function getEnvironmentDisplayIconName(
  providerLookup: EnvironmentDisplayProviderLookup,
): IconName | null {
  const provider = resolveEnvironmentDisplayProvider(providerLookup);
  return provider === null ? null : pluginIconName(provider.icon);
}

export function getEnvironmentLabelIconName(
  providerLookup: EnvironmentDisplayProviderLookup,
): IconName {
  return (
    getEnvironmentDisplayIconName(providerLookup) ?? PersistentHostIconName
  );
}

interface EnvironmentSummaryChromeArgs extends EnvironmentWorkspaceLabelArgs {
  hasMultipleMachines: boolean;
  host: EnvironmentSummaryChromeHost | null;
  machineProviders: readonly MachineProviderPresentation[] | undefined;
}

interface EnvironmentSummaryChrome {
  environmentLabel: string | undefined;
  environmentCompactLabel: string | undefined;
  environmentIcon: IconName | undefined;
  environmentProviderName: string | undefined;
  environmentHost: EnvironmentSummaryChromeHost | undefined;
  environmentMachineProvider: MachineProviderPresentation | undefined;
}

export function getEnvironmentSummaryChrome({
  display,
  providerLookup,
  hasMultipleMachines,
  host,
  machineProviders,
}: EnvironmentSummaryChromeArgs): EnvironmentSummaryChrome {
  const summary = getEnvironmentWorkspaceSummaryDisplay({
    display,
    providerLookup,
    hasMultipleMachines,
    hostName: host?.name ?? null,
    hostType: host?.type ?? null,
  });
  const summaryHost =
    host !== null && summary?.label === host.name
      ? host
      : undefined;
  return {
    environmentLabel: summary?.label,
    environmentCompactLabel: summary?.compactLabel,
    environmentIcon: summary?.icon,
    environmentProviderName: summary?.providerName ?? undefined,
    environmentHost: summaryHost,
    environmentMachineProvider: machineProviders?.find(
      (provider) => provider.id === summaryHost?.machineProviderId,
    ),
  };
}
