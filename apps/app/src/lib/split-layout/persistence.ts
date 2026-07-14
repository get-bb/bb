import { z } from "zod";
import { MAX_PANES, countPanes, listPanes } from "./ops";
import type { LayoutNode, PaneNode, SplitLayout, SplitNode } from "./types";

export const SPLIT_LAYOUT_SCHEMA_VERSION = 1;
export const SPLIT_LAYOUT_STORAGE_KEY = "bb.splitLayout";

const paneContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("thread"),
      projectId: z.string().min(1),
      threadId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("new-thread") }).strict(),
  z
    .object({
      kind: z.literal("plugin-panel"),
      pluginId: z.string().min(1),
      panelPath: z.string().min(1),
      subPath: z.string(),
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
