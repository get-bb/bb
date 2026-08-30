import { useState } from "react";
import type { BbDesktopServerOption } from "@bb/desktop-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { useServerTarget } from "@/hooks/useServerTarget";

const HOST_LOCAL_NOTE =
  "Opening files, folders, and terminals always happens on the server you are pointed at, not on this Mac.";

export const CONNECT_HINT_TEXT =
  "Sign in to bb Connect to add your machines automatically.";

const SECTION_DESCRIPTION = "Pick which bb server this app runs from.";

function serverDetail(server: BbDesktopServerOption): string {
  if (server.kind === "builtin") {
    return "Runs on this Mac.";
  }
  return server.url ?? "";
}

export function ConnectionSettingsSection() {
  const {
    busy,
    selectedServer,
    showConnectHint,
    target,
    selectServer,
    setCustomServerUrl,
  } = useServerTarget();
  const [customUrlDraft, setCustomUrlDraft] = useState("");
  const [customUrlError, setCustomUrlError] = useState<string | null>(null);
  const [syncedCustomUrl, setSyncedCustomUrl] = useState<string | null>(null);

  if (target !== null && target.customUrl !== syncedCustomUrl) {
    setSyncedCustomUrl(target.customUrl);
    setCustomUrlDraft(target.customUrl ?? "");
  }

  const submitCustomUrl = () => {
    const trimmed = customUrlDraft.trim();
    setCustomUrlError(null);
    void setCustomServerUrl(trimmed.length === 0 ? null : trimmed).then(
      (accepted) => {
        if (!accepted) {
          setCustomUrlError("Enter a full http:// or https:// address.");
        }
      },
    );
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
              <div className="min-w-0">
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
            </div>
          ))}
        </RadioGroup>

        {showConnectHint ? (
          <p className="text-xs leading-snug text-subtle-foreground">
            {CONNECT_HINT_TEXT}
          </p>
        ) : null}

        <SettingsWithControl
          label="Add a server by address"
          description="Point this app at any bb server. getbb.app addresses sign you in automatically."
          controlPlacement="below"
        >
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={customUrlDraft}
                onChange={(event) => setCustomUrlDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCustomUrl();
                  }
                }}
                placeholder="https://my-mac.getbb.app"
                spellCheck={false}
                aria-label="Server address"
                className="h-8 text-xs"
                disabled={busy}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                disabled={busy}
                onClick={submitCustomUrl}
              >
                {customUrlDraft.trim().length === 0 ? "Clear" : "Use"}
              </Button>
            </div>
            {customUrlError !== null ? (
              <p className="text-xs text-destructive-text">{customUrlError}</p>
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
