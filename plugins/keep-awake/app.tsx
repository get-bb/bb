import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  SettingsList,
  SettingsListItem,
  SettingsListMessage,
} from "@/components/ui/settings-section";
import { Switch } from "@/components/ui/switch";
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
      <SettingsList>
        <SettingsListMessage tone={error === null ? "muted" : "error"}>
          {error ?? "Loading hosts…"}
        </SettingsListMessage>
      </SettingsList>
    );
  }

  const selectedHostIds =
    view.selection.mode === "selected" ? view.selection.hostIds : [];
  const hasHosts = view.hosts.length > 0;

  return (
    <div className="w-full space-y-5">
      <SettingsList>
        <SettingsListItem
          title="Prevent idle sleep"
          description="Keep selected Macs awake while bb is running. Closing the lid or choosing Sleep still sleeps the Mac."
          control={
            <Switch
              checked={view.enabled}
              size="default"
              aria-label="Keep Awake"
              onCheckedChange={(enabled) => {
                updateConfiguration((current) => ({ ...current, enabled }));
              }}
            />
          }
        />
      </SettingsList>

      {view.enabled ? (
        <RadioGroup
          className="block"
          value={view.selection.mode}
          onValueChange={(mode) => {
            if (mode === "all" || mode === "selected") selectMode(mode);
          }}
        >
          <SettingsList
            title="Hosts"
            description="Choose which Macs to keep awake."
            dividers={false}
          >
            <SettingsListItem
              leading={
                <RadioGroupItem
                  id="keep-awake-all-hosts"
                  value="all"
                  aria-label="All hosts"
                />
              }
              title={
                <label
                  htmlFor="keep-awake-all-hosts"
                  className="cursor-pointer"
                >
                  All hosts
                </label>
              }
              description="Include hosts added in the future. Only macOS and Windows hosts are supported."
            />
            <SettingsListItem
              leading={
                <RadioGroupItem
                  id="keep-awake-selected-hosts"
                  value="selected"
                  aria-label="Specific hosts"
                  disabled={!hasHosts}
                />
              }
              title={
                <label
                  htmlFor="keep-awake-selected-hosts"
                  className={hasHosts ? "cursor-pointer" : "cursor-not-allowed"}
                >
                  Specific hosts
                </label>
              }
              description={
                hasHosts
                  ? "Choose individual Macs below."
                  : "No hosts available."
              }
            >
              {view.selection.mode === "selected"
                ? view.hosts.map((host) => {
                    const selected = selectedHostIds.includes(host.id);
                    return (
                      <SettingsListItem
                        key={host.id}
                        leading={
                          <Checkbox
                            checked={selected}
                            disabled={selected && selectedHostIds.length === 1}
                            aria-label={host.name}
                            onCheckedChange={(checked) => {
                              setHostSelected(host.id, checked === true);
                            }}
                          />
                        }
                        title={host.name}
                        meta={[
                          host.status === "connected" ? "Connected" : "Offline",
                        ]}
                      />
                    );
                  })
                : undefined}
            </SettingsListItem>
          </SettingsList>
        </RadioGroup>
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
