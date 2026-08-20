import {
  CodeView,
  File,
  FileDiff,
  GutterUtilitySlotStyles,
  MergeConflictSlotStyles,
  MultiFileDiff,
  PatchDiff,
  UnresolvedFile,
  Virtualizer,
  VirtualizerContext,
  WorkerPoolContext,
  noopRender,
  renderDiffChildren,
  renderFileChildren,
  templateRender,
  useFileDiffInstance,
  useFileInstance,
  useStableCallback,
  useVirtualizer,
  useWorkerPool,
} from "@pierre/diffs/react";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ElementRef,
  type ReactNode,
} from "react";
import type { WorkerPoolManager, WorkerStats } from "@pierre/diffs/worker";
import { PierreWorkerPoolBoundary } from "./pierre-worker-pool-boundary";
import {
  usePierreWorkerPool,
  useRequirePierreWorkerPool,
} from "./pierre-worker-pool-gate";

function isWorkerPoolSettled(stats: WorkerStats): boolean {
  return (
    stats.managerState === "initialized" &&
    stats.busyWorkers === 0 &&
    stats.queuedTasks === 0 &&
    stats.activeTasks === 0
  );
}

/**
 * Re-render one time after this mount's worker work settles.
 *
 * In development, React Strict Mode releases pierre's first renderer and
 * attaches a replacement to the same custom element. The first renderer may
 * already have painted a plain AST. Pierre then delivers the highlighted AST
 * to the replacement, but its fresh cache starts with `highlighted: true`, so
 * it does not request the repaint that would replace that retained plain DOM.
 * Production has no simulated remount, which is why the failure is dev-only.
 *
 * Changing pierre's options after the worker settles forces the retained
 * renderer to paint its highlighted AST. The private option is ignored by
 * pierre's rendering options, so it has no visual effect of its own. Stop
 * listening after that first settled state: a page can have many plugin
 * diffs, and every pool event must not re-render every one of them.
 */
function useRerenderAfterWorkerPoolSettles(
  pool: WorkerPoolManager | undefined,
): number {
  const settledPoolRef = useRef<WorkerPoolManager | undefined>(undefined);
  const [settleVersion, setSettleVersion] = useState(0);

  useEffect(() => {
    if (pool === undefined || settledPoolRef.current === pool) return;

    let unsubscribe: (() => void) | undefined;
    let subscriptionInstalled = false;
    const handleStats = (stats: WorkerStats) => {
      if (!isWorkerPoolSettled(stats)) return;
      settledPoolRef.current = pool;
      if (subscriptionInstalled) unsubscribe?.();
      setSettleVersion((version) => version + 1);
    };

    // Pierre calls the subscriber immediately. If the pool already settled,
    // unsubscribe as soon as subscribeToStatChanges returns.
    unsubscribe = pool.subscribeToStatChanges(handleStats);
    subscriptionInstalled = true;
    if (settledPoolRef.current === pool) unsubscribe();
    return unsubscribe;
  }, [pool]);

  return settleVersion;
}

function addWorkerSettlementOption<P extends object>(
  props: P,
  settleVersion: number,
) {
  if (settleVersion === 0) return props;
  const options =
    "options" in props && typeof props.options === "object"
      ? props.options
      : undefined;
  return {
    ...props,
    options: {
      ...options,
      __bbWorkerSettlementVersion: settleVersion,
    },
  };
}

/**
 * The `@pierre/diffs/react` surface handed to plugin bundles through the
 * runtime shim, with every diff component wrapped in the host's worker-pool
 * gate.
 *
 * Plugins render `FileDiff` and friends straight from the shimmed specifier;
 * they cannot call `useRequirePierreWorkerPool` themselves. Pierre captures
 * the worker pool when it creates the diff instance, so an ungated plugin
 * diff rendered before the workspace built the pool would highlight on the
 * main thread for good. The wrappers ask for the pool and render the real
 * component once it exists. Everything else on the namespace passes through
 * unchanged.
 *
 * Named imports on purpose, not `import * as`: a namespace import marks
 * every export of the barrel as used, including pierre's own
 * `WorkerPoolContextProvider`, whose module-level import of the pool manager
 * (and Shiki behind it) would then ride along with the tiny
 * `WorkerPoolContext` object the thread route imports statically. The list
 * mirrors `RUNTIME_EXPORT_MANIFEST["@pierre/diffs/react"]` in
 * packages/plugin-build; the plugin-frontend test keeps them in sync.
 */
function gatePierreComponent<P extends object>(
  Component: ComponentType<P>,
  name: string,
) {
  function PierreWorkerPoolGated(props: P) {
    const ready = useRequirePierreWorkerPool();
    const pool = usePierreWorkerPool();
    const settleVersion = useRerenderAfterWorkerPoolSettles(pool);
    const renderProps = addWorkerSettlementOption(props, settleVersion);
    return (
      <PierreWorkerPoolBoundary>
        {ready ? <Component {...renderProps} /> : null}
      </PierreWorkerPoolBoundary>
    );
  }
  PierreWorkerPoolGated.displayName = `PierreWorkerPoolGated(${name})`;
  return PierreWorkerPoolGated;
}

type CodeViewProps = ComponentPropsWithoutRef<typeof CodeView>;
type CodeViewHandle = ElementRef<typeof CodeView>;

/** `CodeView` forwards an imperative handle, so its gate must forward too. */
const GatedCodeView = forwardRef<CodeViewHandle, CodeViewProps>(
  function PierreWorkerPoolGatedCodeView(props, ref) {
    const ready = useRequirePierreWorkerPool();
    const pool = usePierreWorkerPool();
    const settleVersion = useRerenderAfterWorkerPoolSettles(pool);
    const renderProps = addWorkerSettlementOption(props, settleVersion);
    return (
      <PierreWorkerPoolBoundary>
        {ready ? <CodeView {...renderProps} ref={ref} /> : null}
      </PierreWorkerPoolBoundary>
    );
  },
);

/**
 * The host owns the one worker pool (plugin design §5.5), so a plugin that
 * mounts pierre's provider gets the host pool through context instead of
 * spawning its own workers.
 */
function HostWorkerPoolContextProvider({ children }: { children: ReactNode }) {
  return <PierreWorkerPoolBoundary>{children}</PierreWorkerPoolBoundary>;
}

/**
 * Pierre's `useWorkerPool` reads pierre's context, which the host provides
 * only around gated diff elements; the host pool itself is what a plugin
 * means when it asks.
 */
function useHostWorkerPool(): ReturnType<typeof useWorkerPool> {
  return usePierreWorkerPool();
}

export function createGatedPierreDiffsReact(): Record<string, unknown> {
  return {
    CodeView: GatedCodeView,
    File: gatePierreComponent(File, "File"),
    FileDiff: gatePierreComponent(FileDiff, "FileDiff"),
    GutterUtilitySlotStyles,
    MergeConflictSlotStyles,
    MultiFileDiff: gatePierreComponent(MultiFileDiff, "MultiFileDiff"),
    PatchDiff: gatePierreComponent(PatchDiff, "PatchDiff"),
    UnresolvedFile: gatePierreComponent(UnresolvedFile, "UnresolvedFile"),
    Virtualizer,
    VirtualizerContext,
    WorkerPoolContext,
    WorkerPoolContextProvider: HostWorkerPoolContextProvider,
    noopRender,
    renderDiffChildren,
    renderFileChildren,
    templateRender,
    useFileDiffInstance,
    useFileInstance,
    useStableCallback,
    useVirtualizer,
    useWorkerPool: useHostWorkerPool,
  };
}
