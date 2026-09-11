import { initializeNewThreadDraft } from "@/lib/drafts/resource-runtime";
import { draftIdSchema } from "@bb/server-contract";
import type { SyncStorage } from "@/lib/browser-storage";
import { z } from "zod";
import { MAX_PANES, countPanes, listPanes } from "./ops";
import type { LayoutNode, PaneNode, SplitLayout, SplitNode } from "./types";

export const SPLIT_LAYOUT_SCHEMA_VERSION = 2;
export const SPLIT_LAYOUT_STORAGE_KEY = "bb.splitLayout.v2";

export const LEGACY_SPLIT_LAYOUT_STORAGE_KEY = "bb.splitLayout";

const paneContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("thread"),
      projectId: z.string().min(1),
      threadId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("new-thread"), draftId: draftIdSchema }).strict(),
  z
    .object({
      kind: z.literal("plugin-panel"),
      pluginId: z.string().min(1),
      panelPath: z.string().min(1),
      subPath: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plugin-detail"),
      pluginId: z.string().min(1),
    })
    .strict(),
]);

const paneNodeSchema: z.ZodType<PaneNode> = z
  .object({
    type: z.literal("pane"),
    paneId: z.string().min(1),
    content: paneContentSchema,
  })
  .strict();

const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([paneNodeSchema, splitNodeSchema]),
);

const splitNodeSchema: z.ZodType<SplitNode> = z
  .object({
    type: z.literal("split"),
    dir: z.enum(["row", "col"]),
    sizes: z.array(z.number().positive()),
    children: z.array(layoutNodeSchema).min(2),
  })
  .strict()
  .superRefine((split, context) => {
    if (split.sizes.length !== split.children.length) {
      context.addIssue({
        code: "custom",
        message: "Split sizes must match its child count",
        path: ["sizes"],
      });
    }
    const total = split.sizes.reduce((sum, size) => sum + size, 0);
    if (Math.abs(total - 1) > 1e-9) {
      context.addIssue({
        code: "custom",
        message: "Split sizes must sum to 1",
        path: ["sizes"],
      });
    }
  });

const splitLayoutSchema: z.ZodType<SplitLayout> = z
  .object({
    root: layoutNodeSchema,
    focusedPaneId: z.string().min(1),
  })
  .strict()
  .superRefine((layout, context) => {
    const panes = listPanes(layout.root);
    if (countPanes(layout.root) > MAX_PANES) {
      context.addIssue({
        code: "custom",
        message: `A split layout supports at most ${MAX_PANES} panes`,
        path: ["root"],
      });
    }
    if (!panes.some((pane) => pane.paneId === layout.focusedPaneId)) {
      context.addIssue({
        code: "custom",
        message: "The focused pane must exist",
        path: ["focusedPaneId"],
      });
    }
    if (new Set(panes.map((pane) => pane.paneId)).size !== panes.length) {
      context.addIssue({
        code: "custom",
        message: "Pane IDs must be unique",
        path: ["root"],
      });
    }
  });

const storedSplitLayoutSchema = z
  .object({
    version: z.literal(SPLIT_LAYOUT_SCHEMA_VERSION),
    layout: splitLayoutSchema,
  })
  .strict();

export function serializeSplitLayout(layout: SplitLayout): string {
  return JSON.stringify({ version: SPLIT_LAYOUT_SCHEMA_VERSION, layout });
}

export function deserializeSplitLayout(
  storedValue: string | null,
): SplitLayout | null {
  if (storedValue === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(storedValue);
    const result = storedSplitLayoutSchema.safeParse(parsed);
    return result.success ? result.data.layout : null;
  } catch {
    return null;
  }
}

function migrateLegacyNode(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (!("type" in value)) return value;
  if (value.type === "pane" && "content" in value) {
    const content = value.content;
    if (
      typeof content === "object" &&
      content !== null &&
      "kind" in content &&
      content.kind === "new-thread"
    ) {
      if (Object.keys(content).length !== 1) return { ...value, content: null };
      return {
        ...value,
        content: { kind: "new-thread", draftId: `drf_${crypto.randomUUID()}` },
      };
    }
  }
  if (
    value.type === "split" &&
    "children" in value &&
    Array.isArray(value.children)
  ) {
    return { ...value, children: value.children.map(migrateLegacyNode) };
  }
  return value;
}

export function deserializeLegacySplitLayout(
  storedValue: string | null,
): SplitLayout | null {
  if (storedValue === null) return null;
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("layout" in parsed) ||
      Object.keys(parsed).length !== 2
    )
      return null;
    const layout = parsed.layout;
    if (typeof layout !== "object" || layout === null || !("root" in layout))
      return null;
    const result = splitLayoutSchema.safeParse({
      ...layout,
      root: migrateLegacyNode(layout.root),
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function legacyNode(node: LayoutNode): unknown {
  if (node.type === "split")
    return { ...node, children: node.children.map(legacyNode) };
  return node.content.kind === "new-thread"
    ? { ...node, content: { kind: "new-thread" } }
    : node;
}

export function serializeLegacySplitLayout(layout: SplitLayout): string {
  return JSON.stringify({
    version: 1,
    layout: { ...layout, root: legacyNode(layout.root) },
  });
}

function browserStorage(
  name: "sessionStorage" | "localStorage",
): Storage | null {
  try {
    return typeof window === "undefined" ? null : window[name];
  } catch {
    return null;
  }
}

function readStoredValue(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLayout(
  storage: Storage | null,
  key: string,
  value: SplitLayout | null,
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(key, value === null ? "" : serializeSplitLayout(value));
  } catch {
    return false;
  }
  try {
    storage.setItem(
      LEGACY_SPLIT_LAYOUT_STORAGE_KEY,
      value === null ? "" : serializeLegacySplitLayout(value),
    );
  } catch {
    return true;
  }
  return true;
}

export function createSplitLayoutStorage(): SyncStorage<SplitLayout | null> {
  let pendingMigration: SplitLayout | null = null;
  const checkpointMigration = (): boolean => {
    if (pendingMigration === null) return true;
    const initialized = listPanes(pendingMigration.root)
      .map(
        (pane) =>
          pane.content.kind !== "new-thread" ||
          initializeNewThreadDraft(pane.content.draftId, {}),
      )
      .every(Boolean);
    return initialized;
  };
  return {
    getItem(key, initialValue) {
      if (pendingMigration !== null) return pendingMigration;
      const session = browserStorage("sessionStorage");
      for (const storage of [session, browserStorage("localStorage")]) {
        const current = readStoredValue(storage, key);
        if (current !== null)
          return deserializeSplitLayout(current) ?? initialValue;
        const legacy = readStoredValue(
          storage,
          LEGACY_SPLIT_LAYOUT_STORAGE_KEY,
        );
        if (legacy === null) continue;
        const layout = deserializeLegacySplitLayout(legacy);
        if (layout !== null) {
          pendingMigration = layout;
          if (checkpointMigration()) {
            const persisted = writeLayout(storage, key, layout);
            const persistedInSession =
              storage !== session
                ? writeLayout(session, key, layout)
                : persisted;
            if (persisted || persistedInSession) pendingMigration = null;
          }
        }
        return layout ?? initialValue;
      }
      return initialValue;
    },
    setItem(key, value) {
      if (!checkpointMigration()) return;
      const persistedInSession = writeLayout(
        browserStorage("sessionStorage"),
        key,
        value,
      );
      const persisted = writeLayout(browserStorage("localStorage"), key, value);
      if (persistedInSession || persisted) pendingMigration = null;
    },
    removeItem(key) {
      for (const storage of [
        browserStorage("sessionStorage"),
        browserStorage("localStorage"),
      ]) {
        try {
          storage?.removeItem(key);
          storage?.removeItem(LEGACY_SPLIT_LAYOUT_STORAGE_KEY);
        } catch {
          continue;
        }
      }
    },
  };
}
