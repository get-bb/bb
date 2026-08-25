import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Badge } from "@bb/shared-ui/badge";
import { Input } from "@bb/shared-ui/input";
import { Switch } from "@bb/shared-ui/switch";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { piModelSettingsRpcContract } from "./model-settings-contract.js";
import type {
  PiModelSettingsModel,
  PiModelSettingsSnapshot,
} from "./model-settings-contract.js";

interface PiModelSettingsEditorProps {
  experimental_hostId?: string | null;
}

function equalSelection(
  left: string[] | null,
  right: string[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeSelection(
  ids: string[],
  allIds: readonly string[],
): string[] | null {
  const allowed = new Set(allIds);
  const normalized = [...new Set(ids)].filter((id) => allowed.has(id));
  return normalized.length === allIds.length ? null : normalized;
}

function searchText(model: PiModelSettingsModel): string {
  return `${model.id} ${model.displayName} ${model.provider}`.toLowerCase();
}

export function PiModelSettingsEditor({
  experimental_hostId: hostId = null,
}: PiModelSettingsEditorProps) {
  const rpc = useRpc<typeof piModelSettingsRpcContract>();
  const hostIdRef = useRef(hostId);
  hostIdRef.current = hostId;
  const [snapshot, setSnapshot] = useState<PiModelSettingsSnapshot | null>(
    null,
  );
  const [draft, setDraft] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let active = true;
    setSaving(false);
    setSaveError(false);
    if (hostId === null) {
      setSnapshot(null);
      setDraft(null);
      setStatus("ready");
      return () => {
        active = false;
      };
    }
    setStatus("loading");
    void rpc
      .call("readModelSettings", { hostId })
      .then((next) => {
        if (!active) return;
        setSnapshot(next);
        setDraft(next.enabledModelIds);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [hostId, rpc]);

  const models = snapshot?.models ?? [];
  const allIds = useMemo(() => models.map(({ id }) => id), [models]);
  const enabled = useMemo(
    () => (draft === null ? null : new Set(draft)),
    [draft],
  );
  const enabledCount = draft === null ? models.length : draft.length;
  const dirty =
    snapshot !== null && !equalSelection(draft, snapshot.enabledModelIds);
  const query = search.trim().toLowerCase();
  const visibleModels = useMemo(
    () =>
      query.length === 0
        ? models
        : models.filter((model) => searchText(model).includes(query)),
    [models, query],
  );

  async function save(): Promise<void> {
    if (hostId === null || !dirty) return;
    setSaving(true);
    setSaveError(false);
    try {
      const next = await rpc.call("writeModelSettings", {
        hostId,
        enabledModelIds: draft,
      });
      if (hostIdRef.current !== hostId) return;
      setSnapshot(next);
      setDraft(next.enabledModelIds);
    } catch {
      if (hostIdRef.current === hostId) setSaveError(true);
    } finally {
      if (hostIdRef.current === hostId) setSaving(false);
    }
  }

  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">Loading Pi models…</p>;
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        Pi model settings are unavailable on this host.
      </p>
    );
  }
  if (hostId === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Pi model settings are unavailable because no host is selected.
      </p>
    );
  }
  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No authenticated Pi models are available on this host. Run `pi` there to
        sign in.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search models"
          aria-label="Search Pi models"
          className="h-8 flex-1"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving || draft === null}
            onClick={() => setDraft(null)}
          >
            Enable all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving || !dirty}
            onClick={() => setDraft(snapshot?.enabledModelIds ?? null)}
          >
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {enabledCount} of {models.length} models enabled for Pi cycling.
        </span>
        {dirty ? <span className="text-warning">Unsaved changes</span> : null}
      </div>

      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          Pi model settings could not be saved.
        </p>
      ) : null}

      <div className="max-h-72 overflow-y-auto rounded-md border border-border/60">
        {visibleModels.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            No models match your search.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {visibleModels.map((model) => {
              const checked = enabled === null || enabled.has(model.id);
              return (
                <div
                  key={model.id}
                  className={`flex items-center gap-3 px-3 py-2 text-sm${checked ? "" : " bg-muted/30 text-muted-foreground"}`}
                >
                  <Switch
                    checked={checked}
                    disabled={saving || (checked && enabledCount === 1)}
                    aria-label={`Enable ${model.id}`}
                    onCheckedChange={(nextChecked) => {
                      const current = draft ?? allIds;
                      setDraft(
                        normalizeSelection(
                          nextChecked
                            ? [...current, model.id]
                            : current.filter((id) => id !== model.id),
                          allIds,
                        ),
                      );
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {model.displayName}
                      </span>
                      <Badge variant="secondary">{model.provider}</Badge>
                      {model.reasoning ? (
                        <Badge variant="secondary">reasoning</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {model.id}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
