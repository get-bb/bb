import { useState } from "react";
import type { BbDesktopServerOption } from "@bb/desktop-contract";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { SettingsSection } from "@/components/ui/settings-section";
import { useServerTarget } from "@/hooks/useServerTarget";

export const CONNECT_HINT_TEXT =
  "Sign in to bb Connect to add your machines automatically.";

export const MANAGE_FROM_THIS_MAC_TEXT = "Manage servers from This Mac.";

const CONNECT_SERVER_NAME = "bb Connect";

const CONNECT_SERVER_DETAIL = "getbb.app";

const SECTION_DESCRIPTION =
  "Pick which bb server this app runs from. Opening files, folders, and terminals always happens on the server you are pointed at.";

const ADD_SERVER_ERROR_TEXT = "Enter a full http:// or https:// address.";

const CARD_CLASS = "flex items-start gap-3 rounded-md border border-border p-3";

function serverDetail(server: BbDesktopServerOption): string {
  if (server.kind === "builtin") {
    return "Runs on this Mac.";
  }
  return server.url ?? "";
}

export function ConnectionSettingsSection() {
  const {
    busy,
    canManageServers,
    connectTrusted,
    showConnectHint,
    target,
    addCustomServer,
    removeCustomServer,
    selectServer,
    setConnectTrusted,
  } = useServerTarget();
  const [nameDraft, setNameDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const managementDisabled = busy || !canManageServers;

  const submitCustomServer = () => {
    if (managementDisabled || urlDraft.trim().length === 0) {
      return;
    }
    setAddError(null);
    void addCustomServer(nameDraft.trim(), urlDraft.trim()).then((accepted) => {
      if (accepted) {
        setNameDraft("");
        setUrlDraft("");
        return;
      }
      setAddError(ADD_SERVER_ERROR_TEXT);
    });
  };

  if (target === null) {
    return (
      <SettingsSection title="Connection" description={SECTION_DESCRIPTION}>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </SettingsSection>
    );
  }

  const builtinServers = target.servers.filter(
    (server) => server.kind === "builtin",
  );
  const otherServers = target.servers.filter(
    (server) => server.kind !== "builtin",
  );

  const renderServerCard = (server: BbDesktopServerOption) => (
    <li key={server.id} className={CARD_CLASS}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-2 text-sm text-foreground">
          {server.name}
          {server.kind === "builtin" ? (
            <Badge variant="outline" className="text-2xs font-normal">
              This device
            </Badge>
          ) : null}
        </p>
        <p className="truncate font-mono text-2xs text-subtle-foreground">
          {serverDetail(server)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {server.selected ? (
          <span className="flex items-center gap-1 text-2xs text-subtle-foreground">
            <Icon name="Check" className="size-3.5" />
            In use
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Use ${server.name}`}
            onClick={() => selectServer(server.id)}
          >
            Use
          </Button>
        )}
        {server.kind === "custom" ? (
          <Button
            type="button"
            variant="outline"
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
    </li>
  );

  return (
    <SettingsSection title="Connection" description={SECTION_DESCRIPTION}>
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <Input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="Name (optional)"
            spellCheck={false}
            aria-label="Server name"
            className="h-8 w-32 shrink-0 text-xs"
            disabled={managementDisabled}
          />
          <Input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCustomServer();
              }
            }}
            placeholder="https://my-mac.getbb.app"
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
        {addError !== null ? (
          <p className="text-2xs text-destructive-text">{addError}</p>
        ) : null}
        <p className="text-2xs text-subtle-foreground">
          {canManageServers
            ? "Point this app at any bb server you trust."
            : MANAGE_FROM_THIS_MAC_TEXT}
        </p>
      </div>

      <ul className="space-y-2 pt-1">
        {builtinServers.map(renderServerCard)}
        {connectTrusted ? (
          <li className={CARD_CLASS}>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-center gap-2 text-sm text-foreground">
                {CONNECT_SERVER_NAME}
                <Badge variant="outline" className="text-2xs font-normal">
                  Default
                </Badge>
              </p>
              <p className="truncate font-mono text-2xs text-subtle-foreground">
                {CONNECT_SERVER_DETAIL}
              </p>
              <p className="text-2xs text-subtle-foreground">
                Keeps your bb Connect machines in this list and signs you in
                automatically.
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Remove ${CONNECT_SERVER_NAME}`}
                disabled={managementDisabled}
                onClick={() => {
                  void setConnectTrusted(false);
                }}
              >
                Remove
              </Button>
            </div>
          </li>
        ) : null}
        {otherServers.map(renderServerCard)}
      </ul>

      {connectTrusted ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          aria-label={`Add ${CONNECT_SERVER_NAME}`}
          disabled={managementDisabled}
          onClick={() => {
            void setConnectTrusted(true);
          }}
        >
          <Icon name="Plus" className="size-3.5" />
          Add {CONNECT_SERVER_NAME}
        </Button>
      )}

      {showConnectHint ? (
        <p className="text-2xs text-subtle-foreground">{CONNECT_HINT_TEXT}</p>
      ) : null}
    </SettingsSection>
  );
}
