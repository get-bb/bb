import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  BbDesktopServerAddFailureReason,
  BbDesktopServerListEntry,
  BbDesktopServerStatus,
  BbDesktopServersApi,
} from "@bb/desktop-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Switch } from "@bb/shared-ui/switch";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsBadge,
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { getDesktopServersApi } from "@/lib/bb-desktop";

const SERVERS_SECTION_DESCRIPTION =
  "Servers this desktop app can connect to. The list lives in the desktop app, not on any server.";

const AUTO_CONNECT_LABEL = "Auto-connect to local servers";
const AUTO_CONNECT_DESCRIPTION =
  "When a compatible bb server is already running on this machine, attach to it instead of starting a new one.";

const ADD_FAILURE_MESSAGES: Record<BbDesktopServerAddFailureReason, string> = {
  duplicate: "Already in your list",
  incompatible: "That URL responds but is not a compatible bb server",
  unreachable: "Could not reach a bb server at that URL",
};

interface ServerStatusDisplay {
  dotClass: string;
  label: string;
  textClass: string;
}

function serverStatusDisplay(status: BbDesktopServerStatus): ServerStatusDisplay {
  switch (status) {
    case "connected":
      return {
        label: "Connected",
        dotClass: "bg-success",
        textClass: "text-success",
      };
    case "offline":
      return {
        label: "Offline",
        dotClass: "bg-muted-foreground",
        textClass: "text-muted-foreground",
      };
    case "incompatible":
      return {
        label: "Incompatible",
        dotClass: "bg-destructive",
        textClass: "text-destructive",
      };
    case "unknown":
      return {
        label: "checking…",
        dotClass: "bg-muted-foreground",
        textClass: "text-muted-foreground",
      };
  }
}

function partitionServers(servers: BbDesktopServerListEntry[]): {
  builtin: BbDesktopServerListEntry[];
  connect: BbDesktopServerListEntry[];
  manual: BbDesktopServerListEntry[];
} {
  const builtin: BbDesktopServerListEntry[] = [];
  const connect: BbDesktopServerListEntry[] = [];
  const manual: BbDesktopServerListEntry[] = [];
  for (const server of servers) {
    if (server.source === "builtin") {
      builtin.push(server);
    } else if (server.source === "connect") {
      connect.push(server);
    } else {
      manual.push(server);
    }
  }
  return { builtin, connect, manual };
}

interface ServerRowProps {
  onRemove: (server: BbDesktopServerListEntry) => void;
  onRename: (server: BbDesktopServerListEntry, name: string) => void;
  onSetActive: (server: BbDesktopServerListEntry) => void;
  server: BbDesktopServerListEntry;
}

function ServerRow({ onRemove, onRename, onSetActive, server }: ServerRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(server.name);
  const status = serverStatusDisplay(server.status);
  const canRename = server.source === "manual";
  const canRemove = server.source === "manual";

  function commitRename(): void {
    const trimmed = renameDraft.trim();
    setRenaming(false);
    if (trimmed.length === 0 || trimmed === server.name) {
      setRenameDraft(server.name);
      return;
    }
    onRename(server, trimmed);
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setRenameDraft(server.name);
      setRenaming(false);
    }
  }

  return (
    <div
      className="group flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
      data-testid={`server-row-${server.id}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {renaming && canRename ? (
            <Input
              aria-label={`Rename ${server.name}`}
              autoFocus
              className="h-7 max-w-xs text-xs"
              onBlur={commitRename}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={handleRenameKeyDown}
              value={renameDraft}
            />
          ) : canRename ? (
            <button
              className="min-w-0 truncate text-left text-sm font-medium text-foreground hover:underline"
              onClick={() => {
                setRenameDraft(server.name);
                setRenaming(true);
              }}
              type="button"
            >
              {server.name}
            </button>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {server.name}
            </span>
          )}
          {server.source === "builtin" ? (
            <SettingsBadge>Built-in</SettingsBadge>
          ) : null}
          {server.active ? <SettingsBadge>Active</SettingsBadge> : null}
        </div>
        <p className="truncate font-mono text-xs text-subtle-foreground/75">
          {server.url}
        </p>
        <div className={cn("flex items-center gap-1.5 text-xs", status.textClass)}>
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
          />
          <span>{status.label}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!server.active ? (
          <Button
            aria-label={`Switch to ${server.name}`}
            className="h-7 px-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:pointer-coarse:opacity-100"
            onClick={() => onSetActive(server)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Switch to this server
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            aria-label={`Remove ${server.name}`}
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(server)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Icon name="X" className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ServerGroup({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <section>
      {title !== undefined ? (
        <h3 className="mb-2 text-xs font-medium text-subtle-foreground">
          {title}
        </h3>
      ) : null}
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

interface ServersSettingsSectionContentProps {
  autoConnect: boolean;
  onAdd: (input: { name: string; url: string }) => Promise<string | null>;
  onAutoConnectChange: (enabled: boolean) => void;
  onRemove: (server: BbDesktopServerListEntry) => void;
  onRename: (server: BbDesktopServerListEntry, name: string) => void;
  onSetActive: (server: BbDesktopServerListEntry) => void;
  servers: BbDesktopServerListEntry[];
}

/** Exported for tests that drive the section without the desktop bridge. */
export function ServersSettingsSectionContent({
  autoConnect,
  onAdd,
  onAutoConnectChange,
  onRemove,
  onRename,
  onSetActive,
  servers,
}: ServersSettingsSectionContentProps) {
  const [addUrl, setAddUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const { builtin, connect, manual } = partitionServers(servers);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (adding) return;
    const url = addUrl.trim();
    if (url.length === 0) return;
    setAdding(true);
    setAddError(null);
    try {
      const error = await onAdd({
        name: addName.trim(),
        url,
      });
      if (error !== null) {
        setAddError(error);
        return;
      }
      setAddUrl("");
      setAddName("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <SettingsSection
      description={SERVERS_SECTION_DESCRIPTION}
      title="Servers"
    >
      <div className="space-y-5">
        <div className="space-y-4">
          {builtin.length > 0 ? (
            <ServerGroup>
              {builtin.map((server) => (
                <ServerRow
                  key={server.id}
                  onRemove={onRemove}
                  onRename={onRename}
                  onSetActive={onSetActive}
                  server={server}
                />
              ))}
            </ServerGroup>
          ) : null}
          {connect.length > 0 ? (
            <ServerGroup title="BB Connect — synced from your account">
              {connect.map((server) => (
                <ServerRow
                  key={server.id}
                  onRemove={onRemove}
                  onRename={onRename}
                  onSetActive={onSetActive}
                  server={server}
                />
              ))}
            </ServerGroup>
          ) : null}
          {manual.length > 0 ? (
            <ServerGroup title="Added manually">
              {manual.map((server) => (
                <ServerRow
                  key={server.id}
                  onRemove={onRemove}
                  onRename={onRename}
                  onSetActive={onSetActive}
                  server={server}
                />
              ))}
            </ServerGroup>
          ) : null}
          {servers.length === 0 ? (
            <p className="text-sm text-subtle-foreground">No servers yet.</p>
          ) : null}
        </div>

        <form className="space-y-2.5 border-t border-border pt-4" onSubmit={(event) => {
          void handleAdd(event);
        }}>
          <p className="text-sm font-normal text-foreground">Add server…</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              aria-label="Server URL"
              className="h-7 flex-1 font-mono text-xs"
              disabled={adding}
              onChange={(event) => {
                setAddUrl(event.target.value);
                if (addError !== null) setAddError(null);
              }}
              placeholder="https://bb.example.com"
              required
              type="text"
              value={addUrl}
            />
            <Input
              aria-label="Server name (optional)"
              className="h-7 sm:w-40 text-xs"
              disabled={adding}
              onChange={(event) => setAddName(event.target.value)}
              placeholder="Name (optional)"
              value={addName}
            />
            <Button
              aria-busy={adding}
              className="h-7 shrink-0 px-2.5 text-xs"
              disabled={adding || addUrl.trim().length === 0}
              size="sm"
              type="submit"
              variant="outline"
            >
              {adding ? (
                <Icon name="Spinner" className="size-3.5 animate-spin" />
              ) : null}
              {adding ? "Checking" : "Add"}
            </Button>
          </div>
          {addError !== null ? (
            <p className="text-xs text-destructive" role="alert">
              {addError}
            </p>
          ) : null}
        </form>

        <div className="border-t border-border pt-4">
          <SettingsWithControl
            description={AUTO_CONNECT_DESCRIPTION}
            label={AUTO_CONNECT_LABEL}
          >
            <Switch
              aria-label={AUTO_CONNECT_LABEL}
              checked={autoConnect}
              onCheckedChange={onAutoConnectChange}
            />
          </SettingsWithControl>
        </div>
      </div>
    </SettingsSection>
  );
}

async function addServer(
  api: BbDesktopServersApi,
  input: { name: string; url: string },
): Promise<string | null> {
  const result = await api.add({
    url: input.url,
    ...(input.name.length > 0 ? { name: input.name } : {}),
  });
  if (result.ok) {
    return null;
  }
  return ADD_FAILURE_MESSAGES[result.reason];
}

/**
 * Settings → Servers: desktop multi-server registry. Hidden when
 * `window.bbDesktop.servers` is absent (web build or older shell).
 */
export function ServersSettingsSection() {
  const [serversApi] = useState(getDesktopServersApi);
  const [servers, setServers] = useState<BbDesktopServerListEntry[]>([]);
  const [autoConnect, setAutoConnect] = useState(false);

  useEffect(() => {
    if (serversApi === null) {
      return;
    }
    let cancelled = false;

    void serversApi.list().then((list) => {
      if (!cancelled) setServers(list);
    });
    void serversApi.getAutoConnect().then((value) => {
      if (!cancelled) setAutoConnect(value);
    });
    const unsubscribe = serversApi.onChange((list) => {
      setServers(list);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [serversApi]);

  if (serversApi === null) {
    return null;
  }

  return (
    <ServersSettingsSectionContent
      autoConnect={autoConnect}
      onAdd={(input) => addServer(serversApi, input)}
      onAutoConnectChange={(enabled) => {
        setAutoConnect(enabled);
        void serversApi.setAutoConnect(enabled).catch(() => {
          void serversApi.getAutoConnect().then(setAutoConnect);
        });
      }}
      onRemove={(server) => {
        if (
          !window.confirm(
            `Remove “${server.name}” from your server list?`,
          )
        ) {
          return;
        }
        void serversApi.remove(server.id);
      }}
      onRename={(server, name) => {
        void serversApi.rename(server.id, name);
      }}
      onSetActive={(server) => {
        void serversApi.setActive(server.id);
      }}
      servers={servers}
    />
  );
}

export { ADD_FAILURE_MESSAGES };
