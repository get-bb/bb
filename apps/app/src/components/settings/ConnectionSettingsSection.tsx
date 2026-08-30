import { useCallback, useEffect, useState } from "react";
import type {
  BbDesktopApi,
  BbDesktopServerTarget,
} from "@bb/desktop-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

const HOST_LOCAL_NOTE =
  "Opening files, folders, and terminals uses a helper on this Mac (127.0.0.1). While you are pointed at a remote server, those actions apply to that server's host instead of this one.";

function selectedServerId(target: BbDesktopServerTarget): string {
  return target.servers.find((server) => server.selected)?.id ?? "builtin";
}

function serverDetail(
  server: BbDesktopServerTarget["servers"][number],
): string {
  if (server.kind === "builtin") {
    return "The bb server running on this Mac.";
  }
  return server.url ?? "";
}

export function ConnectionSettingsSection() {
  const [desktopApi] = useState<BbDesktopApi | null>(() => getBbDesktopInfo());
  const [target, setTarget] = useState<BbDesktopServerTarget | null>(null);
  const [customUrlDraft, setCustomUrlDraft] = useState("");
  const [customUrlError, setCustomUrlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const getServerTarget = desktopApi?.experimental_getServerTarget;
    const onServerTargetChange = desktopApi?.experimental_onServerTargetChange;
    if (
      desktopApi === null ||
      getServerTarget === undefined ||
      onServerTargetChange === undefined
    ) {
      return;
    }
    let mounted = true;
    const apply = (next: BbDesktopServerTarget) => {
      setTarget(next);
      setCustomUrlDraft(next.customUrl ?? "");
    };
    void getServerTarget
      .call(desktopApi)
      .then((next) => {
        if (mounted && next !== null) {
          apply(next);
        }
      })
      .catch(() => undefined);
    const unsubscribe = onServerTargetChange.call(desktopApi, apply);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [desktopApi]);

  const selectServer = useCallback(
    (serverId: string) => {
      const setServerTarget = desktopApi?.experimental_setServerTarget;
      if (desktopApi === null || setServerTarget === undefined) {
        return;
      }
      setBusy(true);
      void setServerTarget
        .call(desktopApi, serverId)
        .catch(() => undefined)
        .finally(() => setBusy(false));
    },
    [desktopApi],
  );

  const submitCustomUrl = useCallback(() => {
    const setCustomServerUrl = desktopApi?.experimental_setCustomServerUrl;
    if (desktopApi === null || setCustomServerUrl === undefined) {
      return;
    }
    const trimmed = customUrlDraft.trim();
    setCustomUrlError(null);
    setBusy(true);
    void setCustomServerUrl
      .call(desktopApi, trimmed.length === 0 ? null : trimmed)
      .then((accepted) => {
        if (!accepted) {
          setCustomUrlError("Enter a full http:// or https:// server URL.");
        }
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, [customUrlDraft, desktopApi]);

  if (target === null) {
    return (
      <SettingsSection
        title="Connection"
        description="Choose which bb server this app talks to."
      >
        <p className="text-sm text-muted-foreground">Loading...</p>
      </SettingsSection>
    );
  }

  const activeId = selectedServerId(target);

  return (
    <SettingsSection
      title="Connection"
      description="Choose which bb server this app talks to."
    >
      <div className="space-y-5">
        <RadioGroup
          value={activeId}
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

        <SettingsWithControl
          label="Custom server URL"
          description="Point this app at any bb server. getbb.app addresses sign in with your bb Connect account automatically."
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
                aria-label="Custom server URL"
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
