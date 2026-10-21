import type { ComponentProps } from "react";
import { CoreGitDiffRendering } from "./CoreGitDiffRendering";
import {
  GitDiffCardBody as SharedGitDiffCardBody,
  GitDiffCardImagePreviewBody as SharedGitDiffCardImagePreviewBody,
} from "@bb/shared-ui/git-diff/card-body";
export * from "@bb/shared-ui/git-diff/card-body";
export function GitDiffCardBody(
  props: ComponentProps<typeof SharedGitDiffCardBody>,
) {
  return (
    <CoreGitDiffRendering>
      <SharedGitDiffCardBody {...props} />
    </CoreGitDiffRendering>
  );
}
export function GitDiffCardImagePreviewBody(
  props: ComponentProps<typeof SharedGitDiffCardImagePreviewBody>,
) {
  return (
    <CoreGitDiffRendering>
      <SharedGitDiffCardImagePreviewBody {...props} />
    </CoreGitDiffRendering>
  );
}
