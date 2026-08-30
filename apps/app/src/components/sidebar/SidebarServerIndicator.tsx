import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { cn } from "@bb/shared-ui/lib/utils";
import type { WebSocketConnectionState } from "@/lib/ws";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useServerTarget } from "@/hooks/useServerTarget";

const STATUS_DOT_CLASS: Record<WebSocketConnectionState, string> = {
  connected: "bg-success",
  connecting: "bg-warning",
  reconnecting: "bg-destructive",
};

const STATUS_LABEL: Record<WebSocketConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting",
  reconnecting: "Unreachable",
};

export const SIDEBAR_SERVER_INDICATOR_TEST_ID = "sidebar-server-indicator";

export function SidebarServerIndicator() {
  const remoteUiEnabled =
    useSystemConfig().data?.experiments.remoteUi ?? false;
  const { available, busy, selectedServer, showConnectHint, target, selectServer } =
    useServerTarget();
  const connectionState = useServerConnectionState();
  const [open, setOpen] = useState(false);

  if (!remoteUiEnabled || !available || target === null) {
    return null;
  }

  const isLocal = selectedServer === null || selectedServer.kind === "builtin";
  const label = isLocal ? "This Mac" : selectedServer.name;
  const statusLabel = STATUS_LABEL[connectionState];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Server: ${label} (${statusLabel})`}
        data-testid={SIDEBAR_SERVER_INDICATOR_TEST_ID}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 rounded border border-border",
          "bg-background px-1.5 py-0.5 text-xs text-muted-foreground",
          "hover:text-sidebar-foreground",
        )}
      >
        <Icon
          name={isLocal ? "Monitor" : "Cloud"}
          className="size-3.5 shrink-0 opacity-80"
        />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            STATUS_DOT_CLASS[connectionState],
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-56 p-1"
        mobileTitle="Server"
      >
        {target.servers.map((server) => (
          <button
            key={server.id}
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              selectServer(server.id);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
              "hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
            )}
          >
            <Icon
              name={server.kind === "builtin" ? "Monitor" : "Cloud"}
              className="size-3.5 shrink-0 opacity-80"
            />
            <span className="min-w-0 flex-1 truncate">{server.name}</span>
            {server.selected ? (
              <Icon name="Check" className="size-3.5 shrink-0" />
            ) : null}
          </button>
        ))}
        {showConnectHint ? (
          <p className="px-2 py-1.5 text-xs leading-snug text-subtle-foreground">
            Sign in to bb Connect to add your machines automatically.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
