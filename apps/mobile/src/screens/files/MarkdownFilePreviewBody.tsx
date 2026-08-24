import type { ImageSource } from "expo-image";
import { useCallback, useMemo } from "react";
import { ScrollView } from "react-native";
import { SheetScrollView } from "@/ui";
import { buildThreadHostFileContentUrl } from "@/data/files/file-content-urls";
import {
  Markdown,
  parseLocalFileLineSuffix,
  type MarkdownLinkTarget,
  type MarkdownLocalFileLink,
} from "@/markdown";
import type { FileOpenRequest } from "./file-opener";
import type { FilePreviewTarget } from "./file-preview-target";
import {
  buildFileTargetExternalUrl,
  resolveSiblingFileTarget,
  type FileTargetUrlContext,
} from "./file-preview-urls";

interface MarkdownFilePreviewBodyProps {
  content: string;
  target: FilePreviewTarget;
  urlContext: FileTargetUrlContext;
  /** Absolute `/path[:line]` links (workspace / storage / host routing). */
  onOpenLocalFileLink: (link: MarkdownLocalFileLink) => void;
  /** Open another file from this preview (relative links). */
  onOpenFile: (request: FileOpenRequest) => void;
  /** Rendered inside a bottom sheet: use the sheet-aware scroller. */
  inSheet?: boolean;
  testID?: string;
}

const ABSOLUTE_URL_PATTERN = /^(?:https?:|data:)/iu;

/**
 * Rendered markdown (`@/markdown`): relative links and images resolve beside
 * the previewed file within the same source; absolute local file links go
 * through the thread's local-file router.
 */
export function MarkdownFilePreviewBody({
  content,
  target,
  urlContext,
  onOpenLocalFileLink,
  onOpenFile,
  inSheet = false,
  testID,
}: MarkdownFilePreviewBodyProps) {
  const serverHostname = useMemo(() => {
    try {
      return new URL(urlContext.serverUrl).hostname;
    } catch {
      return undefined;
    }
  }, [urlContext.serverUrl]);
  const resolveImageSource = useCallback(
    (src: string): ImageSource | null => {
      if (ABSOLUTE_URL_PATTERN.test(src)) return { uri: src };
      const path = src.replace(/^file:\/\//iu, "");
      if (path.startsWith("/")) {
        return urlContext.threadId === null
          ? null
          : {
              uri: buildThreadHostFileContentUrl(
                urlContext.serverUrl,
                urlContext.threadId,
                path,
              ),
            };
      }
      const sibling = resolveSiblingFileTarget(target, path);
      const url =
        sibling === null
          ? null
          : buildFileTargetExternalUrl(urlContext, sibling);
      return url === null ? null : { uri: url };
    },
    [target, urlContext],
  );
  const onLinkPress = useCallback(
    (link: MarkdownLinkTarget): boolean => {
      if (link.kind !== "relative") return false;
      const parsed = parseLocalFileLineSuffix(link.href);
      const rawPath = (parsed?.path ?? link.href).trim();
      if (rawPath.length === 0 || rawPath.startsWith("#")) return false;
      const sibling = resolveSiblingFileTarget(target, rawPath);
      if (sibling === null) return false;
      onOpenFile({ target: sibling, lineRange: parsed?.lineRange ?? null });
      return true;
    },
    [onOpenFile, target],
  );
  const Scroller = inSheet ? SheetScrollView : ScrollView;
  return (
    <Scroller
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      testID={testID}
    >
      <Markdown
        content={content}
        textSize="base"
        serverHostname={serverHostname}
        showFrontmatter
        onFilePress={onOpenLocalFileLink}
        onLinkPress={onLinkPress}
        resolveImageSource={resolveImageSource}
        testID="file-preview-markdown"
      />
    </Scroller>
  );
}
