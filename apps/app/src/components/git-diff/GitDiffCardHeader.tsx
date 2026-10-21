import type { ComponentProps } from "react";
import { CoreGitDiffRendering } from "./CoreGitDiffRendering";
import { GitDiffCardHeader as SharedGitDiffCardHeader } from "@bb/shared-ui/git-diff/card-header";
export * from "@bb/shared-ui/git-diff/card-header";
export function GitDiffCardHeader(
  props: ComponentProps<typeof SharedGitDiffCardHeader>,
) {
  return (
    <CoreGitDiffRendering>
      <SharedGitDiffCardHeader {...props} />
    </CoreGitDiffRendering>
  );
}
