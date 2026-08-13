import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { JsonValue, RpcContract } from "../../../../shared/contract.js";
import { useOptionalArchitectureSelection } from "../nodes/selection.js";
import type { DeletionImpact } from "./commands.js";
import { DeleteImpactDialog } from "./delete-impact.js";
import { EntityForm, type CanvasReferenceOptions } from "./forms.js";
import type { canvasEditingRpcContract } from "./backend.js";
import {
  architectureEntityPayload,
  canvasJsonValueSchema,
  canvasEntityKindSchema,
  parseArchitectureEntity,
  type ArchitectureYamlEntity,
  type CanvasEntityKind,
} from "./schema.js";

const PROJECT_SCOPE_STORAGE_KEY =
  "finite-state:product-security:project-scope:v1";
const DELETE_AMENDMENT_MESSAGE =
  "Delete preview is available, but local deletion remains disabled until AMD-0016 supplies a truthful null post-delete hash.";

type AppRuntimeModule = typeof import("@bb/plugin-sdk/app");
type EditingAppRuntime = Pick<AppRuntimeModule, "useBbNavigate" | "useRpc">;
let appRuntimePromise: Promise<AppRuntimeModule> | null = null;

function loadAppRuntime(): Promise<AppRuntimeModule> {
  appRuntimePromise ??= import("@bb/plugin-sdk/app");
  return appRuntimePromise;
}

function isEditingAppRuntime(
  value: AppRuntimeModule,
): value is AppRuntimeModule & EditingAppRuntime {
  return (
    typeof value.useBbNavigate === "function" &&
    typeof value.useRpc === "function"
  );
}

interface FormState {
  mode: "create" | "edit";
  kind: CanvasEntityKind;
  initial: ArchitectureYamlEntity | null;
  expectedSha256: string | null;
}

interface UiHistoryEntry {
  kind: CanvasEntityKind;
  slug: string;
  before: ArchitectureYamlEntity | null;
  after: ArchitectureYamlEntity | null;
  currentSha256: string | null;
}

function readPersistedProjectId(): string | null {
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage?.getItem !== "function"
    ) {
      return null;
    }
    const value = window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 500)
    : "The local YAML operation failed. Reload and compare before retrying.";
}

function isJsonRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonFields(entity: ArchitectureYamlEntity): Record<string, JsonValue> {
  const parsed = canvasJsonValueSchema.parse(architectureEntityPayload(entity));
  if (!isJsonRecord(parsed))
    throw new Error("Entity fields must be a JSON mapping.");
  return parsed;
}

function replacementPatch(
  before: ArchitectureYamlEntity,
  after: ArchitectureYamlEntity,
): Record<string, JsonValue> {
  const previous = jsonFields(before);
  const next = jsonFields(after);
  const patch: Record<string, JsonValue> = {};
  for (const field of new Set([
    ...Object.keys(previous),
    ...Object.keys(next),
  ])) {
    if (field === "slug") continue;
    patch[field] = Object.hasOwn(next, field) ? (next[field] ?? null) : null;
  }
  return patch;
}

function selectedEntity(
  architecture: NonNullable<
    ReturnType<typeof useOptionalArchitectureSelection>
  >,
): { kind: CanvasEntityKind; slug: string } | null {
  const slug =
    architecture.selectedIds.length === 1
      ? architecture.selectedIds[0]
      : architecture.focusId;
  if (!slug) return null;
  const node = architecture.nodesBySlug.get(slug);
  if (node) return { kind: node.kind, slug };
  if (architecture.edgesBySlug.has(slug)) return { kind: "dataflow", slug };
  return null;
}

function referenceOptions(
  architecture: NonNullable<
    ReturnType<typeof useOptionalArchitectureSelection>
  >,
): CanvasReferenceOptions {
  const components: string[] = [];
  const zones: string[] = [];
  const assets: string[] = [];
  for (const node of architecture.nodesBySlug.values()) {
    if (node.kind === "component") components.push(node.slug);
    else if (node.kind === "zone") zones.push(node.slug);
    else assets.push(node.slug);
  }
  return {
    components: components.sort(),
    zones: zones.sort(),
    assets: assets.sort(),
    dataflows: [...architecture.edgesBySlug.keys()].sort(),
  };
}

export function ProductSecurityEditingLayer(): React.JSX.Element | null {
  const [appRuntime, setAppRuntime] = useState<EditingAppRuntime | null>(null);
  useEffect(() => {
    let active = true;
    void loadAppRuntime().then((loaded) => {
      if (active && isEditingAppRuntime(loaded)) setAppRuntime(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return appRuntime ? <ConfiguredEditingLayer appRuntime={appRuntime} /> : null;
}

function ConfiguredEditingLayer({
  appRuntime,
}: {
  appRuntime: EditingAppRuntime;
}): React.JSX.Element | null {
  const projectId = readPersistedProjectId();
  if (!projectId) {
    return (
      <div className="pointer-events-none absolute inset-x-3 top-3 z-30 rounded-md border border-border bg-card/95 p-3 text-sm text-muted-foreground shadow-sm">
        Select a Finite State project to author local architecture YAML.
      </div>
    );
  }
  return <ProjectEditingLayer appRuntime={appRuntime} projectId={projectId} />;
}

function ProjectEditingLayer({
  appRuntime,
  projectId,
}: {
  appRuntime: EditingAppRuntime;
  projectId: string;
}): React.JSX.Element | null {
  const architecture = useOptionalArchitectureSelection();
  const navigate = appRuntime.useBbNavigate();
  const rpc = appRuntime.useRpc<RpcContract>();
  const editingRpc = appRuntime.useRpc<typeof canvasEditingRpcContract>();
  const [newKind, setNewKind] = useState<CanvasEntityKind>("component");
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeletionImpact | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const undoStack = useRef<UiHistoryEntry[]>([]);
  const redoStack = useRef<UiHistoryEntry[]>([]);
  const [, setHistoryRevision] = useState(0);
  const references = useMemo(
    () =>
      architecture
        ? referenceOptions(architecture)
        : { components: [], zones: [], assets: [], dataflows: [] },
    [architecture],
  );

  const selected = architecture ? selectedEntity(architecture) : null;
  const empty =
    architecture !== null &&
    architecture.nodesBySlug.size === 0 &&
    architecture.edgesBySlug.size === 0;

  function refreshHistoryUi(): void {
    setHistoryRevision((revision) => revision + 1);
  }

  function invalidateHistory(kind: CanvasEntityKind, slug: string): void {
    const keep = (entry: UiHistoryEntry) =>
      entry.kind !== kind || entry.slug !== slug;
    undoStack.current = undoStack.current.filter(keep);
    redoStack.current = redoStack.current.filter(keep);
    refreshHistoryUi();
  }

  async function openEdit(): Promise<void> {
    if (!projectId || !selected) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await editingRpc.call("canvasEditingLoad", {
        projectId,
        projectVersionId: null,
        kind: selected.kind,
        slug: selected.slug,
      });
      if (loaded.state === "missing") {
        setError(
          "This entity no longer exists in working YAML. Reload the canvas before editing.",
        );
        return;
      }
      const entity = parseArchitectureEntity(loaded.kind, loaded.fields);
      setForm({
        mode: "edit",
        kind: loaded.kind,
        initial: entity,
        expectedSha256: loaded.sha256,
      });
    } catch (loadError) {
      setError(safeError(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function submit(entity: ArchitectureYamlEntity): Promise<void> {
    if (!projectId || !form) return;
    setSaving(true);
    setError(null);
    try {
      if (form.mode === "create") {
        const result = await rpc.call("taraCommandApply", {
          projectId,
          projectVersionId: null,
          operation: "create",
          kind: entity.kind,
          fields: jsonFields(entity),
          expectedContentSha256: null,
        });
        undoStack.current.push({
          kind: entity.kind,
          slug: entity.slug,
          before: null,
          after: entity,
          currentSha256: result.afterSha256,
        });
      } else {
        if (!form.initial || !form.expectedSha256) {
          throw new Error("Reload the entity before editing.");
        }
        const result = await rpc.call("taraCommandApply", {
          projectId,
          projectVersionId: null,
          operation: "update",
          kind: entity.kind,
          stableKey: entity.slug,
          fields: replacementPatch(form.initial, entity),
          expectedContentSha256: form.expectedSha256,
        });
        undoStack.current.push({
          kind: entity.kind,
          slug: entity.slug,
          before: form.initial,
          after: entity,
          currentSha256: result.afterSha256,
        });
      }
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
      refreshHistoryUi();
      setForm(null);
      setMessage(
        "Local YAML updated. Review the domain diff in Sync before any human-approved push.",
      );
    } catch (saveError) {
      const detail = safeError(saveError);
      if (detail.startsWith("LOCAL_WRITE_CONFLICT:")) {
        invalidateHistory(entity.kind, entity.slug);
        setError(`${detail} Undo and redo for this entity were invalidated.`);
      } else {
        setError(detail);
      }
    } finally {
      setSaving(false);
    }
  }

  async function previewDelete(): Promise<void> {
    if (!projectId || !selected) return;
    setDeleteOpen(true);
    setDeleteImpact(null);
    setError(null);
    try {
      const impact = await rpc.call("taraDeleteImpact", {
        projectId,
        projectVersionId: null,
        kind: selected.kind,
        stableKey: selected.slug,
      });
      setDeleteImpact({
        slug: impact.stableKey,
        referrers: impact.referrers.map((referrer) => ({
          kind: referrer.kind,
          slug: referrer.stableKey,
          effect: referrer.effect,
        })),
        allowedActions: impact.allowedActions,
        restorable: impact.restorable,
      });
    } catch (impactError) {
      setError(safeError(impactError));
    }
  }

  async function transitionHistory(direction: "undo" | "redo"): Promise<void> {
    if (!projectId) return;
    const source = direction === "undo" ? undoStack.current : redoStack.current;
    const destination =
      direction === "undo" ? redoStack.current : undoStack.current;
    const entry = source.at(-1);
    if (!entry) return;
    const target = direction === "undo" ? entry.before : entry.after;
    const current = direction === "undo" ? entry.after : entry.before;
    setSaving(true);
    setError(null);
    try {
      let nextSha256: string | null;
      if (target === null && current !== null) {
        throw new Error(DELETE_AMENDMENT_MESSAGE);
      } else if (target !== null && current === null) {
        const result = await rpc.call("taraCommandApply", {
          projectId,
          projectVersionId: null,
          operation: "create",
          kind: entry.kind,
          fields: jsonFields(target),
          expectedContentSha256: null,
        });
        nextSha256 = result.afterSha256;
      } else if (target !== null && current !== null) {
        if (!entry.currentSha256)
          throw new Error("History entry has no current CAS hash.");
        const result = await rpc.call("taraCommandApply", {
          projectId,
          projectVersionId: null,
          operation: "update",
          kind: entry.kind,
          stableKey: entry.slug,
          fields: replacementPatch(current, target),
          expectedContentSha256: entry.currentSha256,
        });
        nextSha256 = result.afterSha256;
      } else {
        throw new Error("History entry has no semantic state.");
      }
      source.pop();
      entry.currentSha256 = nextSha256;
      destination.push(entry);
      refreshHistoryUi();
      setMessage(
        `${direction === "undo" ? "Undo" : "Redo"} wrote an inverse CAS command to local YAML.`,
      );
    } catch (historyError) {
      const detail = safeError(historyError);
      if (detail.startsWith("LOCAL_WRITE_CONFLICT:")) {
        invalidateHistory(entry.kind, entry.slug);
        setError(
          `${detail} History for ${entry.kind}/${entry.slug} was invalidated; reload and compare.`,
        );
      } else {
        setError(detail);
      }
    } finally {
      setSaving(false);
    }
  }

  const toolbar = (
    <div className="absolute right-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-card/95 p-2 text-card-foreground shadow-sm backdrop-blur">
      <select
        aria-label="New entity kind"
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        onChange={(event) =>
          setNewKind(canvasEntityKindSchema.parse(event.target.value))
        }
        value={newKind}
      >
        {(["component", "zone", "asset", "dataflow", "threat"] as const).map(
          (kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ),
        )}
      </select>
      <Button
        onClick={() => {
          setError(null);
          setForm({
            mode: "create",
            kind: newKind,
            initial: null,
            expectedSha256: null,
          });
        }}
        size="sm"
        type="button"
      >
        New
      </Button>
      <Button
        disabled={!selected || loading}
        onClick={() => void openEdit()}
        size="sm"
        type="button"
        variant="outline"
      >
        {loading ? "Loading…" : "Edit"}
      </Button>
      <Button
        disabled={!selected}
        onClick={() => void previewDelete()}
        size="sm"
        type="button"
        variant="outline"
      >
        <Icon aria-hidden="true" name="Trash2" /> Impact
      </Button>
      <span aria-hidden="true" className="h-5 w-px bg-border" />
      <Button
        aria-label="Undo with inverse CAS"
        disabled={undoStack.current.length === 0 || saving}
        onClick={() => void transitionHistory("undo")}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Icon aria-hidden="true" name="RotateCcw" /> Undo
      </Button>
      <Button
        aria-label="Redo with inverse CAS"
        disabled={redoStack.current.length === 0 || saving}
        onClick={() => void transitionHistory("redo")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Redo
      </Button>
      <Button
        disabled
        onClick={() => navigate.toPluginPanel("sync")}
        size="sm"
        type="button"
        variant="outline"
      >
        Sync review unavailable
      </Button>
    </div>
  );

  return (
    <>
      {toolbar}
      {empty ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-8">
          <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed border-border bg-card/95 p-6 text-center shadow-sm">
            <p className="text-base font-semibold">
              Start the local architecture model
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Create stable-slug entities as canonical YAML. Positions remain in
              canvas.json and never enter the semantic plan.
            </p>
            <Button
              className="mt-4"
              onClick={() =>
                setForm({
                  mode: "create",
                  kind: newKind,
                  initial: null,
                  expectedSha256: null,
                })
              }
              type="button"
            >
              Create first entity
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <div
          className="absolute bottom-3 left-3 z-30 max-w-lg rounded-md border border-border bg-card/95 p-3 text-sm text-muted-foreground shadow-sm"
          role="status"
        >
          {message}
        </div>
      ) : null}
      {error && !form && !deleteOpen ? (
        <div
          className="absolute bottom-3 left-3 z-40 max-w-lg rounded-md border border-destructive/40 bg-card p-3 text-sm text-destructive shadow-sm"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {form ? (
        <EntityForm
          entityKind={form.kind}
          error={error}
          initial={form.initial}
          key={`${form.mode}:${form.kind}:${form.initial?.slug ?? "new"}`}
          mode={form.mode}
          onCancel={() => {
            setForm(null);
            setError(null);
          }}
          onSubmit={(entity) => void submit(entity)}
          references={references}
          saving={saving}
        />
      ) : null}
      {deleteOpen && selected ? (
        <DeleteImpactDialog
          blockedReason={DELETE_AMENDMENT_MESSAGE}
          entityKind={selected.kind}
          error={error}
          impact={deleteImpact}
          loading={!deleteImpact && !error}
          onCancel={() => {
            setDeleteOpen(false);
            setDeleteImpact(null);
            setError(null);
          }}
          onConfirm={() => undefined}
        />
      ) : null}
    </>
  );
}
