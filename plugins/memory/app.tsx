import { Fragment, useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { memoryRpcContract } from "./server.js";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Switch } from "@bb/shared-ui/switch";
import { Textarea } from "@bb/shared-ui/textarea";

const MEMORY_KINDS = [
  "fact",
  "preference",
  "decision",
  "procedure",
  "episode",
  "reference",
] as const;
type MemoryKind = (typeof MEMORY_KINDS)[number];

function isMemoryKind(value: string): value is MemoryKind {
  return MEMORY_KINDS.some((candidate) => candidate === value);
}

interface MemoryRecord {
  id: string;
  scope: "global" | "project";
  projectId: string | null;
  name: string;
  summary: string;
  details: string;
  kind: MemoryKind;
  tags: string[];
  importance: number;
  pinned: boolean;
  version: number;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMemory(value: unknown): MemoryRecord {
  if (!isRecord(value)) throw new Error("Memory returned an invalid record.");
  const kind = value.kind;
  if (
    typeof value.id !== "string" ||
    (value.scope !== "global" && value.scope !== "project") ||
    (value.projectId !== null && typeof value.projectId !== "string") ||
    typeof value.name !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.details !== "string" ||
    typeof kind !== "string" ||
    !isMemoryKind(kind) ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string") ||
    typeof value.importance !== "number" ||
    typeof value.pinned !== "boolean" ||
    typeof value.version !== "number" ||
    typeof value.updatedAt !== "number"
  ) {
    throw new Error("Memory returned an invalid record.");
  }
  return {
    id: value.id,
    scope: value.scope,
    projectId: value.projectId,
    name: value.name,
    summary: value.summary,
    details: value.details,
    kind,
    tags: value.tags,
    importance: value.importance,
    pinned: value.pinned,
    version: value.version,
    updatedAt: value.updatedAt,
  };
}

function parseMemoryList(value: unknown): MemoryRecord[] {
  if (!isRecord(value) || !Array.isArray(value.memories)) {
    throw new Error("Memory returned an invalid list.");
  }
  return value.memories.map(parseMemory);
}

function parseUpdatedMemory(value: unknown): MemoryRecord {
  if (!isRecord(value)) throw new Error("Memory returned an invalid update.");
  return parseMemory(value.memory);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function MemoryEditor({
  memory,
  onCancel,
  onSaved,
}: {
  memory: MemoryRecord;
  onCancel: () => void;
  onSaved: (memory: MemoryRecord) => void;
}) {
  const rpc = useRpc<typeof memoryRpcContract>();
  const [draft, setDraft] = useState(memory);
  const [tags, setTags] = useState(memory.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Summary
          <Input
            aria-label="Memory summary"
            value={draft.summary}
            maxLength={400}
            onChange={(event) =>
              setDraft({ ...draft, summary: event.target.value })
            }
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Tags
          <Input
            aria-label="Memory tags"
            value={tags}
            placeholder="comma, separated"
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">
        Details
        <Textarea
          aria-label="Memory details"
          value={draft.details}
          maxLength={16_000}
          className="min-h-28 resize-y text-sm"
          onChange={(event) =>
            setDraft({ ...draft, details: event.target.value })
          }
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Kind
          <select
            aria-label="Memory kind"
            value={draft.kind}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            onChange={(event) => {
              if (isMemoryKind(event.target.value)) {
                setDraft({ ...draft, kind: event.target.value });
              }
            }}
          >
            {MEMORY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Importance
          <Input
            aria-label="Memory importance"
            type="number"
            min={0}
            max={100}
            value={draft.importance}
            onChange={(event) =>
              setDraft({ ...draft, importance: Number(event.target.value) })
            }
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <Switch
            aria-label="Pinned memory"
            checked={draft.pinned}
            onCheckedChange={(pinned) => setDraft({ ...draft, pinned })}
          />
          Pinned
        </label>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setError(null);
            void rpc
              .call("updateMemory", {
                id: draft.id,
                expectedVersion: draft.version,
                summary: draft.summary,
                details: draft.details,
                kind: draft.kind,
                tags: tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                importance: draft.importance,
                pinned: draft.pinned,
              })
              .then(parseUpdatedMemory)
              .then(onSaved)
              .catch((saveError: unknown) => setError(errorMessage(saveError)))
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function MemorySettings() {
  const rpc = useRpc<typeof memoryRpcContract>();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMemories(parseMemoryList(await rpc.call("listMemories")));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading memories…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        This plugin shares memory across providers. We recommend disabling
        provider-native memory under Settings → Providers to avoid duplicate or
        conflicting stores.
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {memories.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No memories stored yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-auto px-3 py-2 font-medium">Memory</th>
                <th className="w-24 px-3 py-2 font-medium">Scope</th>
                <th className="w-28 px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {memories.map((memory) => (
                <Fragment key={memory.id}>
                  <tr className="align-top">
                    <td className="min-w-0 px-3 py-3">
                      <div className="truncate font-medium text-foreground">
                        {memory.pinned ? "📌 " : ""}
                        {memory.name}
                      </div>
                      <div className="mt-1 line-clamp-2 break-words text-muted-foreground">
                        {memory.summary}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{memory.kind}</span>
                        <span>importance {memory.importance}</span>
                        <span>
                          updated{" "}
                          {new Date(memory.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <div>{memory.scope}</div>
                      {memory.projectId ? (
                        <div
                          className="mt-1 max-w-36 truncate text-xs"
                          title={memory.projectId}
                        >
                          {memory.projectId}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditingId((current) =>
                              current === memory.id ? null : memory.id,
                            )
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === memory.id}
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (
                              !window.confirm(`Delete memory “${memory.name}”?`)
                            ) {
                              return;
                            }
                            setDeletingId(memory.id);
                            setError(null);
                            void rpc
                              .call("deleteMemory", {
                                id: memory.id,
                                expectedVersion: memory.version,
                              })
                              .then(() => {
                                setMemories((current) =>
                                  current.filter(
                                    (entry) => entry.id !== memory.id,
                                  ),
                                );
                                setEditingId((current) =>
                                  current === memory.id ? null : current,
                                );
                              })
                              .catch((deleteError: unknown) =>
                                setError(errorMessage(deleteError)),
                              )
                              .finally(() => setDeletingId(null));
                          }}
                        >
                          {deletingId === memory.id ? "Deleting…" : "Delete"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {editingId === memory.id ? (
                    <tr>
                      <td colSpan={3} className="bg-muted/10 p-3">
                        <MemoryEditor
                          memory={memory}
                          onCancel={() => setEditingId(null)}
                          onSaved={(updated) => {
                            setMemories((current) =>
                              current.map((entry) =>
                                entry.id === updated.id ? updated : entry,
                              ),
                            );
                            setEditingId(null);
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "memory",
    title: "Memory",
    description:
      "Review and manage provider-independent global and project memories.",
    component: MemorySettings,
  });
});
