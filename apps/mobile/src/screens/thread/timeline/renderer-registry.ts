import type { TimelineRowKind } from "./rows";

/**
 * Pure registry backing `renderers.ts`: one renderer per row kind with a
 * fallback for kinds nobody registered. Generic over the renderer type so the
 * registry itself carries no react-native import and can be unit tested.
 */
export interface TimelineRowRendererRegistry<R> {
  /** Store `renderer` under `kind`; returns an unregister function. */
  register(kind: TimelineRowKind, renderer: R): () => void;
  /** The renderer registered for `kind`, or the fallback. */
  get(kind: TimelineRowKind): R;
  has(kind: TimelineRowKind): boolean;
  /** Kinds with a registered (non-fallback) renderer. */
  registeredKinds(): readonly TimelineRowKind[];
}

export function createTimelineRowRendererRegistry<R>(
  fallback: R,
): TimelineRowRendererRegistry<R> {
  const renderers = new Map<TimelineRowKind, R>();
  return {
    register(kind, renderer) {
      renderers.set(kind, renderer);
      return () => {
        if (renderers.get(kind) === renderer) renderers.delete(kind);
      };
    },
    get(kind) {
      return renderers.get(kind) ?? fallback;
    },
    has(kind) {
      return renderers.has(kind);
    },
    registeredKinds() {
      return Array.from(renderers.keys());
    },
  };
}
