import { useState } from "react";
import type { Preset } from "../../shared/contract.js";
import type { TasksRpc } from "../../shell/data.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./shared.js";

// Enum options mirror the contract's preset create/update inputs.
export const REASONING_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const PERMISSION_MODES = [
  "readonly",
  "workspace-write",
  "full",
] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  readonly: "Read-only",
  "workspace-write": "Workspace write",
  full: "Full access",
};

/** Provider ids bb ships with; the field stays free text for custom ones. */
const KNOWN_PROVIDER_IDS = ["claude-code", "codex", "acp-grok"] as const;
const PROVIDER_DATALIST_ID = "tasks-preset-provider-ids";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PresetDraft {
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  instructions: string;
}

const EMPTY_PRESET_DRAFT: PresetDraft = {
  name: "",
  providerId: "",
  modelId: "",
  reasoningLevel: "medium",
  permissionMode: "workspace-write",
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
    permissionMode: permission ?? "workspace-write",
    instructions: preset.instructions,
  };
}

/**
 * Create/update a preset from a dialog draft. Built-in presets keep their
 * name (the field is disabled in the dialog and omitted from the update).
 */
export async function savePresetDraft(
  rpc: TasksRpc,
  editing: Preset | null,
  draft: PresetDraft,
): Promise<void> {
  const fields = {
    providerId: draft.providerId.trim(),
    modelId: draft.modelId.trim(),
    reasoningLevel: draft.reasoningLevel,
    permissionMode: draft.permissionMode,
    instructions: draft.instructions,
  };
  if (editing) {
    await rpc.call("updatePreset", {
      presetId: editing.id,
      ...fields,
      ...(editing.builtin ? {} : { name: draft.name.trim() }),
    });
  } else {
    await rpc.call("createPreset", { ...fields, name: draft.name.trim() });
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof PresetDraft>(key: K, value: PresetDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const nameLocked = editing?.builtin ?? false;
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
              autoFocus={!nameLocked}
              value={draft.name}
              placeholder="e.g. Sonnet · high"
              disabled={nameLocked}
              onChange={(event) => set("name", event.target.value)}
              className="h-8"
            />
            {nameLocked ? (
              <p className="text-2xs text-muted-foreground">
                Built-in preset — the name can't be changed.
              </p>
            ) : null}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <Input
                value={draft.providerId}
                placeholder="claude-code"
                list={PROVIDER_DATALIST_ID}
                onChange={(event) => set("providerId", event.target.value)}
                className="h-8"
              />
              <datalist id={PROVIDER_DATALIST_ID}>
                {KNOWN_PROVIDER_IDS.map((providerId) => (
                  <option key={providerId} value={providerId} />
                ))}
              </datalist>
            </Field>
            <Field label="Model">
              <Input
                value={draft.modelId}
                placeholder="claude-sonnet-5"
                onChange={(event) => set("modelId", event.target.value)}
                className="h-8"
              />
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
                  {REASONING_LEVELS.map((level) => (
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
                  {PERMISSION_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {PERMISSION_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
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
