import type { ReactNode } from "react";
import { GitDiffRendererProvider } from "@bb/shared-ui/git-diff/renderer-context";
import { DiffHost } from "@/components/code/DiffHost";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { CopyButton } from "@/components/ui/copy-button";
const renderers = { Diff: DiffHost, ImageLightbox, CopyButton };
export function CoreGitDiffRendering({ children }: { children: ReactNode }) {
  return (
    <GitDiffRendererProvider renderers={renderers}>
      {children}
    </GitDiffRendererProvider>
  );
}
