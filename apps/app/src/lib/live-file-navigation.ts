import type {
  ExperimentalFileIdentity,
  ExperimentalFileLocation,
  ExperimentalLiveFileTarget,
} from "@get-bb/plugin-sdk";
export {
  normalizeExperimentalFileIdentity,
  normalizeExperimentalFileOpenOptions,
  normalizeExperimentalLiveFileTarget,
} from "@get-bb/plugin-sdk/internal/file-navigation-validation";
import type { FilePreviewLineRange } from "@bb/client-core";

export function getExperimentalFileLocationStart(
  location: ExperimentalFileLocation | null,
): { columnNumber: number | null; lineNumber: number | null } {
  if (location === null) return { columnNumber: null, lineNumber: null };
  if (location.kind === "line") {
    return { columnNumber: location.column, lineNumber: location.line };
  }
  return { columnNumber: null, lineNumber: location.startLine };
}

export function toFilePreviewLineRange(
  location: ExperimentalFileLocation | null,
): FilePreviewLineRange | null {
  if (location === null) return null;
  return {
    startLineNumber:
      location.kind === "line" ? location.line : location.startLine,
    endLineNumber: location.kind === "line" ? location.line : location.endLine,
  };
}

export function liveFileTargetFromIdentity(
  identity: ExperimentalFileIdentity,
): ExperimentalLiveFileTarget | null {
  const { source } = identity;
  switch (source.store) {
    case "workspace":
      return {
        kind: "workspace",
        environmentId: source.ownerId,
        path: source.path,
      };
    case "host":
      return { kind: "host", hostId: source.ownerId, path: source.path };
    case "thread-host":
      return null;
    case "thread-storage":
      return {
        kind: "thread-storage",
        threadId: source.ownerId,
        path: source.path,
      };
    case "project-attachment":
    case "tasks-attachment":
    case "remote":
      return null;
  }
}
