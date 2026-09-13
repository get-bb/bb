import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { getSettingsRoutePath } from "@/lib/route-paths";
import {
  MACHINE_SERVER_ACCESS_TITLE,
  machineServerAccessBlockedReason,
} from "./machine-server-access";

export function PluginMachineServerAccessNotice({
  pluginId,
}: {
  pluginId: string;
}) {
  const { providers } = useSystemMachineProviders();
  const access = useSystemConfig().data?.serverAccess;
  const ownsMachineProvider = (providers ?? []).some(
    (provider) => provider.pluginId === pluginId,
  );
  if (!ownsMachineProvider) return null;
  return (
    <MachineServerAccessNoticeContent
      reason={machineServerAccessBlockedReason(access)}
    />
  );
}

export function MachineServerAccessNoticeContent({
  reason,
}: {
  reason: string | null;
}) {
  if (reason === null) return null;
  return (
    <div className="@container w-full">
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 @md:flex-row @md:items-center @md:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon
            name="AlertTriangle"
            className="mt-0.5 size-3.5 shrink-0 text-warning-text"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {MACHINE_SERVER_ACCESS_TITLE}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-subtle-foreground">
              {reason}
            </p>
          </div>
        </div>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="w-full shrink-0 @md:w-auto"
        >
          <Link to={getSettingsRoutePath("machines")}>
            Set up machine access
            <Icon name="ArrowRight" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
