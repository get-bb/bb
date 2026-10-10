import type { Host } from "@bb/domain";
import { Icon, type BuiltinIconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  MachineProviderIcon,
  type MachineProviderPresentation,
} from "@/components/plugin/MachineProviderIcon";

export type MachineLabelHost = Pick<
  Host,
  "machineProviderId" | "name" | "type"
>;

export function resolveMachineIconProvider(
  host: MachineLabelHost,
  machineProvider: MachineProviderPresentation | null | undefined,
): MachineProviderPresentation | null {
  if (host.type !== "ephemeral" || host.machineProviderId === null) {
    return null;
  }
  if (machineProvider?.id === host.machineProviderId) {
    return machineProvider;
  }
  return {
    id: host.machineProviderId,
    displayName: host.machineProviderId,
    icon: "ComputerCloud" satisfies BuiltinIconName,
    logoUrl: null,
  };
}

export function MachineIcon({
  host,
  machineProvider,
  className,
}: {
  host: MachineLabelHost;
  machineProvider?: MachineProviderPresentation | null;
  className?: string;
}) {
  const provider = resolveMachineIconProvider(host, machineProvider);
  if (provider === null) {
    return (
      <Icon
        name="Laptop"
        className={cn("size-3.5 shrink-0", className)}
        aria-hidden
      />
    );
  }
  return (
    <MachineProviderIcon
      provider={provider}
      className={cn("size-3.5 shrink-0", className)}
    />
  );
}

export function MachineLabel({
  host,
  machineProvider,
  className,
  iconClassName,
  nameClassName,
}: {
  host: MachineLabelHost;
  machineProvider?: MachineProviderPresentation | null;
  className?: string;
  iconClassName?: string;
  nameClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <MachineIcon
        host={host}
        machineProvider={machineProvider}
        className={iconClassName}
      />
      <span className={cn("min-w-0 truncate", nameClassName)}>{host.name}</span>
    </span>
  );
}
