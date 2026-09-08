import type { MarkdownLinkRouting } from "./markdown-link-routing";
import {
  getAbsoluteDirname,
  buildAbsoluteFilePath,
  normalizeAbsoluteFilePath,
} from "@/lib/absolute-file-path";
import {
  buildFilePreviewLeaseContentUrl,
  buildThreadHostFileContentUrl,
  getFilePreviewLeaseBaseUrl,
} from "@/lib/file-content-urls";

const ROUTE_ROOT = "/__bb_markdown_file_root__";

export function buildMarkdownFileImageRouting({
  path,
  rootPath,
  threadId,
  linkRouting,
  resolveRelativeSrc,
}: {
  path: string;
  rootPath: string | null;
  threadId: string | null;
  linkRouting?: MarkdownLinkRouting;
  resolveRelativeSrc: (
    rootRelativePath: string,
    absolutePath: string,
  ) => string;
}): MarkdownLinkRouting | undefined {
  if (linkRouting?.localImage !== undefined) return linkRouting;
  const root = normalizeAbsoluteFilePath({ path: rootPath ?? ROUTE_ROOT });
  if (root === null) return linkRouting;
  const filePath = buildAbsoluteFilePath({
    path: rootPath === null ? path.replace(/^\/+/, "") : path,
    rootPath: root,
  });
  return {
    ...linkRouting,
    localImage: {
      absolutePaths:
        threadId === null
          ? { kind: "contained", rootPath: root }
          : { kind: "trusted-host" },
      relativePaths: {
        baseDir: getAbsoluteDirname({ path: filePath }),
        rootPath: root,
      },
      resolveSrc: (image, sourceKind) => {
        if (sourceKind === "absolute" && threadId !== null) {
          return buildThreadHostFileContentUrl(threadId, image.path);
        }
        return resolveRelativeSrc(
          image.path.slice(root === "/" ? 1 : root.length + 1),
          image.path,
        );
      },
    },
  };
}

export function buildMarkdownLeaseImageRouting({
  path,
  rootPath,
  previewUrl,
}: {
  path: string;
  rootPath: string;
  previewUrl: string | undefined;
}): MarkdownLinkRouting | undefined {
  const baseUrl = getFilePreviewLeaseBaseUrl(previewUrl ?? "");
  if (baseUrl === null) return undefined;
  return buildMarkdownFileImageRouting({
    path,
    rootPath,
    threadId: null,
    resolveRelativeSrc: (relativePath) =>
      buildFilePreviewLeaseContentUrl(baseUrl, relativePath),
  });
}
