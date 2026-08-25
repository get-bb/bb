import { Suspense, lazy, useMemo, type ReactNode } from "react";
import type { ExperimentalDiffFullFileContents } from "@get-bb/plugin-sdk";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { deprecatedOriginalAlias } from "@/lib/plugin-sdk-deprecated-aliases";
import type { ParsedGitDiffFile } from "@/components/git-diff/git-diff-parsing";
import { buildFileDiffPatchText } from "@/components/git-diff/git-diff-patch-text";
import { useDiffRendererReplacement } from "./codeRendererProvider";
import {
  DEFAULT_CODE_OVERFLOW,
  DEFAULT_DIFF_VIEW,
  type DiffPresentation,
} from "./code-rendering";

/** Shared by the mount and the host's crash check. */
const DIFF_RENDERER_SLOT_KIND = "diffRenderer";

const BbDiff = lazy(() => import("./BbDiff"));

interface DiffHostProps extends Partial<DiffPresentation> {
  /**
   * The parsed diff to render. Callers parse it anyway for their own header,
   * while the built-in renderer lazily enriches it if full contents are
   * available and consistent with the patch.
   */
  file: ParsedGitDiffFile;
  /**
   * The patch text `file` was parsed from, when the caller still has it. A
   * plugin replacement is handed this verbatim; without it the host
   * reconstructs an equivalent single-file patch from `file`.
   */
  patchText?: string;
  /** Resolved semantic context forwarded to renderer replacements. */
  fullFileContents: ExperimentalDiffFullFileContents | null;
  className?: string;
  /** Rendered while BB's renderer chunk loads. */
  fallback?: ReactNode;
  onSelectionAddToChat?: (text: string) => void;
}

/**
 * The host boundary for diff rendering (plugin design: exclusive replacement
 * surfaces). Every BB surface that draws a text diff — timeline file changes,
 * the environment diff panel's file bodies — and every plugin that calls
 * `experimental_Diff` renders through here, so one
 * `experimental_diffRenderer` registration replaces them all at once.
 * Resolved full-file text is semantic input: a replacement receives the plain
 * text sides, while the built-in renderer validates and parses them only if it
 * actually mounts.
 *
 * BB's own renderer sits behind `lazy()`. A plugin replacement that never
 * delegates therefore never downloads it, and `Original` costs
 * nothing until it is actually rendered.
 */
export function DiffHost({
  file,
  patchText,
  fullFileContents,
  view = DEFAULT_DIFF_VIEW,
  overflow = DEFAULT_CODE_OVERFLOW,
  showLineNumbers = true,
  className,
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

  const original = (
    <Suspense fallback={fallback}>
      <BbDiff
        file={file}
        patchText={patchText}
        fullFileContents={fullFileContents}
        view={view}
        overflow={overflow}
        showLineNumbers={showLineNumbers}
        className={className}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    </Suspense>
  );

  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind={DIFF_RENDERER_SLOT_KIND}
    >
      {(slot, BoundOriginal) => (
        <div className={className}>
          <slot.component
            patch={semanticPatch}
            path={file.name}
            view={view}
            overflow={overflow}
            showLineNumbers={showLineNumbers}
            experimental_fullFileContents={fullFileContents}
            Original={BoundOriginal}
            experimental_Original={deprecatedOriginalAlias(BoundOriginal)}
          />
        </div>
      )}
    </PluginReplacementSlot>
  );
}
