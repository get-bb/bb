import type { EnvironmentFilePreviewSource } from "@bb/client-core";
import {
  buildProjectFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import {
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  resolveRootRelativeFilePath,
} from "@/lib/absolute-file-path";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import type {
  MarkdownPreviewLocalFileLink,
  MarkdownPreviewLocalFileLinkHandler,
} from "@/components/ui/markdown-local-file-link";
import type {
  MarkdownLinkRouting,
  MarkdownLocalImageRouting,
} from "@/components/ui/markdown-link-routing";

export type MarkdownFilePreviewContentSource =
  | {
      environmentId: string | null;
      fileSource: EnvironmentFilePreviewSource;
      kind: "workspace";
      projectId: string | null;
      threadId: string | null;
    }
  | {
      environmentId: string | null;
      hostId: string | null;
      kind: "project";
      projectId: string;
    }
  | { kind: "host"; threadId: string }
  | { kind: "thread-storage"; threadId: string };

interface BuildMarkdownFilePreviewRoutingArgs {
  baseDir: string | undefined;
  contentSource: MarkdownFilePreviewContentSource;
  onOpenLink: MarkdownPreviewLinkHandler;
  onOpenLocalFileLink: MarkdownPreviewLocalFileLinkHandler;
  rootPath: string | null | undefined;
}

interface ResolveMarkdownFilePreviewRootPathArgs {
  filePath: string;
  rootPaths: readonly (string | null | undefined)[];
}

function buildLineRangeFragment(link: MarkdownPreviewLocalFileLink): string {
  if (link.fragment !== undefined) {
    return link.fragment;
  }
  if (link.lineRange === null) {
    return "";
  }
  if (link.lineRange.startLineNumber === link.lineRange.endLineNumber) {
    return `#L${link.lineRange.startLineNumber}`;
  }
  return `#L${link.lineRange.startLineNumber}-L${link.lineRange.endLineNumber}`;
}

function buildContentUrl(
  contentSource: MarkdownFilePreviewContentSource,
  link: MarkdownPreviewLocalFileLink,
  rootPath: string,
): string | null {
  if (contentSource.kind === "host") {
    return `${buildThreadHostFileContentUrl(
      contentSource.threadId,
      link.path,
    )}${buildLineRangeFragment(link)}`;
  }

  const relativePath = resolveRootRelativeFilePath({
    path: link.path,
    rootPath,
  });
  if (relativePath === null) {
    return null;
  }

  let contentUrl: string;
  switch (contentSource.kind) {
    case "workspace": {
      if (contentSource.fileSource.kind !== "working-tree") {
        return null;
      }
      if (contentSource.threadId !== null) {
        contentUrl = buildThreadWorktreeRawContentUrl(
          contentSource.threadId,
          relativePath,
        );
        break;
      }
      if (
        contentSource.projectId === null ||
        contentSource.environmentId === null
      ) {
        return null;
      }
      contentUrl = buildProjectFileContentUrl(
        contentSource.projectId,
        relativePath,
        { environmentId: contentSource.environmentId },
      );
      break;
    }
    case "project":
      contentUrl = buildProjectFileContentUrl(
        contentSource.projectId,
        relativePath,
        {
          ...(contentSource.environmentId !== null
            ? { environmentId: contentSource.environmentId }
            : contentSource.hostId !== null
              ? { hostId: contentSource.hostId }
              : {}),
        },
      );
      break;
    case "thread-storage":
      contentUrl = buildThreadStorageContentUrl(
        contentSource.threadId,
        relativePath,
      );
      break;
  }

  return `${contentUrl}${buildLineRangeFragment(link)}`;
}

export function buildMarkdownFilePreviewRouting({
  baseDir,
  contentSource,
  onOpenLink,
  onOpenLocalFileLink,
  rootPath,
}: BuildMarkdownFilePreviewRoutingArgs): MarkdownLinkRouting {
  if (rootPath === null || rootPath === undefined) {
    return { onOpenLink };
  }

  const absolutePaths = {
    kind: "contained",
    rootPath,
  } as const;
  const relativePaths =
    baseDir === undefined ? undefined : { baseDir, rootPath };
  const supportsLocalResources =
    contentSource.kind !== "workspace" ||
    (contentSource.fileSource.kind === "working-tree" &&
      (contentSource.threadId !== null ||
        (contentSource.projectId !== null &&
          contentSource.environmentId !== null)));
  const localImage: MarkdownLocalImageRouting | undefined =
    supportsLocalResources
      ? {
          absolutePaths,
          resolveSrc: (link) =>
            buildContentUrl(contentSource, link, rootPath) ?? "data:;base64,",
          ...(relativePaths === undefined ? {} : { relativePaths }),
        }
      : undefined;

  return {
    localFile: {
      absoluteLinks: absolutePaths,
      onOpenLink: onOpenLocalFileLink,
      ...(relativePaths === undefined ? {} : { relativeLinks: relativePaths }),
    },
    ...(localImage === undefined ? {} : { localImage }),
    onOpenLink,
  };
}

export function resolveMarkdownFilePreviewRootPath({
  filePath,
  rootPaths,
}: ResolveMarkdownFilePreviewRootPathArgs): string | null {
  const baseDir = getAbsoluteDirname({ path: filePath });
  for (const rootPath of rootPaths) {
    if (
      rootPath !== null &&
      rootPath !== undefined &&
      isAbsoluteFilePathWithinRoot({ candidatePath: baseDir, rootPath })
    ) {
      return rootPath;
    }
  }
  return null;
}
