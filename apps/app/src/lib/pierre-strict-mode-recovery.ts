import type { PostRenderPhase } from "@pierre/diffs";
import { useMemo } from "react";

interface RerenderablePierreInstance {
  rerender(): void;
}

interface PierrePostRenderOptions<
  TInstance extends RerenderablePierreInstance,
  TNode = HTMLElement,
> {
  onPostRender?(
    node: TNode,
    instance: TInstance,
    phase: PostRenderPhase,
  ): unknown;
}

export function withPierreStrictModeRecovery<
  TInstance extends RerenderablePierreInstance,
  TNode,
  TOptions extends PierrePostRenderOptions<TInstance, TNode>,
>(options: TOptions | undefined) {
  if (!import.meta.env.DEV) return options;

  const onPostRender = options?.onPostRender;
  return {
    ...options,
    onPostRender(node: TNode, instance: TInstance, phase: PostRenderPhase) {
      onPostRender?.(node, instance, phase);
      if (phase === "mount") {
        queueMicrotask(() => instance.rerender());
      }
    },
  };
}

export function usePierreStrictModeRecoveryOptions<
  TInstance extends RerenderablePierreInstance,
  TOptions extends PierrePostRenderOptions<TInstance>,
>(options: TOptions | undefined) {
  return useMemo(
    () =>
      withPierreStrictModeRecovery<TInstance, HTMLElement, TOptions>(options),
    [options],
  );
}
