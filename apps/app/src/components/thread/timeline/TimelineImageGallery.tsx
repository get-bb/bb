import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TimelineRow } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  ImageLightbox,
  getWrappedImageIndex,
} from "@/components/ui/image-lightbox";
import {
  InlineImageGalleryContext,
  type InlineGalleryImage,
} from "@/components/ui/inline-image-gallery-context";
import { collectMarkdownImages } from "@/components/ui/markdown-images";
import {
  buildLocalAwareUrlTransform,
  splitMarkdownFrontmatter,
} from "@/components/ui/markdown-preview";
import { buildMarkdownMessageLinkRouting } from "@/components/ui/markdown-message-link-routing";
import { normalizeLocalFileMarkdownLinks } from "@/components/ui/markdown-local-file-link-normalize";
import { normalizeMathFences } from "@/components/ui/markdown-math-fences";

type ConversationRow = Extract<TimelineRow, { kind: "conversation" }>;

function collectConversationRows(
  rows: TimelineRow[],
  result: Map<string, ConversationRow>,
) {
  for (const row of rows) {
    if (row.kind === "conversation") result.set(row.id, row);
    else if (row.kind === "turn" && row.children)
      collectConversationRows(row.children, result);
  }
}

export function collectTimelineImages(
  rows: TimelineRow[],
  workspaceRootPath: string | undefined,
): InlineGalleryImage[] {
  const conversations = new Map<string, ConversationRow>();
  collectConversationRows(rows, conversations);
  return [...conversations.values()]
    .sort((a, b) => a.sourceSeqStart - b.sourceSeqStart)
    .flatMap((row) => {
      const routing = buildMarkdownMessageLinkRouting({
        threadId: row.threadId,
        workspaceRootPath,
      });
      const transform = buildLocalAwareUrlTransform({
        fallbackUrlTransform: undefined,
        localFileRouting: undefined,
        localImageRouting: routing?.localImage,
      });
      const content = normalizeMathFences(
        splitMarkdownFrontmatter(normalizeLocalFileMarkdownLinks(row.text))
          .body,
      );
      return collectMarkdownImages(content, transform).map(
        (image, imageIndex) => ({ ...image, rowId: row.id, imageIndex }),
      );
    });
}

function selectImage(
  images: InlineGalleryImage[],
  selected: InlineGalleryImage,
) {
  const index = images.findIndex(
    (image) =>
      image.rowId === selected.rowId &&
      image.imageIndex === selected.imageIndex,
  );
  if (index < 0) return { images: [selected], index: 0 };
  images[index] = selected;
  return { images, index };
}

interface GalleryState {
  images: InlineGalleryImage[];
  index: number;
  loading: boolean;
  failed: boolean;
}

export function TimelineImageGallery({
  children,
  timelineRows,
  threadId,
  workspaceRootPath,
  hasOlderTimelineRows = false,
}: {
  children: ReactNode;
  timelineRows: TimelineRow[];
  threadId?: string;
  workspaceRootPath: string | undefined;
  hasOlderTimelineRows?: boolean;
}) {
  const [gallery, setGallery] = useState<GalleryState | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const close = useCallback(() => {
    request.current?.abort();
    setGallery(null);
  }, []);
  const open = useCallback(
    (selected: InlineGalleryImage) => {
      request.current?.abort();
      const loading = hasOlderTimelineRows && threadId !== undefined;
      setGallery({
        ...selectImage(
          collectTimelineImages(timelineRows, workspaceRootPath),
          selected,
        ),
        loading,
        failed: false,
      });
      if (!loading || threadId === undefined) return;
      const controller = new AbortController();
      request.current = controller;
      void (async () => {
        try {
          let page = await sdk.threads.timeline({
            threadId,
            signal: controller.signal,
          });
          const rows = [...page.rows];
          while (page.timelinePage.olderCursor !== null) {
            const cursor = page.timelinePage.olderCursor;
            page = await sdk.threads.timeline({
              threadId,
              signal: controller.signal,
              beforeAnchorId: cursor.anchorId,
              beforeAnchorSeq: String(cursor.anchorSeq),
            });
            rows.push(...page.rows);
          }
          if (controller.signal.aborted) return;
          rows.push(...timelineRows);
          setGallery({
            ...selectImage(
              collectTimelineImages(rows, workspaceRootPath),
              selected,
            ),
            loading: false,
            failed: false,
          });
        } catch {
          if (controller.signal.aborted) return;
          setGallery(
            (current) =>
              current && { ...current, loading: false, failed: true },
          );
        }
      })();
    },
    [hasOlderTimelineRows, threadId, timelineRows, workspaceRootPath],
  );
  const navigate = (direction: "previous" | "next") => {
    setGallery((current) =>
      current && !current.loading
        ? {
            ...current,
            index: getWrappedImageIndex({
              currentIndex: current.index,
              direction,
              itemCount: current.images.length,
            }),
          }
        : current,
    );
  };
  const selected = gallery?.images[gallery.index];
  return (
    <InlineImageGalleryContext.Provider value={open}>
      {children}
      <ImageLightbox
        imageSrc={selected?.src ?? null}
        imageAlt={selected?.alt ?? "Image"}
        title="Timeline image preview"
        hasMultipleImages={
          gallery !== null && (gallery.loading || gallery.images.length > 1)
        }
        navigationDisabled={gallery?.loading}
        navigationStatus={
          gallery?.loading
            ? "Loading earlier images…"
            : gallery?.failed
              ? "Earlier images unavailable. Close and reopen to retry."
              : gallery && gallery.images.length > 1
                ? `${gallery.index + 1} / ${gallery.images.length}`
                : undefined
        }
        onClose={close}
        onPrevious={() => navigate("previous")}
        onNext={() => navigate("next")}
      />
    </InlineImageGalleryContext.Provider>
  );
}
