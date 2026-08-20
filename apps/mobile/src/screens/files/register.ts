// Leaf import (not the panel barrel): the barrel imports the registration
// manifest last, and this module is part of that manifest.
import {
  registerPanelLauncherContent,
  registerPanelTabContent,
} from "../panel/registry";
import {
  FilesLauncherContent,
  HostFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "./panel-contents";

/**
 * Workspace panel registration for the Files feature: the "files" launcher
 * (search + storage browser) and the three file-preview tab kinds. Imported
 * once by `src/screens/panel/contents/index.ts`.
 */
registerPanelLauncherContent("files", FilesLauncherContent, {
  retainWhenInactive: true,
});
registerPanelTabContent(
  "workspace-file-preview",
  WorkspaceFilePreviewTabContent,
);
registerPanelTabContent("host-file-preview", HostFilePreviewTabContent);
registerPanelTabContent(
  "thread-storage-file-preview",
  ThreadStorageFilePreviewTabContent,
);
