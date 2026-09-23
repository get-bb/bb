import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { formatUsage } from "./src/format.js";
import type { BbAiOverview, bbAiRpcContract } from "./src/server.js";

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

export function BbAiSettings() {
  const rpc = useRpc<typeof bbAiRpcContract>();
  const [overview, setOverview] = useState<BbAiOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call("overview", null)
      .then((next) => {
        if (active) setOverview(next);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  return (
    <div className="space-y-3 text-sm">
      {error !== null ? (
        <p className="text-destructive">{error}</p>
      ) : overview === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="text-foreground">{accountLine(overview)}</p>
          <p className="text-muted-foreground">
            {overview.status.ready
              ? "Ready for thread titles and commit messages."
              : overview.status.message}
          </p>
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
      <p className="text-xs text-muted-foreground">
        When a task uses bb cloud, its prompt (the start of a thread, or the
        diff for a commit) goes to getbb.app, which forwards it to OpenRouter
        model providers that keep no data. bb stores usage totals, never
        prompts. Choose which tasks use bb cloud in Settings → AI services.
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
