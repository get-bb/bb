import type { PostRenderPhase } from "@pierre/diffs";
import { useMemo } from "react";

interface RerenderablePierreInstance {
  rerender(): void;
}

interface PierrePostRenderOptions<
  TInstance extends RerenderablePierreInstance,
> {
  onPostRender?(
    node: HTMLElement,
    instance: TInstance,
    phase: PostRenderPhase,
  ): unknown;
}

/**
 * Recovers a Pierre renderer after React replays its ref in development.
 *
 * Strict Mode can attach a replacement renderer to the first renderer's
 * retained plain DOM. Pierre's public `rerender()` method moves that replacement
 * through the normal render path, where its pending worker result is allowed to
 * repaint. A microtask runs after the replay: the discarded instance is already
 * disabled and safely no-ops, while the retained instance performs one forced
 * render. Production returns the original options object unchanged.
 */
export function usePierreStrictModeRecoveryOptions<
  TInstance extends RerenderablePierreInstance,
  TOptions extends PierrePostRenderOptions<TInstance>,
>(options: TOptions | undefined) {
  return useMemo(() => {
    if (!import.meta.env.DEV) return options;

    const onPostRender = options?.onPostRender;
    return {
      ...options,
      onPostRender(
        node: HTMLElement,
        instance: TInstance,
        phase: PostRenderPhase,
      ) {
        onPostRender?.(node, instance, phase);
        if (phase === "mount") {
          queueMicrotask(() => instance.rerender());
        }
      },
    };
  }, [options]);
}
