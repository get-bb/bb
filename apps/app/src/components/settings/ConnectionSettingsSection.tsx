import { useState } from "react";
import type { BbDesktopServerOption } from "@bb/desktop-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import { Switch } from "@bb/shared-ui/switch";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { useServerTarget } from "@/hooks/useServerTarget";

const HOST_LOCAL_NOTE =
  "Opening files, folders, and terminals always happens on the server you are pointed at, not on this Mac.";

export const CONNECT_HINT_TEXT =
  "Sign in to bb Connect to add your machines automatically.";

export const MANAGE_FROM_THIS_MAC_TEXT = "Manage servers from This Mac.";

const SECTION_DESCRIPTION = "Pick which bb server this app runs from.";

const ADD_SERVER_ERROR_TEXT = "Enter a full http:// or https:// address.";

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
    selectedServer,
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

  return (
    <SettingsSection title="Connection" description={SECTION_DESCRIPTION}>
      <div className="space-y-5">
        <RadioGroup
          value={selectedServer?.id ?? "builtin"}
          onValueChange={selectServer}
          disabled={busy}
          className="gap-3"
        >
          {target.servers.map((server) => (
            <div key={server.id} className="flex items-start gap-3">
              <RadioGroupItem
                value={server.id}
                id={`connection-server-${server.id}`}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <Label
                  htmlFor={`connection-server-${server.id}`}
                  className="text-sm font-normal text-foreground"
                >
                  {server.name}
                </Label>
                <p className="mt-0.5 break-all text-xs leading-snug text-subtle-foreground/75">
                  {serverDetail(server)}
                </p>
              </div>
              {server.kind === "custom" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-7 shrink-0 p-0"
                  aria-label={`Remove ${server.name}`}
                  disabled={managementDisabled}
                  onClick={() => {
                    void removeCustomServer(server.id);
                  }}
                >
                  <Icon name="Trash2" className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </RadioGroup>

        {showConnectHint ? (
          <p className="text-xs leading-snug text-subtle-foreground">
            {CONNECT_HINT_TEXT}
          </p>
        ) : null}

        <SettingsWithControl
          label="Trust bb Connect (getbb.app)"
          description="Keeps your bb Connect machines in this list and signs you in to them automatically."
        >
          <Switch
            checked={connectTrusted}
            disabled={managementDisabled}
            aria-label="Trust bb Connect"
            onCheckedChange={(checked) => {
              void setConnectTrusted(checked);
            }}
          />
        </SettingsWithControl>

        <SettingsWithControl
          label="Add a server"
          description="Point this app at any bb server you trust. Name is optional."
          controlPlacement="below"
        >
          <div className="space-y-2">
            <div className="flex gap-2">
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
                className="h-8 text-xs"
                disabled={managementDisabled}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                disabled={managementDisabled || urlDraft.trim().length === 0}
                onClick={submitCustomServer}
              >
                Add
              </Button>
            </div>
            {addError !== null ? (
              <p className="text-xs text-destructive-text">{addError}</p>
            ) : null}
            {!canManageServers ? (
              <p className="text-xs leading-snug text-subtle-foreground">
                {MANAGE_FROM_THIS_MAC_TEXT}
              </p>
            ) : null}
          </div>
        </SettingsWithControl>

        <div className="flex gap-2 rounded-md border border-border bg-surface-recessed px-3 py-2">
          <Icon
            name="Info"
            className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground"
          />
          <p className="text-xs leading-snug text-subtle-foreground">
            {HOST_LOCAL_NOTE}
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
