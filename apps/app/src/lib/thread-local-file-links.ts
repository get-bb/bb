import type { ThreadTimelineLocalFileLink } from "@/components/thread/timeline";
import type { FilePreviewLineRange } from "@bb/client-core";
import { areHostPathsEqual, getRelativeHostPath } from "@bb/domain";
import type { WorkspaceOpenTargetId } from "@bb/host-daemon-contract";
import {
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "./absolute-file-path";
import { isRoutePath } from "./route-paths";

const THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION =
  "Thread file links are only available when the thread has an environment.";
const THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION =
  "Thread file links must use absolute file paths.";

interface ResolveThreadLocalFileLinkArgs {
  fileOpenTargetIds: readonly WorkspaceOpenTargetId[];
  hostFileLinksAvailable: boolean;
  link: ThreadTimelineLocalFileLink;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

interface ThreadWorkspaceFileLinkOpenRequest {
  lineRange: FilePreviewLineRange | null;
  path: string;
  relativePath: string;
  workspaceRootPath: string;
}

interface ThreadHostFileLinkOpenRequest {
  lineRange: FilePreviewLineRange | null;
  path: string;
}

interface ThreadStorageFileLinkOpenRequest {
  lineRange: FilePreviewLineRange | null;
  path: string;
  relativePath: string;
  threadStorageRootPath: string;
}

interface ThreadOpenTargetFileLinkOpenRequest {
  lineRange: FilePreviewLineRange | null;
  path: string;
  targetId: WorkspaceOpenTargetId;
}

interface ThreadLocalFileLinkAppRouteResolution {
  kind: "app-route";
}

interface ThreadLocalFileLinkErrorResolution {
  description: string;
  kind: "error";
}

interface ThreadWorkspaceFileLinkOpenResolution {
  kind: "open-workspace-path";
  request: ThreadWorkspaceFileLinkOpenRequest;
}

interface ThreadHostFileLinkOpenResolution {
  kind: "open-host-path";
  request: ThreadHostFileLinkOpenRequest;
}

interface ThreadOpenTargetFileLinkOpenResolution {
  kind: "open-in-target";
  request: ThreadOpenTargetFileLinkOpenRequest;
}

interface ThreadStorageFileLinkOpenResolution {
  kind: "open-thread-storage-path";
  request: ThreadStorageFileLinkOpenRequest;
}

interface NormalizeLocalFilePathWithinRootArgs {
  linkPath: string;
  rootPath: string;
}

interface NormalizedLocalFilePathWithinRoot {
  path: string;
  relativePath: string;
  rootPath: string;
}

export type ThreadLocalFileLinkResolution =
  | ThreadLocalFileLinkAppRouteResolution
  | ThreadLocalFileLinkErrorResolution
  | ThreadWorkspaceFileLinkOpenResolution
  | ThreadHostFileLinkOpenResolution
  | ThreadOpenTargetFileLinkOpenResolution
  | ThreadStorageFileLinkOpenResolution;

function normalizeLocalFilePathWithinRoot(
  args: NormalizeLocalFilePathWithinRootArgs,
): NormalizedLocalFilePathWithinRoot | null {
  const normalizedRootPath = normalizeAbsoluteFilePath({ path: args.rootPath });
  if (!normalizedRootPath) {
    return null;
  }

  const normalizedPath = normalizeAbsoluteFilePath({ path: args.linkPath });
  if (!normalizedPath) {
    return null;
  }

  if (
    !isAbsoluteFilePathWithinRoot({
      candidatePath: normalizedPath,
      rootPath: normalizedRootPath,
    }) ||
    areHostPathsEqual(normalizedPath, normalizedRootPath)
  ) {
    return null;
  }

  const relativePath =
    getRelativeHostPath({
      rootPath: normalizedRootPath,
      candidatePath: normalizedPath,
    }) ?? "";

  return {
    path: normalizedPath,
    relativePath,
    rootPath: normalizedRootPath,
  };
}

export function resolveThreadLocalFileLink(
  args: ResolveThreadLocalFileLinkArgs,
): ThreadLocalFileLinkResolution {
  if (isRoutePath({ path: args.link.path })) {
    return {
      kind: "app-route",
    };
  }

  const normalizedPath = normalizeAbsoluteFilePath({ path: args.link.path });
  if (!normalizedPath) {
    return {
      description: THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION,
      kind: "error",
    };
  }

  const openTargetId = args.link.openTargetId;
  if (openTargetId !== null && args.fileOpenTargetIds.includes(openTargetId)) {
    return {
      kind: "open-in-target",
      request: {
        lineRange: args.link.lineRange,
        path: normalizedPath,
        targetId: openTargetId,
      },
    };
  }

  const openRequest =
    args.workspaceRootPath === null
      ? null
      : normalizeLocalFilePathWithinRoot({
          linkPath: normalizedPath,
          rootPath: args.workspaceRootPath,
        });

  if (openRequest) {
    return {
      kind: "open-workspace-path",
      request: {
        lineRange: args.link.lineRange,
        path: openRequest.path,
        relativePath: openRequest.relativePath,
        workspaceRootPath: openRequest.rootPath,
      },
    };
  }

  const storageOpenRequest =
    args.threadStorageRootPath === null
      ? null
      : normalizeLocalFilePathWithinRoot({
          linkPath: normalizedPath,
          rootPath: args.threadStorageRootPath,
        });

  if (storageOpenRequest) {
    return {
      kind: "open-thread-storage-path",
      request: {
        lineRange: args.link.lineRange,
        path: storageOpenRequest.path,
        relativePath: storageOpenRequest.relativePath,
        threadStorageRootPath: storageOpenRequest.rootPath,
      },
    };
  }

  if (!args.hostFileLinksAvailable) {
    return {
      description: THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION,
      kind: "error",
    };
  }

  return {
    kind: "open-host-path",
    request: {
      lineRange: args.link.lineRange,
      path: normalizedPath,
    },
  };
}
