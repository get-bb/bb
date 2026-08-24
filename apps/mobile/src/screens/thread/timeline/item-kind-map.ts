import type { CoreItemKind } from "@bb/domain";
import type { TimelineRowKind } from "./rows";

/**
 * The mobile rendering decision for every persisted item kind (guardrail G4).
 *
 * `CORE_ITEM_KINDS` in `@bb/domain` is the closed core vocabulary; this map
 * `satisfies Record<CoreItemKind | "extension", …>`, so adding a kind to the
 * domain without deciding how mobile shows it fails to typecheck here. A
 * decision is one of:
 *
 * - `{ row }`: the server projects the item onto this row kind today and a
 *   renderer is registered for it (`renderers/work`, `renderers/conversation`,
 *   `renderers/system`);
 * - `{ fallback }`: no projection or renderer yet; the row falls through to
 *   `FallbackTimelineRow` (the registry fallback) until the named workstream
 *   builds the declarative-base renderer;
 * - `{ hidden }`: never its own row — folded into another row or into thread
 *   state — with the reason.
 *
 * Pure data, no react-native import, so the exhaustiveness test runs in node.
 */
export type MobileItemKindRendering =
  | { row: TimelineRowKind }
  | { fallback: `WS${string}` }
  | { hidden: string };

export const MOBILE_ITEM_KIND_MAP = {
  userMessage: { row: "conversation:user" },
  agentMessage: { row: "conversation:assistant" },
  commandExecution: { row: "work:command" },
  fileChange: { row: "work:file-change" },
  fileRead: { row: "work:file-read" },
  search: { row: "work:search" },
  webSearch: { row: "work:web-search" },
  webFetch: { row: "work:web-fetch" },
  imageView: { row: "work:image-view" },
  toolCall: { row: "work:tool" },
  reasoning: {
    hidden:
      "folded into the assistant conversation row by the server projection",
  },
  plan: { row: "conversation:assistant" },
  planSteps: { row: "work:plan-steps" },
  contextCompaction: { row: "system" },
  backgroundTask: { row: "work:workflow" },
  delegation: { row: "work:delegation" },
  // A plugin-defined kind: the declarative base (label, glyph, tint,
  // detail) is the whole renderer; mobile loads no plugin JS.
  extension: { row: "work:extension" },
} as const satisfies Record<
  CoreItemKind | "extension",
  MobileItemKindRendering
>;

export type MobileMappedItemKind = keyof typeof MOBILE_ITEM_KIND_MAP;
