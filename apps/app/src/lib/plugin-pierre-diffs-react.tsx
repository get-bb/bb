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
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ElementRef,
  type ReactNode,
} from "react";
import { PierreWorkerPoolBoundary } from "./pierre-worker-pool-boundary";
import {
  usePierreWorkerPool,
  useRequirePierreWorkerPool,
} from "./pierre-worker-pool-gate";
import { usePierreStrictModeRecoveryOptions } from "./pierre-strict-mode-recovery";

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
function gatePierreDiffComponent<
  P extends {
    options?: ComponentPropsWithoutRef<typeof FileDiff>["options"];
  },
>(Component: ComponentType<P>, name: string) {
  function PierreWorkerPoolGatedDiff(props: P) {
    const ready = useRequirePierreWorkerPool();
    const options = usePierreStrictModeRecoveryOptions(props.options);
    return (
      <PierreWorkerPoolBoundary>
        {ready ? <Component {...props} options={options} /> : null}
      </PierreWorkerPoolBoundary>
    );
  }
  PierreWorkerPoolGatedDiff.displayName = `PierreWorkerPoolGated(${name})`;
  return PierreWorkerPoolGatedDiff;
}

type CodeViewProps = ComponentPropsWithoutRef<typeof CodeView>;
type CodeViewHandle = ElementRef<typeof CodeView>;
type FileProps = ComponentPropsWithoutRef<typeof File>;
type UnresolvedFileProps = ComponentPropsWithoutRef<typeof UnresolvedFile>;

function GatedFile(props: FileProps) {
  const ready = useRequirePierreWorkerPool();
  const options = usePierreStrictModeRecoveryOptions(props.options);
  return (
    <PierreWorkerPoolBoundary>
      {ready ? <File {...props} options={options} /> : null}
    </PierreWorkerPoolBoundary>
  );
}

function GatedUnresolvedFile(props: UnresolvedFileProps) {
  const ready = useRequirePierreWorkerPool();
  const options = usePierreStrictModeRecoveryOptions(props.options);
  return (
    <PierreWorkerPoolBoundary>
      {ready ? <UnresolvedFile {...props} options={options} /> : null}
    </PierreWorkerPoolBoundary>
  );
}

/** `CodeView` forwards an imperative handle, so its gate must forward too. */
const GatedCodeView = forwardRef<CodeViewHandle, CodeViewProps>(
  function PierreWorkerPoolGatedCodeView(props, ref) {
    const ready = useRequirePierreWorkerPool();
    return (
      <PierreWorkerPoolBoundary>
        {ready ? <CodeView {...props} ref={ref} /> : null}
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
    File: GatedFile,
    FileDiff: gatePierreDiffComponent(FileDiff, "FileDiff"),
    GutterUtilitySlotStyles,
    MergeConflictSlotStyles,
    MultiFileDiff: gatePierreDiffComponent(MultiFileDiff, "MultiFileDiff"),
    PatchDiff: gatePierreDiffComponent(PatchDiff, "PatchDiff"),
    UnresolvedFile: GatedUnresolvedFile,
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
