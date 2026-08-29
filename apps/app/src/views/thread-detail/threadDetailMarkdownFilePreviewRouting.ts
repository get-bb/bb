import type { EnvironmentFilePreviewSource } from "@bb/client-core";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import type { MarkdownPreviewLocalFileLinkHandler } from "@/components/ui/markdown-local-file-link";
import {
  buildMarkdownFilePreviewRouting,
  resolveMarkdownFilePreviewRootPath,
} from "@/components/secondary-panel/markdown-file-preview-routing";
import { getAbsoluteDirname } from "@/lib/absolute-file-path";

type ThreadDetailMarkdownFilePreviewSource =
  | {
      absolutePath: string | undefined;
      environmentId: string | null;
      fileSource: EnvironmentFilePreviewSource;
      kind: "workspace";
      projectId: string | null;
      rootPath: string | null;
      threadId: string;
    }
  | {
      filePath: string;
      kind: "host";
      rootPaths: readonly (string | null | undefined)[];
      threadId: string;
    }
  | {
      absolutePath: string | undefined;
      kind: "thread-storage";
      rootPath: string | null;
      threadId: string;
    };

interface BuildThreadDetailMarkdownFilePreviewRoutingArgs {
  onOpenLink: MarkdownPreviewLinkHandler;
  onOpenLocalFileLink: MarkdownPreviewLocalFileLinkHandler;
  source: ThreadDetailMarkdownFilePreviewSource;
}

export function buildThreadDetailMarkdownFilePreviewRouting({
  onOpenLink,
  onOpenLocalFileLink,
  source,
}: BuildThreadDetailMarkdownFilePreviewRoutingArgs) {
  if (source.kind === "host") {
    return buildMarkdownFilePreviewRouting({
      baseDir: getAbsoluteDirname({ path: source.filePath }),
      contentSource: { kind: "host", threadId: source.threadId },
      onOpenLink,
      onOpenLocalFileLink,
      rootPath: resolveMarkdownFilePreviewRootPath({
        filePath: source.filePath,
        rootPaths: source.rootPaths,
      }),
    });
  }

  const baseDir =
    source.absolutePath === undefined
      ? undefined
      : getAbsoluteDirname({ path: source.absolutePath });
  return buildMarkdownFilePreviewRouting({
    baseDir,
    contentSource:
      source.kind === "workspace"
        ? {
            environmentId: source.environmentId,
            fileSource: source.fileSource,
            kind: "workspace",
            projectId: source.projectId,
            threadId: source.threadId,
          }
        : { kind: "thread-storage", threadId: source.threadId },
    onOpenLink,
    onOpenLocalFileLink,
    rootPath: source.rootPath,
  });
}
