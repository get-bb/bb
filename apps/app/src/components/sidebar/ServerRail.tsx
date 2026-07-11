import type { CSSProperties } from "react";
import type { BbDesktopServerListEntry } from "@bb/desktop-contract";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { Link } from "react-router-dom";
import { getDesktopServersApi } from "@/lib/bb-desktop";
import { FAVICON_COLOR_VALUES } from "@/lib/favicon-color-preference";
import { ServerTileIcon } from "@/lib/server-tile-icons";
import {
  resolveServerTileColor,
  resolveServerTileIcon,
} from "@/lib/server-tile-style";
import { useDesktopServerList } from "@/hooks/useDesktopServerList";

/**
 * Rail column width (w-12). AppLayout widens --sidebar-width by this amount
 * while the rail is visible so the sidebar content keeps its full width.
 */
export const SERVER_RAIL_WIDTH_PX = 48;

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
  const icon = resolveServerTileIcon(server.icon);
  const color = resolveServerTileColor(server.color);
  const colorHex = color === null ? undefined : FAVICON_COLOR_VALUES[color];
  const glyphStyle: CSSProperties | undefined =
    colorHex === undefined ? undefined : { color: colorHex };
  const activeBackgroundStyle: CSSProperties | undefined =
    server.active && colorHex !== undefined
      ? {
          backgroundColor: `color-mix(in oklab, ${colorHex} 18%, transparent)`,
        }
      : undefined;
  const hasConnectivityProblem =
    server.status === "offline" || server.status === "incompatible";
  const showsAttention =
    !server.active && !hasConnectivityProblem && server.hasAttention === true;

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
              ? colorHex === undefined
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
          style={activeBackgroundStyle}
          onClick={() => {
            if (server.active) {
              return;
            }
            void getDesktopServersApi()?.setActive(server.id);
          }}
        >
          {icon !== null ? (
            <span aria-hidden="true" className="flex" style={glyphStyle}>
              <ServerTileIcon name={icon} className="size-4" />
            </span>
          ) : (
            <span aria-hidden="true" style={glyphStyle}>
              {tileGlyph(server.name)}
            </span>
          )}
          {/* Connectivity problems take precedence over work attention. */}
          {hasConnectivityProblem || showsAttention ? (
            <span
              data-testid={
                hasConnectivityProblem
                  ? `server-rail-status-${server.id}`
                  : `server-rail-attention-${server.id}`
              }
              className={cn(
                "absolute right-1.5 top-1.5 size-1.5 rounded-full ring-2 ring-sidebar",
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
        <div className="text-inherit">
          {server.url} · {STATUS_LABELS[server.status]}
          {showsAttention ? " · Needs attention" : null}
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
  const servers = useDesktopServerList();

  if (servers.length < 2) {
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
