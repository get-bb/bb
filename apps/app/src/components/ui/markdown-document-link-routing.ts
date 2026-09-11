import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import { normalizeExperimentalLiveFileTarget } from "@/lib/live-file-navigation";
import {
  buildAbsoluteFilePath,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "@/lib/absolute-file-path";
import {
  buildThreadStorageRawContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import { buildMarkdownFileImageRouting } from "./markdown-file-image-routing";
import type { MarkdownLinkRouting } from "./markdown-link-routing";

export function buildMarkdownDocumentLinkRouting({
  document,
  messageRouting,
  openFilePreview,
}: {
  document: unknown;
  messageRouting: MarkdownLinkRouting;
  openFilePreview: (intent: ExperimentalFileOpenOptions) => boolean;
}): MarkdownLinkRouting {
  if (typeof document !== "object" || document === null) return {};
  if (
    !("target" in document) ||
    !("rootPath" in document) ||
    !("threadId" in document)
  )
    return {};
  const target = normalizeExperimentalLiveFileTarget(document.target);
  if (
    target === null ||
    target.kind === "host" ||
    typeof document.rootPath !== "string" ||
    typeof document.threadId !== "string" ||
    !document.threadId.trim() ||
    (target.kind === "thread-storage" && target.threadId !== document.threadId)
  )
    return {};
  const rootPath = normalizeAbsoluteFilePath({ path: document.rootPath });
  if (rootPath === null) return {};
  const threadId = document.threadId;
  const routing = buildMarkdownFileImageRouting({
    path: buildAbsoluteFilePath({ path: target.path, rootPath }),
    rootPath,
    threadId,
    resolveRelativeSrc: (path) =>
      target.kind === "workspace"
        ? buildThreadWorktreeRawContentUrl(threadId, path)
        : buildThreadStorageRawContentUrl(threadId, path),
  });
  return {
    ...routing,
    onOpenLink: messageRouting.onOpenLink,
    localFile: {
      absoluteLinks: { kind: "trusted-host" },
      relativeLinks: routing?.localImage?.relativePaths,
      onOpenLink: (link) => {
        if (
          !isAbsoluteFilePathWithinRoot({ candidatePath: link.path, rootPath })
        ) {
          return messageRouting.localFile?.onOpenLink(link) ?? false;
        }
        return openFilePreview({
          target: {
            ...target,
            path: link.path.slice(rootPath === "/" ? 1 : rootPath.length + 1),
          },
          location:
            link.lineRange === null
              ? null
              : {
                  kind: "range",
                  startLine: link.lineRange.startLineNumber,
                  endLine: link.lineRange.endLineNumber,
                },
        });
      },
    },
  };
}
