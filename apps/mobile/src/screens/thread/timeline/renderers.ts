import type { ReactElement } from "react";
import { FallbackTimelineRow } from "./FallbackTimelineRow";
import type { TimelineListItem, TimelineRowKind } from "./rows";

/**
 * Row renderer contract. The timeline list looks up one renderer per
 * `TimelineListItem.kind` and renders it as the FlashList cell; kinds nobody
 * registered fall back to `FallbackTimelineRow` (title segments + decorations
 * and a raw JSON disclosure). Renderer modules register themselves at import
 * time (import them from `src/screens/thread/timeline/renderers/index.ts`
 * once that module exists) — e.g.
 *
 *   registerTimelineRowRenderer("conversation:user", UserMessageRow);
 *
 * where `UserMessageRow` receives `item.row` already narrowed to
 * `TimelineUserConversationRow`.
 *
 * Kinds: `conversation:user`, `conversation:assistant`, `work:<workKind>`
 * (command, tool, file-change, web-search, web-fetch, image-view, approval,
 * question, delegation, workflow), `system`, `turn`, `step-summary`,
 * `bundle-summary`.
 */

/**
 * The list item narrowed to one kind (`item.row` is typed per kind). The
 * intersection form (rather than `Extract`) keeps `TimelineRowRendererProps<K>`
 * assignable to the unparameterized props for any `K`.
 */
export type TimelineRowRendererItem<
  K extends TimelineRowKind = TimelineRowKind,
> = TimelineListItem & { kind: K };

export interface TimelineRowRendererProps<
  K extends TimelineRowKind = TimelineRowKind,
> {
  item: TimelineRowRendererItem<K>;
  /**
   * Whether the row's body/children are shown (containers flatten their
   * children as following items; leaf rows render their own body).
   */
  expanded: boolean;
  onToggle(): void;
  threadId: string;
  projectId: string;
}

type TimelineRowRenderer<K extends TimelineRowKind = TimelineRowKind> = (
  props: TimelineRowRendererProps<K>,
) => ReactElement;

const registry = new Map<TimelineRowKind, TimelineRowRenderer>();

/** Register the renderer for one kind. */
export function registerTimelineRowRenderer<K extends TimelineRowKind>(
  kind: K,
  renderer: TimelineRowRenderer<K>,
): void {
  // The slot is typed for the whole union: a per-kind renderer can only be
  // stored by narrowing the props it receives. This is sound because
  // `getTimelineRowRenderer(item.kind)` is the sole dispatch path, so a slot
  // registered under `kind` is only ever called with items of that kind.
  const slot: TimelineRowRenderer = (props) =>
    renderer(props as TimelineRowRendererProps<K>);
  registry.set(kind, slot);
}

/** The renderer for `kind`, or the fallback when none is registered. */
export function getTimelineRowRenderer(
  kind: TimelineRowKind,
): TimelineRowRenderer {
  return registry.get(kind) ?? FallbackTimelineRow;
}

export function hasTimelineRowRenderer(kind: TimelineRowKind): boolean {
  return registry.has(kind);
}
