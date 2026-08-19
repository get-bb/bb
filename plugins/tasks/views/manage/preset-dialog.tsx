import { useEffect, useRef, useState } from "react";
import type {
  Preset,
  PresetPermissionMode,
} from "../../shared/contract.js";
import {
  PRESET_ENVIRONMENT_KINDS,
  PRESET_PERMISSION_MODES,
} from "../../shared/contract.js";
import type { TasksRpc } from "../../shell/data.js";
import { useTasksQuery } from "../../shell/data.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { Field } from "./shared.js";

// Enum options mirror the contract's preset create/update inputs.
export const REASONING_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export const PERMISSION_MODES = PRESET_PERMISSION_MODES;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];
export type PermissionMode = PresetPermissionMode;
export type EnvironmentKind = (typeof PRESET_ENVIRONMENT_KINDS)[number];

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  "accept-edits": "Accept Edits",
  auto: "Approve for me",
  full: "Full Access",
};

export const ENVIRONMENT_LABELS: Record<EnvironmentKind, string> = {
  "project-default": "Project default",
  "new-worktree": "New worktree",
};

export interface MachineOption {
  id: string;
  name: string;
}

/**
 * Manage-table summary of where a preset's threads spawn. Machine names come
 * from listMachines; an unknown id (machine removed) falls back to the id.
 */
export function describePresetEnvironment(
  preset: Pick<Preset, "environmentKind" | "baseBranch" | "machineId">,
  machines: readonly MachineOption[],
): string {
  if (preset.environmentKind !== "new-worktree") return "Project default";
  const branch = preset.baseBranch ?? "default";
  const machine =
    preset.machineId === null
      ? "default"
      : (machines.find((entry) => entry.id === preset.machineId)?.name ??
        preset.machineId);
  return `Worktree · ${branch} · ${machine}`;
}

/** Sentinel Select value for the free-text provider/model escape hatch. */
const CUSTOM_VALUE = "__custom__";
/** Sentinel Select value for "Default machine" (Radix rejects empty values). */
const DEFAULT_MACHINE_VALUE = "__default-machine__";

function isReasoningLevel(value: string): value is ReasoningLevel {
  return (REASONING_LEVELS as readonly string[]).includes(value);
}

function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export function defaultPermissionMode(
  modes: readonly PermissionMode[],
): PermissionMode {
  return modes.includes("auto") ? "auto" : "full";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PresetDraft {
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  environmentKind: EnvironmentKind;
  /** Empty means "project default base"; only sent for new-worktree. */
  baseBranch: string;
  /** Empty means "default machine"; only sent for new-worktree. */
  machineId: string;
  instructions: string;
}

const EMPTY_PRESET_DRAFT: PresetDraft = {
  name: "",
  providerId: "",
  modelId: "",
  reasoningLevel: "medium",
  permissionMode: "auto",
  environmentKind: "project-default",
  baseBranch: "",
  machineId: "",
  instructions: "",
};

function presetDraft(preset: Preset): PresetDraft {
  const reasoning = REASONING_LEVELS.find(
    (level) => level === preset.reasoningLevel,
  );
  const permission = PERMISSION_MODES.find(
    (mode) => mode === preset.permissionMode,
  );
  return {
    name: preset.name,
    providerId: preset.providerId,
    modelId: preset.modelId,
    reasoningLevel: reasoning ?? "medium",
    permissionMode: permission ?? "full",
    environmentKind: preset.environmentKind,
    baseBranch: preset.baseBranch ?? "",
    machineId: preset.machineId ?? "",
    instructions: preset.instructions,
  };
}

/** Create/update a preset from a dialog draft. */
export async function savePresetDraft(
  rpc: TasksRpc,
  editing: Preset | null,
  draft: PresetDraft,
): Promise<void> {
  // The contract rejects a branch/machine on project-default presets, and a
  // kind switch must not leave stale targets behind — always send explicit
  // nulls outside new-worktree.
  const worktree = draft.environmentKind === "new-worktree";
  const baseBranch = draft.baseBranch.trim();
  const machineId = draft.machineId.trim();
  const fields = {
    name: draft.name.trim(),
    providerId: draft.providerId.trim(),
    modelId: draft.modelId.trim(),
    reasoningLevel: draft.reasoningLevel,
    permissionMode: draft.permissionMode,
    environmentKind: draft.environmentKind,
    baseBranch: worktree && baseBranch !== "" ? baseBranch : null,
    machineId: worktree && machineId !== "" ? machineId : null,
    instructions: draft.instructions,
  };
  if (editing) {
    await rpc.call("updatePreset", { presetId: editing.id, ...fields });
  } else {
    await rpc.call("createPreset", fields);
  }
}

export function PresetDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preset being edited, or null to create. */
  editing: Preset | null;
  onSave: (draft: PresetDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PresetDraft>(
    editing ? presetDraft(editing) : EMPTY_PRESET_DRAFT,
  );
  const [providerCustom, setProviderCustom] = useState(false);
  const [modelCustom, setModelCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof PresetDraft>(key: K, value: PresetDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const providersQuery = useTasksQuery(
    async (rpc) => (await rpc.call("listProviders", {})).providers,
    [],
  );
  const providers = providersQuery.data;
  const machinesQuery = useTasksQuery(
    async (rpc) => (await rpc.call("listMachines", {})).machines,
    [],
  );
  const machines = machinesQuery.data;

  // The dialog opens before the provider list arrives; once it lands, an
  // edited preset whose provider isn't offered flips to the custom input
  // (keeping its value), and a fresh draft preselects the first provider.
  const providerResolvedRef = useRef(false);
  useEffect(() => {
    if (!providers || providerResolvedRef.current) return;
    providerResolvedRef.current = true;
    const known = providers.some(
      (provider) => provider.id === draft.providerId,
    );
    if (draft.providerId === "") {
      const first = providers[0];
      if (first) set("providerId", first.id);
      else setProviderCustom(true);
    } else if (!known) {
      setProviderCustom(true);
      setModelCustom(true);
    }
  }, [providers]);

  const providerForModels =
    !providerCustom && draft.providerId !== "" ? draft.providerId : null;
  const modelsQuery = useTasksQuery(
    async (rpc) =>
      providerForModels === null
        ? null
        : await rpc.call("listProviderModels", {
            providerId: providerForModels,
          }),
    [],
    [providerForModels],
  );
  const models = modelsQuery.data?.models;
  const providerPermissionModes =
    !providerCustom && draft.providerId !== ""
      ? (providers
          ?.find((provider) => provider.id === draft.providerId)
          ?.permissionModes.filter(isPermissionMode) ?? [])
      : [];
  const permissionOptions: readonly PermissionMode[] = providerCustom
    ? PERMISSION_MODES
    : providerPermissionModes;
  const serverLevels = (modelsQuery.data?.reasoningLevels ?? []).filter(
    isReasoningLevel,
  );
  const reasoningOptions: readonly ReasoningLevel[] =
    !modelCustom && !providerCustom && serverLevels.length > 0
      ? serverLevels
      : REASONING_LEVELS;

  // Cascade: when the models for the selected provider land and the current
  // model isn't one of them, either respect an edited preset's custom model
  // (first load) or preselect the provider's default.
  const modelsResolvedOnceRef = useRef(false);
  useEffect(() => {
    if (!models || modelCustom) return;
    if (models.some((model) => model.id === draft.modelId)) {
      modelsResolvedOnceRef.current = true;
      return;
    }
    if (editing && draft.modelId !== "" && !modelsResolvedOnceRef.current) {
      modelsResolvedOnceRef.current = true;
      setModelCustom(true);
      return;
    }
    modelsResolvedOnceRef.current = true;
    const fallback = models.find((model) => model.isDefault) ?? models[0];
    set("modelId", fallback ? fallback.id : "");
  }, [models, modelCustom]);

  // Keep the reasoning level inside what the provider actually offers.
  useEffect(() => {
    if (!reasoningOptions.includes(draft.reasoningLevel)) {
      set(
        "reasoningLevel",
        reasoningOptions.includes("medium") ? "medium" : reasoningOptions[0]!,
      );
    }
  }, [reasoningOptions.join(","), draft.reasoningLevel]);

  useEffect(() => {
    if (permissionOptions.length === 0) return;
    if (!permissionOptions.includes(draft.permissionMode)) {
      set("permissionMode", defaultPermissionMode(permissionOptions));
    }
  }, [permissionOptions.join(","), draft.permissionMode]);

  const canSubmit =
    draft.name.trim() !== "" &&
    draft.providerId.trim() !== "" &&
    draft.modelId.trim() !== "" &&
    !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit preset" : "New preset"}</DialogTitle>
          <DialogDescription>
            Presets pick the provider, model, and guardrails for dispatched
            threads.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name">
            <Input
              autoFocus
              value={draft.name}
              placeholder="e.g. Sonnet · high"
              onChange={(event) => set("name", event.target.value)}
              className="h-8"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <Select
                value={providerCustom ? CUSTOM_VALUE : draft.providerId}
                onValueChange={(value) => {
                  if (value === CUSTOM_VALUE) {
                    setProviderCustom(true);
                    setModelCustom(true);
                    set("permissionMode", "full");
                    return;
                  }
                  setProviderCustom(false);
                  setModelCustom(false);
                  setDraft((current) => ({
                    ...current,
                    providerId: value,
                    // Cleared so the cascade effect fills in the provider's
                    // default model once the list arrives.
                    modelId: "",
                  }));
                }}
              >
                <SelectTrigger aria-label="Provider" className="h-8">
                  <SelectValue
                    placeholder={
                      providers === undefined ? "Loading…" : "Provider"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(providers ?? []).map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>Custom…</SelectItem>
                </SelectContent>
              </Select>
              {providerCustom ? (
                <Input
                  value={draft.providerId}
                  placeholder="provider id, e.g. claude-code"
                  aria-label="Custom provider id"
                  onChange={(event) => set("providerId", event.target.value)}
                  className="h-8"
                />
              ) : null}
            </Field>
            <Field label="Model">
              {providerCustom || modelCustom ? (
                <>
                  {!providerCustom ? (
                    <Select
                      value={CUSTOM_VALUE}
                      onValueChange={(value) => {
                        if (value === CUSTOM_VALUE) return;
                        setModelCustom(false);
                        set("modelId", value);
                      }}
                    >
                      <SelectTrigger aria-label="Model" className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(models ?? []).map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_VALUE}>Custom…</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Input
                    value={draft.modelId}
                    placeholder="model id, e.g. claude-sonnet-5"
                    aria-label="Custom model id"
                    onChange={(event) => set("modelId", event.target.value)}
                    className="h-8"
                  />
                </>
              ) : (
                <Select
                  value={draft.modelId === "" ? undefined : draft.modelId}
                  onValueChange={(value) => {
                    if (value === CUSTOM_VALUE) {
                      setModelCustom(true);
                      return;
                    }
                    set("modelId", value);
                  }}
                >
                  <SelectTrigger aria-label="Model" className="h-8">
                    <SelectValue
                      placeholder={
                        modelsQuery.data === undefined &&
                        providerForModels !== null
                          ? "Loading…"
                          : "Model"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(models ?? []).map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                        {model.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_VALUE}>Custom…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reasoning">
              <Select
                value={draft.reasoningLevel}
                onValueChange={(value) =>
                  set("reasoningLevel", value as ReasoningLevel)
                }
              >
                <SelectTrigger aria-label="Reasoning" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reasoningOptions.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Permissions">
              <Select
                value={draft.permissionMode}
                onValueChange={(value) =>
                  set("permissionMode", value as PermissionMode)
                }
              >
                <SelectTrigger aria-label="Permissions" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {permissionOptions.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {PERMISSION_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Execution environment">
            <Select
              value={draft.environmentKind}
              onValueChange={(value) => {
                const kind = value as EnvironmentKind;
                // Leaving new-worktree clears its targets so a later save
                // can't ship stale branch/machine values.
                setDraft((current) => ({
                  ...current,
                  environmentKind: kind,
                  ...(kind === "new-worktree"
                    ? {}
                    : { baseBranch: "", machineId: "" }),
                }));
              }}
            >
              <SelectTrigger aria-label="Execution environment" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_ENVIRONMENT_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {ENVIRONMENT_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {draft.environmentKind === "new-worktree" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base branch">
                <Input
                  value={draft.baseBranch}
                  placeholder="project default base — leave empty"
                  aria-label="Base branch"
                  onChange={(event) => set("baseBranch", event.target.value)}
                  className="h-8"
                />
              </Field>
              <Field label="Machine">
                <Select
                  value={
                    draft.machineId === ""
                      ? DEFAULT_MACHINE_VALUE
                      : draft.machineId
                  }
                  onValueChange={(value) =>
                    set(
                      "machineId",
                      value === DEFAULT_MACHINE_VALUE ? "" : value,
                    )
                  }
                >
                  <SelectTrigger aria-label="Machine" className="h-8">
                    <SelectValue
                      placeholder={
                        machines === undefined ? "Loading…" : "Machine"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_MACHINE_VALUE}>
                      Default machine
                    </SelectItem>
                    {(machines ?? []).map((machine) => (
                      <SelectItem key={machine.id} value={machine.id}>
                        {machine.name}
                      </SelectItem>
                    ))}
                    {/* An edited preset may reference a machine that no
                        longer exists; keep it selectable by raw id. */}
                    {draft.machineId !== "" &&
                    !(machines ?? []).some(
                      (machine) => machine.id === draft.machineId,
                    ) ? (
                      <SelectItem value={draft.machineId}>
                        {draft.machineId}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}
          <Field label="Instructions">
            <Textarea
              value={draft.instructions}
              placeholder="Extra instructions prepended to dispatched threads"
              onChange={(event) => set("instructions", event.target.value)}
              className="min-h-20 text-xs"
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => {
              setSubmitting(true);
              setError(null);
              onSave(draft)
                .then(() => onOpenChange(false))
                .catch((saveError: unknown) =>
                  setError(describeError(saveError)),
                )
                .finally(() => setSubmitting(false));
            }}
          >
            {editing ? "Save preset" : "Create preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
