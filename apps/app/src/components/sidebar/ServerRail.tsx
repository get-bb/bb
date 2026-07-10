import { useEffect, useState } from "react";
import type { BbDesktopServerListEntry } from "@bb/desktop-contract";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { Link } from "react-router-dom";
import { getDesktopServersApi } from "@/lib/bb-desktop";

const STATUS_LABELS: Record<BbDesktopServerListEntry["status"], string> = {
  connected: "Connected",
  offline: "Offline",
  incompatible: "Incompatible",
  unknown: "Checking…",
};

function tileGlyph(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? "?" : first.toUpperCase();
}

function ServerTile({ server }: { server: BbDesktopServerListEntry }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`server-rail-tile-${server.id}`}
          aria-label={`Switch to ${server.name}`}
          aria-current={server.active ? "true" : undefined}
          className={cn(
            "relative flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
            server.active
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
          onClick={() => {
            if (server.active) {
              return;
            }
            void getDesktopServersApi()?.setActive(server.id);
          }}
        >
          <span aria-hidden="true">{tileGlyph(server.name)}</span>
          {/* Status stays quiet unless something is wrong. */}
          {server.status === "offline" || server.status === "incompatible" ? (
            <span
              data-testid={`server-rail-status-${server.id}`}
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-sidebar",
                server.status === "offline"
                  ? "bg-muted-foreground"
                  : "bg-destructive",
              )}
            />
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <div className="font-medium">{server.name}</div>
        <div className="text-muted-foreground">
          {server.url} · {STATUS_LABELS[server.status]}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Slim server-switcher column inside the sidebar panel (below the chrome
 * row), shown only when the desktop registry has two or more servers. It
 * collapses with the sidebar by construction. Older desktop shells and the
 * web build have no `bbDesktop.servers`, so this renders nothing there.
 */
export function ServerRail() {
  const [serversApi] = useState(getDesktopServersApi);
  const [servers, setServers] = useState<BbDesktopServerListEntry[]>([]);

  useEffect(() => {
    if (serversApi === null) {
      return;
    }
    let cancelled = false;
    void serversApi.list().then((list) => {
      if (!cancelled) setServers(list);
    });
    const unsubscribe = serversApi.onChange(setServers);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [serversApi]);

  if (serversApi === null || servers.length < 2) {
    return null;
  }

  return (
    <div
      data-testid="app-server-rail"
      className="flex w-12 shrink-0 flex-col items-center gap-1.5 overflow-y-auto pb-2 pt-1"
    >
      {servers.map((server) => (
        <ServerTile key={server.id} server={server} />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/settings/servers"
            data-testid="server-rail-add"
            aria-label="Add server"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <Icon name="Plus" className="size-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Add server</TooltipContent>
      </Tooltip>
    </div>
  );
}
