// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  createFilePreviewLineRange,
  getFilePreviewLineRangeStart,
  isHtmlFilePreviewPath,
  normalizeFilePreviewMimeType,
  isMarkdownFilePreview,
  isCsvFilePreview,
  buildFilePreview,
} from "@bb/client-core";
export type {
  FilePreviewTarget,
  TextFilePreview,
  FilePreview,
  EnvironmentFilePreviewSource,
  WorkspaceFilePreviewStatusLabel,
  FilePreviewLineRange,
  WorkspaceFileTabState,
  HostFileTabState,
  ThreadStorageFileTabState,
} from "@bb/client-core";
