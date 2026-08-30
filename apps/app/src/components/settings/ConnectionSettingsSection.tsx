import { useState } from "react";
import { Link } from "react-router-dom";
import type { BbDesktopServerOption } from "@bb/desktop-contract";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { SettingsSection } from "@/components/ui/settings-section";
import { useServerTarget } from "@/hooks/useServerTarget";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";

export const MANAGE_FROM_THIS_MAC_TEXT = "Manage servers from This Mac.";

const SECTION_DESCRIPTION =
  "Work on your own Mac, or open a remote bb server in its own window.";

const ADD_SERVER_ERROR_TEXT = "Enter a full http:// or https:// address.";

const ROW_CLASS = "flex items-center gap-3 py-2.5 first:pt-0";

interface ConnectionSettingsSectionProps {
  remoteAccessPluginId: string | null;
}

export function ConnectionSettingsSection({
  remoteAccessPluginId,
}: ConnectionSettingsSectionProps) {
  const {
    busy,
    canManageServers,
    target,
    addCustomServer,
    removeCustomServer,
    selectServer,
  } = useServerTarget();
  const [urlDraft, setUrlDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const managementDisabled = busy || !canManageServers;

  const submitCustomServer = () => {
    if (managementDisabled || urlDraft.trim().length === 0) {
      return;
    }
    setAddError(null);
    void addCustomServer("", urlDraft.trim()).then((accepted) => {
      if (accepted) {
        setUrlDraft("");
        return;
      }
      setAddError(ADD_SERVER_ERROR_TEXT);
    });
  };

  const remoteAccessLink =
    remoteAccessPluginId !== null ? (
      <Link
        to={getPluginConfigurationRoutePath({ pluginId: remoteAccessPluginId })}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Set up remote access
        <Icon name="ArrowUpRight" className="size-3.5" />
      </Link>
    ) : undefined;

  if (target === null) {
    return (
      <SettingsSection title="Connection" description={SECTION_DESCRIPTION}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </SettingsSection>
    );
  }

  const renderServerRow = (server: BbDesktopServerOption) => (
    <div key={server.id} className={ROW_CLASS}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm text-foreground">
          {server.name}
          {server.kind === "builtin" ? (
            <Badge variant="outline" className="text-2xs font-normal">
              This device
            </Badge>
          ) : null}
        </p>
        {server.url !== null ? (
          <p className="truncate font-mono text-2xs text-subtle-foreground">
            {server.url}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {server.selected ? (
          <span className="flex items-center gap-1 text-2xs text-subtle-foreground">
            <Icon name="Check" className="size-3.5" />
            This window
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={managementDisabled}
            aria-label={`Open ${server.name}`}
            onClick={() => selectServer(server.id)}
          >
            Open
          </Button>
        )}
        {server.kind === "custom" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${server.name}`}
            disabled={managementDisabled}
            onClick={() => {
              void removeCustomServer(server.id);
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <SettingsSection
      title="Connection"
      description={SECTION_DESCRIPTION}
      action={remoteAccessLink}
    >
      <div className="divide-y divide-border">
        {target.servers.map(renderServerRow)}
        <div className="flex items-center gap-2 pt-3">
          <Input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCustomServer();
              }
            }}
            placeholder="https://my-machine.getbb.app"
            spellCheck={false}
            aria-label="Server address"
            className="h-8 font-mono text-xs"
            disabled={managementDisabled}
          />
          <Button
            type="button"
            size="sm"
            disabled={managementDisabled || urlDraft.trim().length === 0}
            onClick={submitCustomServer}
          >
            Add
          </Button>
        </div>
      </div>
      {addError !== null ? (
        <p className="pt-1.5 text-2xs text-destructive-text">{addError}</p>
      ) : null}
      {managementDisabled ? (
        <p className="pt-1.5 text-2xs text-subtle-foreground">
          {MANAGE_FROM_THIS_MAC_TEXT}
        </p>
      ) : null}
    </SettingsSection>
  );
}
