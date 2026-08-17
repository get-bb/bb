import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import type { keepAwakeRpcContract } from "./server.js";

type HostConfiguration = StandardSchemaV1InferOutput<
  (typeof keepAwakeRpcContract)["getHostConfiguration"]["output"]
>;
type HostSelection = HostConfiguration["selection"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectionsEqual(a: HostSelection, b: HostSelection): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "all" || b.mode === "all") return true;
  return (
    a.hostIds.length === b.hostIds.length &&
    a.hostIds.every((hostId, index) => hostId === b.hostIds[index])
  );
}

function KeepAwakeHostSettings() {
  const rpc = useRpc<typeof keepAwakeRpcContract>();
  const [configuration, setConfiguration] = useState<HostConfiguration | null>(
    null,
  );
  const [draft, setDraft] = useState<HostSelection>({ mode: "all" });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call("getHostConfiguration")
      .then((next) => {
        if (!active) return;
        setConfiguration(next);
        setDraft(next.selection);
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  const hasSelection = draft.mode === "all" || draft.hostIds.length > 0;
  const hasChanges =
    configuration !== null && !selectionsEqual(draft, configuration.selection);

  function selectMode(mode: HostSelection["mode"]): void {
    setError(null);
    if (mode === "all") {
      setDraft({ mode: "all" });
      return;
    }
    const previous = draft.mode === "selected" ? draft.hostIds : [];
    const firstHostId = configuration?.hosts[0]?.id;
    setDraft({
      mode: "selected",
      hostIds:
        previous.length > 0
          ? previous
          : firstHostId === undefined
            ? []
            : [firstHostId],
    });
  }

  async function save(): Promise<void> {
    if (!hasSelection) return;
    setIsSaving(true);
    setError(null);
    try {
      const next = await rpc.call("setHostSelection", draft);
      setConfiguration(next);
      setDraft(next.selection);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  if (configuration === null) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {error ?? "Loading hosts…"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="sr-only">Host selection</legend>
        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="keep-awake-host-selection"
            value="all"
            aria-label="All hosts"
            checked={draft.mode === "all"}
            onChange={() => selectMode("all")}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            <span className="block text-sm font-medium">All hosts</span>
            <span className="block text-xs text-muted-foreground">
              Include hosts added in the future.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="keep-awake-host-selection"
            value="selected"
            aria-label="Selected hosts"
            checked={draft.mode === "selected"}
            onChange={() => selectMode("selected")}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            <span className="block text-sm font-medium">Selected hosts</span>
            <span className="block text-xs text-muted-foreground">
              Keep only the machines chosen below awake.
            </span>
          </span>
        </label>
      </fieldset>

      {draft.mode === "selected" ? (
        <div className="space-y-2 border-l border-border pl-7">
          {configuration.hosts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hosts available.</p>
          ) : (
            configuration.hosts.map((host) => (
              <label key={host.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.hostIds.includes(host.id)}
                  aria-label={host.name}
                  onChange={(event) => {
                    setError(null);
                    const checked = event.currentTarget.checked;
                    setDraft((current) => {
                      if (current.mode !== "selected") return current;
                      return {
                        mode: "selected",
                        hostIds: checked
                          ? [...new Set([...current.hostIds, host.id])]
                          : current.hostIds.filter(
                              (hostId) => hostId !== host.id,
                            ),
                      };
                    });
                  }}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate">{host.name}</span>
                {host.status === "disconnected" ? (
                  <span className="text-xs text-muted-foreground">Offline</span>
                ) : null}
              </label>
            ))
          )}
          {!hasSelection ? (
            <p className="text-xs text-destructive" role="alert">
              Select at least one host.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-8 items-center justify-between gap-4">
        {error === null ? (
          <span />
        ) : (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          disabled={!hasChanges || !hasSelection || isSaving}
          onClick={() => void save()}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save hosts"}
        </button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "hosts",
    title: "Hosts",
    description: "Choose which macOS hosts should stay awake.",
    component: KeepAwakeHostSettings,
  });
});
