import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk";
import {
  experimental_DetailRow as DetailRow,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useEnvironment as useEnvironment,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useThread as useThread,
  useEnvironmentProviders,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";

const DETAIL_ROW_ICON_CLASS =
  "size-(--bb-detail-row-icon-size) min-h-0 min-w-0 shrink-0 text-subtle-foreground";

export default function EnvironmentRow({
  threadId,
  environment: threadEnvironment,
}: ExperimentalThreadInfoProps) {
  const { environment } = useEnvironment(threadEnvironment?.id ?? "");
  const { thread } = useThread(threadId);
  const environmentProviders = useEnvironmentProviders();
  const { openNewThread } = useSidebarThreadActions();
  if (environment === null || thread === null) return null;
  const provider =
    environment.environmentProviderId === null
      ? null
      : (environmentProviders.providers.find(
          (candidate) => candidate.id === environment.environmentProviderId,
        ) ?? null);
  const showCreateThreadButton =
    environment.hostLifecycle === "active" &&
    environment.status === "ready" &&
    environment.path !== null;
  const machine = environment.host?.named === true ? environment.host : null;
  return (
    <>
      <DetailRow
        label={
          provider !== null ? (
            <span className="flex items-center gap-1.5">
              <ProviderIcon
                providerKind="environment"
                provider={provider}
                fallback="Zap"
                className={DETAIL_ROW_ICON_CLASS}
              />
              <span className="min-w-0 truncate">Environment</span>
            </span>
          ) : (
            "Environment"
          )
        }
        icon={provider !== null ? undefined : "Laptop"}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate" title={environment.label}>
            {environment.label}
          </span>
          {showCreateThreadButton ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="New thread in environment"
                  onClick={() => {
                    openNewThread({
                      projectId: thread.projectId,
                      environmentId: environment.id,
                      experimental_placement: {
                        sectionId: thread.sectionId,
                        pinned: thread.pinnedAt !== null,
                      },
                      focusPrompt: true,
                    });
                  }}
                  className="inline-flex shrink-0 items-center justify-center rounded-md p-0.5 text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground"
                >
                  <Icon
                    name="MessageSquarePlus"
                    className="size-3 shrink-0 max-md:pointer-coarse:size-4"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>New thread in environment</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      </DetailRow>
      {machine !== null ? (
        <DetailRow
          label={
            <span className="flex items-center gap-1.5">
              {machine.machineProvider === null ? (
                <Icon
                  name="Laptop"
                  className={cn("size-3.5 shrink-0", DETAIL_ROW_ICON_CLASS)}
                  aria-hidden
                />
              ) : (
                <ProviderIcon
                  providerKind="machine"
                  provider={machine.machineProvider}
                  fallback="Zap"
                  className={cn("size-3.5 shrink-0", DETAIL_ROW_ICON_CLASS)}
                />
              )}
              <span className="min-w-0 truncate">Machine</span>
            </span>
          }
        >
          <span
            className="flex min-w-0 items-center gap-1"
            title={`${machine.name} (${
              environment.hostLifecycle !== "active"
                ? "unavailable"
                : machine.connected
                  ? "connected"
                  : "offline"
            })`}
          >
            <span className="min-w-0 truncate">{machine.name}</span>
            {machine.connected ||
            environment.hostLifecycle !== "active" ? null : (
              <span className="shrink-0 text-muted-foreground">(offline)</span>
            )}
          </span>
        </DetailRow>
      ) : null}
    </>
  );
}
