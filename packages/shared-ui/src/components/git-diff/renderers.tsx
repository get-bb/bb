import {
  createContext,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  experimental_Diff,
  experimental_ImageLightbox,
} from "@get-bb/plugin-sdk/app";
import type {
  CodeOverflowMode,
  DiffViewMode,
  ExperimentalDiffFullFileContents,
  ExperimentalImageLightboxProps,
} from "@get-bb/plugin-sdk";
import { CopyIconButton } from "../ui/copy-button";
import { useSdkClipboardCopy } from "../ui/sdk-clipboard-copy";
import type { ParsedGitDiffFile } from "./git-diff-parsing";
import { buildFileDiffPatchText } from "./git-diff-patch-text";

export interface DiffPresentation {
  view: DiffViewMode;
  overflow: CodeOverflowMode;
  showLineNumbers: boolean;
}

export interface GitDiffRendererProps extends DiffPresentation {
  file: ParsedGitDiffFile;
  patchText?: string;
  fullFileContents: ExperimentalDiffFullFileContents | null;
  onSelectionAddToChat?: (text: string) => void;
}

export interface GitDiffCopyButtonProps {
  text: string;
  label: string;
  className?: string;
}

export interface GitDiffRenderers {
  Diff: ComponentType<GitDiffRendererProps>;
  ImageLightbox: ComponentType<ExperimentalImageLightboxProps>;
  CopyButton: ComponentType<GitDiffCopyButtonProps>;
}

function SdkDiff({
  file,
  patchText,
  fullFileContents,
  view,
  overflow,
  showLineNumbers,
}: GitDiffRendererProps) {
  const patch = useMemo(
    () => patchText ?? buildFileDiffPatchText(file),
    [file, patchText],
  );
  const Diff = experimental_Diff;
  return (
    <Diff
      patch={patch}
      path={file.name}
      view={view}
      overflow={overflow}
      showLineNumbers={showLineNumbers}
      experimental_fullFileContents={fullFileContents ?? undefined}
    />
  );
}

function SdkImageLightbox(props: ExperimentalImageLightboxProps) {
  const ImageLightbox = experimental_ImageLightbox;
  return <ImageLightbox {...props} />;
}

function SdkCopyButton({ text, label, className }: GitDiffCopyButtonProps) {
  const { copied, copy } = useSdkClipboardCopy({ text });
  return (
    <CopyIconButton
      label={label}
      className={className}
      copied={copied}
      onCopy={() => void copy()}
    />
  );
}

const SDK_GIT_DIFF_RENDERERS: GitDiffRenderers = {
  Diff: SdkDiff,
  ImageLightbox: SdkImageLightbox,
  CopyButton: SdkCopyButton,
};

const GitDiffRenderersContext = createContext<GitDiffRenderers>(
  SDK_GIT_DIFF_RENDERERS,
);

export function GitDiffRendererProvider({
  renderers,
  children,
}: {
  renderers: GitDiffRenderers;
  children: ReactNode;
}) {
  return (
    <GitDiffRenderersContext.Provider value={renderers}>
      {children}
    </GitDiffRenderersContext.Provider>
  );
}

export function GitDiffRenderer(props: GitDiffRendererProps) {
  const { Diff } = useContext(GitDiffRenderersContext);
  return <Diff {...props} />;
}

export function GitDiffImageLightbox(props: ExperimentalImageLightboxProps) {
  const { ImageLightbox } = useContext(GitDiffRenderersContext);
  return <ImageLightbox {...props} />;
}

export function GitDiffCopyButton(props: GitDiffCopyButtonProps) {
  const { CopyButton } = useContext(GitDiffRenderersContext);
  return <CopyButton {...props} />;
}
