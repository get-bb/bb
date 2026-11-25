import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useRpc,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SettingsList,
  SettingsListItem,
  SettingsListMessage,
} from "@/components/ui/settings-section";
import type { acpRegistryRpcContract } from "./src/registry-service.js";

type RegistryView = StandardSchemaV1InferOutput<
  (typeof acpRegistryRpcContract)["listRegistry"]["output"]
>;
type RegistryAgent = RegistryView["agents"][number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STATUS_BADGES: Partial<Record<RegistryAgent["status"], string>> = {
  added: "Added",
  "update-available": "Update available",
  "built-in": "Built in",
  "manual-install": "Manual install",
};

function matchesQuery(agent: RegistryAgent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    [agent.id, agent.name, agent.description, ...agent.authors].some((text) =>
      text.toLowerCase().includes(needle),
    )
  );
}

function agentNote(agent: RegistryAgent): string | null {
  if (agent.status === "built-in") {
    return "bb already ships this agent as a provider.";
  }
  if (agent.status === "manual-install") {
    return "Ships only as a downloadable binary. Install it yourself, then add it under Custom agents with its command.";
  }
  return agent.command === null ? null : `Runs ${agent.command}`;
}

function AcpRegistrySettings() {
  const rpc = useRpc<typeof acpRegistryRpcContract>();
  const [view, setView] = useState<RegistryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("load");
  const [query, setQuery] = useState("");
  const activeRef = useRef(true);

  const settle = useCallback((request: Promise<RegistryView>): void => {
    void request
      .then((next) => {
        if (activeRef.current) setView(next);
      })
      .catch((requestError: unknown) => {
        if (activeRef.current) setError(errorMessage(requestError));
      })
      .finally(() => {
        if (activeRef.current) setBusy(null);
      });
  }, []);

  const run = useCallback(
    (key: string, request: () => Promise<RegistryView>): void => {
      setBusy(key);
      setError(null);
      settle(request());
    },
    [settle],
  );

  useEffect(() => {
    activeRef.current = true;
    settle(rpc.call("listRegistry", { refresh: false }));
    return () => {
      activeRef.current = false;
    };
  }, [rpc, settle]);

  const agents = useMemo(
    () => (view?.agents ?? []).filter((agent) => matchesQuery(agent, query)),
    [query, view],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={query}
          placeholder="Search agents"
          aria-label="Search agents"
          className="min-w-0 flex-1"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            run("refresh", () => rpc.call("listRegistry", { refresh: true }))
          }
        >
          {busy === "refresh" ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <SettingsList label="Agents">
        {view === null ? (
          <SettingsListMessage>
            {error === null ? "Loading the registry…" : "No agents to show."}
          </SettingsListMessage>
        ) : agents.length === 0 ? (
          <SettingsListMessage>
            {view.agents.length === 0
              ? "No agents to show."
              : "No agent matches that search."}
          </SettingsListMessage>
        ) : (
          agents.map((agent) => {
            const badge = STATUS_BADGES[agent.status];
            const note = agentNote(agent);
            const canAdd =
              agent.status === "available" ||
              agent.status === "update-available";
            const canRemove =
              agent.status === "added" || agent.status === "update-available";
            return (
              <SettingsListItem
                key={agent.id}
                leading={
                  <Icon
                    name={agent.icon ?? "Toolbox"}
                    className="size-4 text-muted-foreground"
                  />
                }
                title={agent.name}
                badge={badge}
                meta={[agent.version]}
                description={
                  agent.description === "" && note === null ? undefined : (
                    <>
                      {agent.description === "" ? null : (
                        <span className="block">{agent.description}</span>
                      )}
                      {note === null ? null : (
                        <span className="block break-all">{note}</span>
                      )}
                    </>
                  )
                }
                control={
                  <>
                    {canAdd ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        aria-label={`${agent.status === "available" ? "Add" : "Update"} ${agent.name}`}
                        onClick={() =>
                          run(agent.id, () =>
                            rpc.call("addRegistryAgent", { id: agent.id }),
                          )
                        }
                      >
                        {agent.status === "available" ? "Add" : "Update"}
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        aria-label={`Remove ${agent.name}`}
                        onClick={() =>
                          run(agent.id, () =>
                            rpc.call("removeAgent", { id: agent.id }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </>
                }
              />
            );
          })
        )}
      </SettingsList>

      <div className="flex min-h-5 justify-end" aria-live="polite">
        {error !== null ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : view?.error != null ? (
          <span className="text-xs text-muted-foreground" role="status">
            {view.agents.length === 0
              ? `The registry could not be reached: ${view.error}`
              : `Showing a saved copy. The registry could not be reached: ${view.error}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "registry",
    title: "Agent registry",
    description:
      "Agents from the official ACP registry. Adding one makes it a provider in the thread composer; it runs through npx or uvx on the machine that hosts the thread.",
    component: AcpRegistrySettings,
  });
});
