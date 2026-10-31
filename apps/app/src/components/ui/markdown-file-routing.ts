import type { ExperimentalFileLocation } from "@get-bb/plugin-sdk";
import type { MarkdownLinkRouting } from "./markdown-link-routing";
import type { MarkdownPreviewLocalFileLinkHandler } from "./markdown-local-file-link";
import {
  getAbsoluteDirname,
  buildAbsoluteFilePath,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "@bb/shared-ui/lib/absolute-file-path";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";
import { toFileOpenLocation } from "@/lib/thread-local-file-links";

const ROUTE_ROOT = "/__bb_markdown_file_root__";

type MarkdownFileOpener = (
  rootRelativePath: string,
  absolutePath: string,
  location: ExperimentalFileLocation | null,
) => boolean;

export function buildMarkdownFileRouting({
  path,
  rootPath,
  threadId,
  resolveRelativeSrc,
  openFile,
  openOutsideRoot,
}: {
  path: string;
  rootPath: string | null;
  threadId: string | null;
  resolveRelativeSrc: (
    rootRelativePath: string,
    absolutePath: string,
  ) => string;
  openFile?: MarkdownFileOpener;
  openOutsideRoot?: MarkdownPreviewLocalFileLinkHandler;
}): MarkdownLinkRouting | undefined {
  const root = normalizeAbsoluteFilePath({ path: rootPath ?? ROUTE_ROOT });
  if (root === null) return undefined;
  const filePath = buildAbsoluteFilePath({
    path: rootPath === null ? path.replace(/^\/+/, "") : path,
    rootPath: root,
  });
  const relativePaths = {
    baseDir: getAbsoluteDirname({ path: filePath }),
    rootPath: root,
  };
  const rootRelative = (absolutePath: string) =>
    absolutePath.slice(root === "/" ? 1 : root.length + 1);
  return {
    localImage: {
      absolutePaths:
        threadId === null
          ? { kind: "contained", rootPath: root }
          : { kind: "trusted-host" },
      relativePaths,
      resolveSrc: (image, sourceKind) =>
        sourceKind === "absolute" && threadId !== null
          ? buildThreadHostFileContentUrl(threadId, image.path)
          : resolveRelativeSrc(rootRelative(image.path), image.path),
    },
    ...(openFile === undefined
      ? {}
      : {
          localFile: {
            absoluteLinks:
              openOutsideRoot === undefined
                ? { kind: "contained", rootPath: root }
                : { kind: "trusted-host" },
            relativeLinks: relativePaths,
            onOpenLink: (link) =>
              isAbsoluteFilePathWithinRoot({
                candidatePath: link.path,
                rootPath: root,
              })
                ? openFile(
                    rootRelative(link.path),
                    link.path,
                    toFileOpenLocation(link.lineRange),
                  )
                : (openOutsideRoot?.(link) ?? false),
          },
        }),
  };
}
