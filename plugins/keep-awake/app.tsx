import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import { Switch } from "@bb/shared-ui/switch";
import type { keepAwakeRpcContract } from "./server.js";

type ConfigurationView = StandardSchemaV1InferOutput<
  (typeof keepAwakeRpcContract)["getConfiguration"]["output"]
>;
type PersistedConfiguration = Pick<ConfigurationView, "enabled" | "selection">;
type SaveState = "idle" | "saving" | "saved" | "error";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistedConfiguration(
  view: ConfigurationView,
): PersistedConfiguration {
  return { enabled: view.enabled, selection: view.selection };
}

function KeepAwakeSettings() {
  const rpc = useRpc<typeof keepAwakeRpcContract>();
  const [view, setView] = useState<ConfigurationView | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const viewRef = useRef<ConfigurationView | null>(null);
  const confirmedRef = useRef<ConfigurationView | null>(null);
  const latestRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let loading = true;
    activeRef.current = true;
    void rpc
      .call("getConfiguration")
      .then((configuration) => {
        if (!loading || !activeRef.current) return;
        viewRef.current = configuration;
        confirmedRef.current = configuration;
        setView(configuration);
        setSaveState("saved");
      })
      .catch((loadError: unknown) => {
        if (!loading || !activeRef.current) return;
        setError(errorMessage(loadError));
        setSaveState("error");
      });
    return () => {
      loading = false;
      activeRef.current = false;
    };
  }, [rpc]);

  function updateConfiguration(
    update: (current: ConfigurationView) => ConfigurationView,
  ): void {
    const current = viewRef.current;
    if (current === null) return;
    const next = update(current);
    const revision = latestRevisionRef.current + 1;
    latestRevisionRef.current = revision;
    viewRef.current = next;
    setView(next);
    setError(null);
    setSaveState("saving");

    const operation = saveQueueRef.current.then(async () => {
      const saved = await rpc.call(
        "setConfiguration",
        persistedConfiguration(next),
      );
      confirmedRef.current = saved;
      if (!activeRef.current || latestRevisionRef.current !== revision) return;
      viewRef.current = saved;
      setView(saved);
      setSaveState("saved");
    });
    saveQueueRef.current = operation.catch((saveError: unknown) => {
      if (!activeRef.current || latestRevisionRef.current !== revision) return;
      const confirmed = confirmedRef.current;
      if (confirmed !== null) {
        viewRef.current = confirmed;
        setView(confirmed);
      }
      setError(errorMessage(saveError));
      setSaveState("error");
    });
  }

  function selectMode(mode: "all" | "selected"): void {
    updateConfiguration((current) => {
      if (mode === "all") {
        return { ...current, selection: { mode: "all" } };
      }
      const hostIds =
        current.selection.mode === "selected"
          ? current.selection.hostIds
          : current.hosts.map((host) => host.id).slice(0, 256);
      if (hostIds.length === 0) return current;
      return { ...current, selection: { mode: "selected", hostIds } };
    });
  }

  function setHostSelected(hostId: string, selected: boolean): void {
    updateConfiguration((current) => {
      if (current.selection.mode !== "selected") return current;
      const currentHostIds = current.selection.hostIds;
      const hostIds = selected
        ? [...new Set([...currentHostIds, hostId])]
        : currentHostIds.filter((candidate) => candidate !== hostId);
      if (hostIds.length === 0) return current;
      return { ...current, selection: { mode: "selected", hostIds } };
    });
  }

  if (view === null) {
    return (
      <p
        className={
          error === null
            ? "text-sm text-muted-foreground"
            : "text-sm text-destructive"
        }
        role={error === null ? "status" : "alert"}
      >
        {error ?? "Loading hosts…"}
      </p>
    );
  }

  const selectedHostIds =
    view.selection.mode === "selected" ? view.selection.hostIds : [];
  const hasHosts = view.hosts.length > 0;

  return (
    <div className="w-full space-y-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">
            Prevent idle sleep
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Keep selected Macs awake while bb is running. Closing the lid or
            choosing Sleep still sleeps the Mac.
          </p>
        </div>
        <Switch
          checked={view.enabled}
          size="default"
          aria-label="Keep Awake"
          onCheckedChange={(enabled) => {
            updateConfiguration((current) => ({ ...current, enabled }));
          }}
        />
      </div>

      {view.enabled ? (
        <>
          <div className="border-t border-border/60 pt-4">
            <h3 className="text-sm font-medium text-foreground">Hosts</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Choose which Macs to keep awake.
            </p>
            <RadioGroup
              className="mt-2 gap-1"
              value={view.selection.mode}
              onValueChange={(mode) => {
                if (mode === "all" || mode === "selected") selectMode(mode);
              }}
            >
              <label
                htmlFor="keep-awake-all-hosts"
                className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
              >
                <RadioGroupItem
                  id="keep-awake-all-hosts"
                  value="all"
                  aria-label="All hosts"
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium">All hosts</span>
                  <span className="block text-xs text-muted-foreground">
                    Include hosts added in the future. Only macOS hosts are
                    supported.
                  </span>
                </span>
              </label>
              <label
                htmlFor="keep-awake-selected-hosts"
                className={`flex items-start gap-3 rounded-md px-2 py-2 ${
                  hasHosts
                    ? "cursor-pointer hover:bg-accent/50"
                    : "cursor-not-allowed opacity-50"
                }`}
              >
                <RadioGroupItem
                  id="keep-awake-selected-hosts"
                  value="selected"
                  aria-label="Specific hosts"
                  disabled={!hasHosts}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Specific hosts
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Choose individual Macs below.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          {view.selection.mode === "selected" ? (
            <div className="overflow-hidden rounded-md border border-border/60">
              {hasHosts ? (
                <div className="divide-y divide-border/60">
                  {view.hosts.map((host) => {
                    const selected = selectedHostIds.includes(host.id);
                    const isOnlySelectedHost =
                      selected && selectedHostIds.length === 1;
                    return (
                      <div
                        key={host.id}
                        className="flex min-h-10 items-center gap-3 px-3 py-2"
                      >
                        <Checkbox
                          checked={selected}
                          disabled={isOnlySelectedHost}
                          aria-label={host.name}
                          onCheckedChange={(checked) => {
                            setHostSelected(host.id, checked === true);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {host.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {host.status === "connected"
                            ? "Connected"
                            : "Offline"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No hosts available.
                </p>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex min-h-5 justify-end" aria-live="polite">
        {error !== null ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground" role="status">
            {saveState === "saving" ? "Saving…" : "Saved"}
          </span>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "configuration",
    component: KeepAwakeSettings,
  });
});
