import type {
  ExperimentalFileLocation,
  ExperimentalFileOpenOptions,
} from "@get-bb/plugin-sdk";
import type { ThreadTimelineLocalFileLink } from "@/components/thread/timeline";
import type { FilePreviewLineRange } from "@bb/client-core";
import { areHostPathsEqual, getRelativeHostPath } from "@bb/domain";
import type { WorkspaceOpenTargetId } from "@bb/host-daemon-contract";
import { normalizeAbsoluteFilePath } from "@bb/shared-ui/lib/absolute-file-path";
import { isRoutePath } from "./route-paths";

const THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION =
  "Thread file links are only available when the thread has an environment.";
const THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION =
  "Thread file links must use absolute file paths.";

interface ResolveThreadLocalFileLinkArgs {
  fileOpenTargetIds: readonly WorkspaceOpenTargetId[];
  hostId: string | null;
  link: ThreadTimelineLocalFileLink;
  threadStorage: { rootPath: string; threadId: string } | null;
  workspace: { environmentId: string; rootPath: string } | null;
}

export type ThreadLocalFileLinkResolution =
  | { kind: "app-route" }
  | { kind: "error"; description: string }
  | {
      kind: "open-in-target";
      lineRange: FilePreviewLineRange | null;
      path: string;
      targetId: WorkspaceOpenTargetId;
    }
  | { kind: "preview"; options: ExperimentalFileOpenOptions };

export function toFileOpenLocation(
  lineRange: FilePreviewLineRange | null,
): ExperimentalFileLocation | null {
  return lineRange === null
    ? null
    : {
        kind: "range",
        startLine: lineRange.startLineNumber,
        endLine: lineRange.endLineNumber,
      };
}

function relativePathWithinRoot(path: string, rootPath: string): string | null {
  if (areHostPathsEqual(path, rootPath)) return null;
  const relativePath = getRelativeHostPath({ rootPath, candidatePath: path });
  return relativePath === null || relativePath === "" ? null : relativePath;
}

export function resolveThreadLocalFileLink({
  fileOpenTargetIds,
  hostId,
  link,
  threadStorage,
  workspace,
}: ResolveThreadLocalFileLinkArgs): ThreadLocalFileLinkResolution {
  if (isRoutePath({ path: link.path })) {
    return { kind: "app-route" };
  }

  const path = normalizeAbsoluteFilePath({ path: link.path });
  if (!path) {
    return {
      description: THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION,
      kind: "error",
    };
  }

  if (
    link.openTargetId !== null &&
    fileOpenTargetIds.includes(link.openTargetId)
  ) {
    return {
      kind: "open-in-target",
      lineRange: link.lineRange,
      path,
      targetId: link.openTargetId,
    };
  }

  const location = toFileOpenLocation(link.lineRange);
  const workspacePath =
    workspace === null
      ? null
      : relativePathWithinRoot(path, workspace.rootPath);
  if (workspace !== null && workspacePath !== null) {
    return {
      kind: "preview",
      options: {
        target: {
          kind: "workspace",
          environmentId: workspace.environmentId,
          path: workspacePath,
        },
        location,
      },
    };
  }

  const storagePath =
    threadStorage === null
      ? null
      : relativePathWithinRoot(path, threadStorage.rootPath);
  if (threadStorage !== null && storagePath !== null) {
    return {
      kind: "preview",
      options: {
        target: {
          kind: "thread-storage",
          threadId: threadStorage.threadId,
          path: storagePath,
        },
        location,
      },
    };
  }

  if (hostId === null) {
    return {
      description: THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION,
      kind: "error",
    };
  }

  return {
    kind: "preview",
    options: { target: { kind: "host", hostId, path }, location },
  };
}
