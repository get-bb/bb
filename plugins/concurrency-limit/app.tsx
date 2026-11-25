import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { Input } from "@/components/ui/input";
import {
  SettingsList,
  SettingsListItem,
  SettingsListMessage,
} from "@/components/ui/settings-section";
import {
  commitGlobalLimitDraft,
  commitHostLimitDraft,
  MAX_LIMIT_VALUE,
  type LimitDraftCommit,
} from "./limits.js";
import type { concurrencyLimitRpcContract } from "./server.js";
import { isNonImeKey } from "@/lib/ime-keyboard";

type ConfigurationView = StandardSchemaV1InferOutput<
  (typeof concurrencyLimitRpcContract)["getConfiguration"]["output"]
>;
type ConfigurationInput = Pick<
  ConfigurationView,
  "globalLimit" | "hostOverrides"
>;
type SaveState = "idle" | "saving" | "saved" | "error";

const CONFIGURATION_CHANGED_CHANNEL = "configuration-changed";
const GLOBAL_FIELD = "global";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function draftsFor(view: ConfigurationView): Record<string, string> {
  const drafts: Record<string, string> = {
    [GLOBAL_FIELD]: view.globalLimit === null ? "" : String(view.globalLimit),
  };
  for (const host of view.hosts) {
    drafts[host.id] = host.override === null ? "" : String(host.override);
  }
  return drafts;
}

function ConcurrencyLimitSettings() {
  const rpc = useRpc<typeof concurrencyLimitRpcContract>();
  const [view, setView] = useState<ConfigurationView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const activeRef = useRef(true);
  const savingRef = useRef(false);

  const applyView = useCallback((next: ConfigurationView) => {
    setView(next);
    setDrafts(draftsFor(next));
  }, []);

  const refetch = useCallback(() => {
    if (savingRef.current) return;
    void rpc.call("getConfiguration").then(
      (configuration) => {
        if (!activeRef.current || savingRef.current) return;
        applyView(configuration);
        setError(null);
        setSaveState("saved");
      },
      (loadError: unknown) => {
        if (!activeRef.current) return;
        setError(errorMessage(loadError));
        setSaveState("error");
      },
    );
  }, [applyView, rpc]);

  useEffect(() => {
    activeRef.current = true;
    refetch();
    return () => {
      activeRef.current = false;
    };
  }, [refetch]);
  useRealtime(CONFIGURATION_CHANGED_CHANNEL, refetch);

  async function save(next: ConfigurationInput): Promise<void> {
    savingRef.current = true;
    setSaveState("saving");
    setError(null);
    try {
      const saved = await rpc.call("setConfiguration", next);
      if (!activeRef.current) return;
      applyView(saved);
      setSaveState("saved");
    } catch (saveError) {
      if (!activeRef.current) return;
      setError(errorMessage(saveError));
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  }

  function changeDraft(field: string, value: string): void {
    setDrafts((current) => ({ ...current, [field]: value }));
    if (invalidField === field) setInvalidField(null);
  }

  function applyCommit(field: string, commit: LimitDraftCommit): void {
    if (commit.kind === "invalid") {
      setInvalidField(field);
      return;
    }
    if (commit.kind === "changed") void save(commit.configuration);
  }

  function commitGlobal(): void {
    if (view === null) return;
    applyCommit(
      GLOBAL_FIELD,
      commitGlobalLimitDraft(view, drafts[GLOBAL_FIELD] ?? ""),
    );
  }

  function commitHost(hostId: string): void {
    if (view === null) return;
    applyCommit(
      hostId,
      commitHostLimitDraft(view, hostId, drafts[hostId] ?? ""),
    );
  }

  if (view === null) {
    return (
      <SettingsList>
        <SettingsListMessage tone={error === null ? "muted" : "error"}>
          {error ?? "Loading limits…"}
        </SettingsListMessage>
      </SettingsList>
    );
  }

  const disabled = saveState === "saving";
  const validationMessage = `Use a whole number from 0 to ${MAX_LIMIT_VALUE}, or leave blank.`;

  return (
    <div className="w-full space-y-5">
      <SettingsList>
        <SettingsListItem
          title="Overall limit"
          description="Leave blank for no overall limit. Use 0 to pause new work."
          control={
            <Input
              aria-label="Overall thread limit"
              aria-invalid={invalidField === GLOBAL_FIELD}
              className="w-28"
              disabled={disabled}
              inputMode="numeric"
              max={MAX_LIMIT_VALUE}
              min={0}
              placeholder="Unlimited"
              step={1}
              type="number"
              value={drafts[GLOBAL_FIELD] ?? ""}
              onBlur={commitGlobal}
              onChange={(event) =>
                changeDraft(GLOBAL_FIELD, event.target.value)
              }
              onKeyDown={(event) => {
                if (isNonImeKey(event, "Enter")) event.currentTarget.blur();
              }}
            />
          }
        />
      </SettingsList>

      <SettingsList
        title="Host limits"
        description="Auto allows one thread per available processor."
      >
        {view.hosts.length === 0 ? (
          <SettingsListMessage>No hosts available.</SettingsListMessage>
        ) : (
          view.hosts.map((host) => (
            <SettingsListItem
              key={host.id}
              title={host.name}
              meta={[
                host.availableParallelism === null
                  ? host.status !== "disconnected" && "Detecting processors…"
                  : `${host.availableParallelism} processors`,
                host.status === "disconnected" && "Offline",
              ]}
              control={
                <Input
                  aria-label={`${host.name} thread limit`}
                  aria-invalid={invalidField === host.id}
                  className="w-28"
                  disabled={disabled}
                  inputMode="numeric"
                  max={MAX_LIMIT_VALUE}
                  min={0}
                  placeholder={`Auto (${host.automaticLimit})`}
                  step={1}
                  type="number"
                  value={drafts[host.id] ?? ""}
                  onBlur={() => commitHost(host.id)}
                  onChange={(event) => changeDraft(host.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (isNonImeKey(event, "Enter")) event.currentTarget.blur();
                  }}
                />
              }
            />
          ))
        )}
      </SettingsList>

      <div className="flex min-h-5 justify-end" aria-live="polite">
        {invalidField !== null ? (
          <span className="text-xs text-destructive" role="alert">
            {validationMessage}
          </span>
        ) : error !== null ? (
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
    component: ConcurrencyLimitSettings,
  });
});
