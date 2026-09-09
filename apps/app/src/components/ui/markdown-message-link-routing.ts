import type {
  MarkdownLinkRouting,
  MarkdownLocalFileLinkRouting,
} from "./markdown-link-routing.js";
import type { MarkdownPreviewLinkHandler } from "./markdown-link.js";
import type { MarkdownPreviewLocalFileLinkHandler } from "./markdown-local-file-link.js";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";

interface BuildMarkdownMessageLinkRoutingArgs {
  onOpenLink?: MarkdownPreviewLinkHandler;
  onOpenLocalFileLink?: MarkdownPreviewLocalFileLinkHandler;
  threadId?: string;
  workspaceRootPath?: string;
}

export function buildMarkdownMessageLinkRouting({
  onOpenLink,
  onOpenLocalFileLink,
  threadId,
  workspaceRootPath,
}: BuildMarkdownMessageLinkRoutingArgs): MarkdownLinkRouting | undefined {
  if (
    onOpenLink === undefined &&
    onOpenLocalFileLink === undefined &&
    threadId === undefined
  ) {
    return undefined;
  }

  const routing: MarkdownLinkRouting = {};
  if (onOpenLink !== undefined) {
    routing.onOpenLink = onOpenLink;
  }
  if (threadId !== undefined) {
    routing.localImage = {
      absolutePaths: { kind: "trusted-host" },
      resolveSrc: ({ path }) => buildThreadHostFileContentUrl(threadId, path),
      ...(workspaceRootPath === undefined
        ? {}
        : {
            relativePaths: {
              baseDir: workspaceRootPath,
              rootPath: workspaceRootPath,
            },
          }),
    };
  }
  if (onOpenLocalFileLink !== undefined) {
    const localFile: MarkdownLocalFileLinkRouting = {
      absoluteLinks: { kind: "trusted-host" },
      onOpenLink: onOpenLocalFileLink,
    };
    if (workspaceRootPath !== undefined) {
      localFile.relativeLinks = {
        baseDir: workspaceRootPath,
        rootPath: workspaceRootPath,
      };
    }
    routing.localFile = localFile;
  }
  return routing;
}
