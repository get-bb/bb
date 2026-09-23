import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { Switch } from "@bb/shared-ui/switch";
import { BB_CLOUD_DISCLOSURE } from "./src/disclosure.js";
import { formatUsage } from "./src/format.js";
import type { BbAiOverview, bbAiRpcContract } from "./src/server.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accountLine(overview: BbAiOverview): string {
  switch (overview.account.state) {
    case "signed-in":
      return `Signed in as ${overview.account.githubLogin ?? overview.account.name}.`;
    case "signed-out":
      return "Sign in to your bb account to use bb cloud.";
    case "unavailable":
      return "The bb account plugin is not running.";
  }
}

function statusLine(overview: BbAiOverview): string {
  if (!overview.enabled) return "Off. bb sends nothing to bb cloud.";
  return overview.status.ready
    ? "Ready for thread titles and commit messages."
    : overview.status.message;
}

export function BbAiSettings() {
  const rpc = useRpc<typeof bbAiRpcContract>();
  const [overview, setOverview] = useState<BbAiOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    void rpc
      .call("overview", null)
      .then((next) => {
        if (activeRef.current) setOverview(next);
      })
      .catch((loadError: unknown) => {
        if (activeRef.current) setError(errorMessage(loadError));
      });
    return () => {
      activeRef.current = false;
    };
  }, [rpc]);

  function changeEnabled(enabled: boolean): void {
    setSaving(true);
    setError(null);
    void rpc
      .call("setEnabled", { enabled })
      .then((next) => {
        if (activeRef.current) setOverview(next);
      })
      .catch((saveError: unknown) => {
        if (activeRef.current) setError(errorMessage(saveError));
      })
      .finally(() => {
        if (activeRef.current) setSaving(false);
      });
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">Use bb cloud</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {BB_CLOUD_DISCLOSURE}
          </p>
        </div>
        <Switch
          checked={overview?.enabled ?? false}
          disabled={overview === null || saving}
          size="default"
          aria-label="Use bb cloud"
          onCheckedChange={changeEnabled}
        />
      </div>
      {overview === null ? (
        error === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : null
      ) : (
        <>
          <p className="text-foreground">{accountLine(overview)}</p>
          <p className="text-muted-foreground">{statusLine(overview)}</p>
          {overview.usage !== null ? (
            <p className="text-muted-foreground">
              {formatUsage(overview.usage)}
            </p>
          ) : overview.usageError !== null ? (
            <p className="text-muted-foreground">
              Usage unavailable: {overview.usageError}
            </p>
          ) : null}
        </>
      )}
      {error !== null ? (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Choose which tasks use bb cloud in Settings → AI services.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "bb-cloud",
    component: BbAiSettings,
  });
});
