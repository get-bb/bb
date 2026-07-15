import { useMemo, useState } from "react";
import type { Folder, Label, Preset } from "../../shared/contract.js";
import {
  useFolders,
  usePresets,
  useProjects,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ColorSwatchPicker, DEFAULT_COLOR, Field } from "./shared.js";

// Enum options mirror the contract's preset create/update inputs.
const REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
const PERMISSION_MODES = ["readonly", "workspace-write", "full"] as const;
type ReasoningLevel = (typeof REASONING_LEVELS)[number];
type PermissionMode = (typeof PERMISSION_MODES)[number];

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  readonly: "Read-only",
  "workspace-write": "Workspace write",
  full: "Full access",
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function LabelEditorRow({
  initialName,
  initialColor,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  initialColor: string;
  submitLabel: string;
  onSubmit: (name: string, color: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        placeholder="Label name"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim() !== "") {
            event.preventDefault();
            void onSubmit(name.trim(), color).then(() => {
              if (!onCancel) {
                setName("");
                setColor(DEFAULT_COLOR);
              }
            });
          }
        }}
        className="h-7 w-44 text-xs"
      />
      <ColorSwatchPicker value={color} onChange={setColor} />
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={name.trim() === ""}
        onClick={() =>
          void onSubmit(name.trim(), color).then(() => {
            if (!onCancel) {
              setName("");
              setColor(DEFAULT_COLOR);
            }
          })
        }
      >
        {submitLabel}
      </Button>
      {onCancel ? (
        <Button size="sm" variant="ghost" className="h-7" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}

function LabelsSection() {
  const rpc = useTasksRpc();
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const projectId = selectedProjectId ?? projectList[0]?.id ?? null;
  const labels = useTasksQuery(
    async (rpc) =>
      projectId
        ? (await rpc.call("listLabels", { projectId })).labels
        : ([] as Label[]),
    ["projects:changed"],
    [projectId],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(describeError(actionError));
    }
  };

  if (projectList.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a project first — labels are project-scoped.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Select
        value={projectId ?? undefined}
        onValueChange={(value) => {
          setSelectedProjectId(value);
          setEditingId(null);
        }}
      >
        <SelectTrigger aria-label="Project" className="h-8 w-56">
          <SelectValue placeholder="Project" />
        </SelectTrigger>
        <SelectContent>
          {projectList.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                {project.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="divide-y divide-border-hairline rounded-md border border-border">
        {(labels.data ?? []).map((label) => (
          <div key={label.id} className="px-3 py-2">
            {editingId === label.id ? (
              <LabelEditorRow
                initialName={label.name}
                initialColor={label.color}
                submitLabel="Save"
                onCancel={() => setEditingId(null)}
                onSubmit={(name, color) =>
                  run(async () => {
                    await rpc.call("updateLabel", {
                      labelId: label.id,
                      name,
                      color,
                    });
                    setEditingId(null);
                  })
                }
              />
            ) : (
              <div className="group flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 text-sm">{label.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground opacity-0 group-hover:opacity-100"
                  aria-label={`Edit label ${label.name}`}
                  onClick={() => setEditingId(label.id)}
                >
                  <Icon name="Edit" className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                  aria-label={`Delete label ${label.name}`}
                  onClick={() =>
                    void run(() =>
                      rpc.call("deleteLabel", { labelId: label.id }),
                    )
                  }
                >
                  <Icon name="Trash2" className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {(labels.data ?? []).length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No labels yet.
          </p>
        ) : null}
      </div>
      <LabelEditorRow
        initialName=""
        initialColor={DEFAULT_COLOR}
        submitLabel="Add label"
        onSubmit={(name, color) =>
          run(async () => {
            if (!projectId) return;
            await rpc.call("createLabel", { projectId, name, color });
          })
        }
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface PresetDraft {
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

function PresetDialog({
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
            Presets pick the provider, model, and guardrails for delegated
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
              <Input
                value={draft.providerId}
                placeholder="anthropic"
                onChange={(event) => set("providerId", event.target.value)}
                className="h-8"
              />
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
              placeholder="Extra instructions prepended to delegated threads"
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

function PresetsSection() {
  const rpc = useTasksRpc();
  const presets = usePresets();
  // Keyed remount resets the dialog draft per open/target.
  const [dialog, setDialog] = useState<{
    key: number;
    editing: Preset | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (editing: Preset | null, draft: PresetDraft) => {
    const fields = {
      name: draft.name.trim(),
      providerId: draft.providerId.trim(),
      modelId: draft.modelId.trim(),
      reasoningLevel: draft.reasoningLevel,
      permissionMode: draft.permissionMode,
      instructions: draft.instructions,
    };
    if (editing) {
      await rpc.call("updatePreset", { presetId: editing.id, ...fields });
    } else {
      await rpc.call("createPreset", fields);
    }
    presets.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Presets available when delegating a task to an agent.
        </p>
        <Button
          size="sm"
          className="h-7"
          onClick={() => setDialog({ key: Date.now(), editing: null })}
        >
          <Icon name="Plus" className="size-3.5" />
          New preset
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-hairline text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Reasoning</th>
              <th className="px-3 py-2 font-medium">Permissions</th>
              <th className="px-3 py-2 font-medium">Instructions</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-hairline">
            {(presets.data ?? []).map((preset) => {
              const permission = PERMISSION_MODES.find(
                (mode) => mode === preset.permissionMode,
              );
              return (
                <tr key={preset.id} className="group">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Icon
                        name="Brain"
                        className="size-3.5 text-muted-foreground"
                      />
                      {preset.name}
                      {preset.builtin ? (
                        <Badge variant="secondary" className="px-1.5 py-0">
                          Built-in
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {preset.providerId}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {preset.modelId}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {preset.reasoningLevel}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {permission ? PERMISSION_LABELS[permission] : preset.permissionMode}
                  </td>
                  <td
                    className="max-w-48 truncate px-3 py-2 text-xs text-muted-foreground"
                    title={preset.instructions}
                  >
                    {preset.instructions === "" ? "—" : preset.instructions}
                  </td>
                  <td className="px-3 py-2">
                    {!preset.builtin ? (
                      <span className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-6 text-muted-foreground"
                          aria-label={`Edit preset ${preset.name}`}
                          onClick={() =>
                            setDialog({ key: Date.now(), editing: preset })
                          }
                        >
                          <Icon name="Edit" className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-6 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete preset ${preset.name}`}
                          onClick={() => {
                            setError(null);
                            rpc
                              .call("deletePreset", { presetId: preset.id })
                              .then(() => presets.refresh())
                              .catch((deleteError: unknown) =>
                                setError(describeError(deleteError)),
                              );
                          }}
                        >
                          <Icon name="Trash2" className="size-3.5" />
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {(presets.data ?? []).length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-3 text-sm text-muted-foreground"
                >
                  No presets yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {dialog ? (
        <PresetDialog
          key={dialog.key}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          editing={dialog.editing}
          onSave={(draft) => save(dialog.editing, draft)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

const ROOT_PARENT = "__root__";

function FolderRow({
  folder,
  rootFolders,
  onRename,
  onMove,
}: {
  folder: Folder;
  rootFolders: Folder[];
  onRename: (name: string) => Promise<void>;
  onMove: (parentFolderId: string | null) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);
  const parentOptions = rootFolders.filter((entry) => entry.id !== folder.id);

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Icon name="Folder" className="size-3.5 shrink-0 text-muted-foreground" />
      {renaming ? (
        <>
          <Input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draftName.trim() !== "") {
                event.preventDefault();
                void onRename(draftName.trim()).then(() => setRenaming(false));
              }
              if (event.key === "Escape") setRenaming(false);
            }}
            className="h-7 w-44 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={draftName.trim() === ""}
            onClick={() =>
              void onRename(draftName.trim()).then(() => setRenaming(false))
            }
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setRenaming(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate text-sm">{folder.name}</span>
          <Select
            value={folder.parentFolderId ?? ROOT_PARENT}
            onValueChange={(value) =>
              void onMove(value === ROOT_PARENT ? null : value)
            }
          >
            <SelectTrigger
              aria-label={`Parent of ${folder.name}`}
              className="h-7 w-40 text-xs text-muted-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROOT_PARENT}>Top level</SelectItem>
              {parentOptions.map((parent) => (
                <SelectItem key={parent.id} value={parent.id}>
                  {parent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground"
            aria-label={`Rename folder ${folder.name}`}
            onClick={() => {
              setDraftName(folder.name);
              setRenaming(true);
            }}
          >
            <Icon name="Edit" className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

function FoldersSection() {
  const rpc = useTasksRpc();
  const folders = useFolders();
  const [error, setError] = useState<string | null>(null);
  const folderList = folders.data ?? [];
  // The sidebar nests folders one level deep, so only roots can be parents.
  const rootFolders = useMemo(
    () => folderList.filter((folder) => folder.parentFolderId === null),
    [folderList],
  );

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(describeError(actionError));
    }
  };

  return (
    <div className="space-y-3">
      {folderList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No folders yet — create one from the New project dialog.
        </p>
      ) : (
        <div className="divide-y divide-border-hairline rounded-md border border-border">
          {folderList.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              rootFolders={rootFolders}
              onRename={(name) =>
                run(() =>
                  rpc.call("renameFolder", { folderId: folder.id, name }),
                )
              }
              onMove={(parentFolderId) =>
                run(() =>
                  rpc.call("moveFolder", {
                    folderId: folder.id,
                    parentFolderId,
                  }),
                )
              }
            />
          ))}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Settings-ish management surface: labels, agent presets, and folders.
 *
 * The shell does not yet reserve a manage route or sidebar-footer slot, so
 * this is exported unmounted; when the shell grows one (e.g. a `manage`
 * subPath or a sidebar "Manage" button), render <ManagePanel /> there.
 */
export function ManagePanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4",
        className,
      )}
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">Manage</h2>
        <p className="text-sm text-muted-foreground">
          Labels, agent presets, and folders.
        </p>
      </header>
      <Tabs defaultValue="labels">
        <TabsList>
          <TabsTrigger value="labels">Labels</TabsTrigger>
          <TabsTrigger value="presets">Presets</TabsTrigger>
          <TabsTrigger value="folders">Folders</TabsTrigger>
        </TabsList>
        <TabsContent value="labels" className="pt-3">
          <LabelsSection />
        </TabsContent>
        <TabsContent value="presets" className="pt-3">
          <PresetsSection />
        </TabsContent>
        <TabsContent value="folders" className="pt-3">
          <FoldersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
