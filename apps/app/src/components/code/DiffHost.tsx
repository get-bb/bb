import { useMemo } from "react";
import type { ExperimentalDiffFullFileContents } from "@get-bb/plugin-sdk";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import type { ParsedGitDiffFile } from "@/components/git-diff/git-diff-parsing";
import { buildFileDiffPatchText } from "@/components/git-diff/git-diff-patch-text";
import { BbDiffSplit } from "./BbDiffSplit";
import { useDiffRendererReplacement } from "./codeRendererProvider";
import {
  DEFAULT_CODE_OVERFLOW,
  DEFAULT_DIFF_VIEW,
  type DiffPresentation,
} from "./code-rendering";

const DIFF_RENDERER_SLOT_KIND = "diffRenderer";

interface DiffHostProps extends Partial<DiffPresentation> {
  file: ParsedGitDiffFile;
  patchText?: string;
  fullFileContents: ExperimentalDiffFullFileContents | null;
  className?: string;
  onSelectionAddToChat?: (text: string) => void;
}

export function DiffHost({
  file,
  patchText,
  fullFileContents,
  view = DEFAULT_DIFF_VIEW,
  overflow = DEFAULT_CODE_OVERFLOW,
  showLineNumbers = true,
  className,
  onSelectionAddToChat,
}: DiffHostProps) {
  const replacement = useDiffRendererReplacement();
  const isReplaced = replacement.kind === "plugin";
  const semanticPatch = useMemo(
    () => (isReplaced ? (patchText ?? buildFileDiffPatchText(file)) : ""),
    [file, isReplaced, patchText],
  );

  const original = (
    <BbDiffSplit
      file={file}
      patchText={patchText}
      fullFileContents={fullFileContents}
      view={view}
      overflow={overflow}
      showLineNumbers={showLineNumbers}
      className={className}
      onSelectionAddToChat={onSelectionAddToChat}
    />
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
          />
        </div>
      )}
    </PluginReplacementSlot>
  );
}
