import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  experimental_Diff,
  experimental_CopyButton,
  experimental_ImageLightbox,
} from "@get-bb/plugin-sdk/app";
import type {
  DiffProps,
  ExperimentalCopyButtonProps,
  ExperimentalImageLightboxProps,
  ExperimentalDiffFullFileContents,
} from "@get-bb/plugin-sdk";
import type { ParsedGitDiffFile } from "./git-diff-parsing.js";
import { buildFileDiffPatchText } from "./git-diff-patch-text.js";

export type DiffPresentation = Required<
  Pick<DiffProps, "view" | "overflow" | "showLineNumbers">
>;
export interface GitDiffRendererProps extends DiffPresentation {
  file: ParsedGitDiffFile;
  patchText?: string;
  fullFileContents: ExperimentalDiffFullFileContents | null;
  onSelectionAddToChat?: (text: string) => void;
}
interface GitDiffRenderers {
  Diff: ComponentType<GitDiffRendererProps>;
  CopyButton: ComponentType<ExperimentalCopyButtonProps>;
  ImageLightbox: ComponentType<ExperimentalImageLightboxProps>;
}
function PluginDiff({
  file,
  patchText,
  fullFileContents,
  onSelectionAddToChat,
  ...props
}: GitDiffRendererProps) {
  const Diff = experimental_Diff;
  return (
    <Diff
      {...props}
      path={file.name}
      patch={patchText ?? buildFileDiffPatchText(file)}
      experimental_fullFileContents={fullFileContents ?? undefined}
      experimental_onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}
const Renderers = createContext<GitDiffRenderers>({
  Diff: PluginDiff,
  CopyButton: experimental_CopyButton,
  ImageLightbox: experimental_ImageLightbox,
});
export function GitDiffRendererProvider({
  renderers,
  children,
}: {
  renderers: GitDiffRenderers;
  children: ReactNode;
}) {
  return <Renderers.Provider value={renderers}>{children}</Renderers.Provider>;
}
export function DiffHost(props: GitDiffRendererProps) {
  const { Diff } = useContext(Renderers);
  return <Diff {...props} />;
}
export function CopyButton(props: ExperimentalCopyButtonProps) {
  const { CopyButton: Copy } = useContext(Renderers);
  return <Copy {...props} />;
}
export function ImageLightbox(props: ExperimentalImageLightboxProps) {
  const { ImageLightbox: Lightbox } = useContext(Renderers);
  return <Lightbox {...props} />;
}
