import {
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import type { ParsedGitDiffFile } from "@/components/git-diff/git-diff-parsing";
import { buildFileDiffPatchText } from "@/components/git-diff/git-diff-patch-text";
import { useDiffRendererReplacement } from "./codeRendererProvider";
import {
  DEFAULT_CODE_OVERFLOW,
  DEFAULT_DIFF_VIEW,
  type DiffPresentation,
} from "./code-rendering";
import { registerSelectAllCopyText } from "@/lib/select-all-scope";
import { cn } from "@bb/shared-ui/lib/utils";

/** Shared by the mount and the host's crash check. */
export const DIFF_RENDERER_SLOT_KIND = "diffRenderer";

const BbDiff = lazy(() => import("./BbDiff"));

export interface DiffHostProps extends Partial<DiffPresentation> {
  /**
   * The parsed diff to render. Callers parse it anyway for their own header,
   * and the diff panel additionally enriches it with full file contents so the
   * renderer can expand context between hunks.
   */
  file: ParsedGitDiffFile;
  /**
   * The patch text `file` was parsed from, when the caller still has it. A
   * plugin replacement is handed this verbatim; without it the host
   * reconstructs an equivalent single-file patch from `file`.
   */
  patchText?: string;
  className?: string;
  /**
   * Forwarded to BB's renderer; see {@link BbDiffProps.expansionLineCount}.
   * Never reaches a plugin replacement — context expansion is a BB renderer
   * capability, not part of the semantic contract.
   */
  expansionLineCount?: number;
  /** Rendered while BB's renderer chunk loads. */
  fallback?: ReactNode;
  onSelectionAddToChat?: (text: string) => void;
}

function DiffSelectionScope({
  children,
  className,
  getCopyText,
}: {
  children: ReactNode;
  className?: string;
  getCopyText: () => string;
}) {
  const unregisterRef = useRef<(() => void) | null>(null);
  const setScopeRef = useCallback(
    (scope: HTMLDivElement | null) => {
      unregisterRef.current?.();
      unregisterRef.current =
        scope === null ? null : registerSelectAllCopyText(scope, getCopyText);
    },
    [getCopyText],
  );
  return (
    <div
      ref={setScopeRef}
      className={cn("select-text", className)}
      data-select-all-scope=""
    >
      {children}
    </div>
  );
}

/**
 * The host boundary for diff rendering (plugin design: exclusive replacement
 * surfaces). Every BB surface that draws a text diff — timeline file changes,
 * the environment diff panel's file bodies — and every plugin that calls
 * `experimental_Diff` renders through here, so one
 * `experimental_diffRenderer` registration replaces them all at once.
 *
 * BB's own renderer sits behind `lazy()`. A plugin replacement that never
 * delegates therefore never downloads it, and `experimental_Original` costs
 * nothing until it is actually rendered.
 */
export function DiffHost({
  file,
  patchText,
  view = DEFAULT_DIFF_VIEW,
  overflow = DEFAULT_CODE_OVERFLOW,
  showLineNumbers = true,
  className,
  expansionLineCount,
  fallback = null,
  onSelectionAddToChat,
}: DiffHostProps) {
  const replacement = useDiffRendererReplacement();
  const isReplaced = replacement.kind === "plugin";
  // Only reconstructed when a replacement will actually read it: the walk is
  // proportional to the rendered hunks, and BB's own renderer never needs it.
  const semanticPatch = useMemo(
    () => (isReplaced ? (patchText ?? buildFileDiffPatchText(file)) : ""),
    [file, isReplaced, patchText],
  );
  const getCopyText = useCallback(
    () => patchText ?? buildFileDiffPatchText(file),
    [file, patchText],
  );

  const original = (
    <DiffSelectionScope className={className} getCopyText={getCopyText}>
      <Suspense fallback={fallback}>
        <BbDiff
          file={file}
          view={view}
          overflow={overflow}
          showLineNumbers={showLineNumbers}
          expansionLineCount={expansionLineCount}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      </Suspense>
    </DiffSelectionScope>
  );

  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind={DIFF_RENDERER_SLOT_KIND}
    >
      {(slot, BoundOriginal) => (
        <DiffSelectionScope className={className} getCopyText={getCopyText}>
          <slot.component
            patch={semanticPatch}
            path={file.name}
            view={view}
            overflow={overflow}
            showLineNumbers={showLineNumbers}
            experimental_Original={BoundOriginal}
          />
        </DiffSelectionScope>
      )}
    </PluginReplacementSlot>
  );
}
