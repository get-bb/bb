import type { WorkspaceChangedFileSelection } from "./workspace-change-summary.js";
import type { BbNavigate, ExperimentalAppPanel } from "@get-bb/plugin-sdk";
import { gitDiffTab } from "./tab-reference.js";

export function openChangedFile(
  selection: WorkspaceChangedFileSelection,
  environmentId: string,
  navigate: BbNavigate,
  panel: ExperimentalAppPanel,
) {
  const { file, section } = selection;
  const target = { kind: "workspace" as const, environmentId, path: file.path };
  if (file.status === "A" || file.status === "??")
    return navigate.experimental_openFilePreview({ target, location: null });
  if (file.status === "D") {
    const ref = section.kind === "committed" ? section.mergeBaseRef : "HEAD";
    if (ref)
      return navigate.experimental_openFilePreview({
        target,
        location: null,
        experimental_revision: { ref, deleted: true },
      });
  }
  return panel.openFixedTab({
    surface: { kind: "current" },
    tab: gitDiffTab,
    target: { kind: "file", path: file.path },
  });
}
