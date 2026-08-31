import { useEffect, useState } from "react";
import type { TimelineConversationAttachments } from "@bb/server-contract";
import { fileNameFromPath } from "@bb/thread-view";
import {
  ImageLightbox,
  getWrappedImageIndex,
} from "../../ui/image-lightbox.js";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import type { ExperimentalFileIdentity } from "@get-bb/plugin-sdk";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { resolveFileInteraction } from "@/lib/file-resolver";
import type {
  ThreadTimelineLocalFileLinkHandler,
  UserAttachmentImageSrcResolver,
} from "./types.js";

interface ConversationImageItem {
  alt: string;
  downloadUrl: string | null;
  src: string;
}

interface ConversationFileItem {
  downloadUrl: string | null;
  identity: ExperimentalFileIdentity | null;
  path: string;
}

export interface ConversationAttachmentItems {
  fileItems: ConversationFileItem[];
  imageItems: ConversationImageItem[];
}

interface ConversationAttachmentsProps extends ConversationAttachmentItems {
  align?: "start" | "end";
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
}

interface BuildAttachmentItemsArgs {
  attachments: TimelineConversationAttachments | null;
  projectId?: string;
  resolveUserAttachmentImageSrc?: UserAttachmentImageSrcResolver;
  threadId?: string;
}

interface FileIdentityArgs {
  path: string;
  projectId: string | undefined;
  threadId: string | undefined;
}

interface PathClassificationArgs {
  path: string;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

function isAbsoluteLocalPath({ path }: PathClassificationArgs): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

function isProjectAttachmentPath({ path }: PathClassificationArgs): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("\\") &&
    !isAbsoluteLocalPath({ path }) &&
    !URL_SCHEME_PATTERN.test(path)
  );
}

function fileIdentity({
  path,
  projectId,
  threadId,
}: FileIdentityArgs): ExperimentalFileIdentity | null {
  const displayName = fileNameFromPath(path);
  if (projectId && isProjectAttachmentPath({ path })) {
    return {
      source: { store: "project-attachment", ownerId: projectId, path },
      displayName,
      mimeType: null,
      sizeBytes: null,
      location: null,
    };
  }
  if (threadId && isAbsoluteLocalPath({ path })) {
    return {
      source: { store: "thread-host", ownerId: threadId, path },
      displayName,
      mimeType: null,
      sizeBytes: null,
      location: null,
    };
  }
  if (/^https?:/iu.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      return null;
    }
    return {
      source: { store: "remote", ownerId: url.origin, url: path },
      displayName,
      mimeType: null,
      sizeBytes: null,
      location: null,
    };
  }
  return null;
}

export function buildAttachmentItems({
  attachments,
  projectId,
  resolveUserAttachmentImageSrc,
  threadId,
}: BuildAttachmentItemsArgs): ConversationAttachmentItems {
  if (!attachments) {
    return {
      fileItems: [],
      imageItems: [],
    };
  }

  const imageItems: ConversationImageItem[] = [
    ...attachments.imageUrls.map((url) => ({
      alt: fileNameFromPath(url),
      downloadUrl: null,
      src: url,
    })),
    ...attachments.localImagePaths.map((path) => {
      const identity = fileIdentity({ path, projectId, threadId });
      const interaction =
        identity === null ? null : resolveFileInteraction(identity);
      return {
        alt: fileNameFromPath(path),
        downloadUrl: interaction?.downloadUrl ?? null,
        src:
          interaction?.previewUrl ??
          (resolveUserAttachmentImageSrc
            ? resolveUserAttachmentImageSrc(path, projectId)
            : path),
      };
    }),
  ];

  return {
    fileItems: attachments.localFilePaths.map((path) => {
      const identity = fileIdentity({ path, projectId, threadId });
      return {
        downloadUrl:
          identity === null
            ? null
            : resolveFileInteraction(identity).downloadUrl,
        identity,
        path,
      };
    }),
    imageItems,
  };
}

export function ConversationAttachments({
  align = "start",
  fileItems,
  imageItems,
  onOpenLocalFileLink,
}: ConversationAttachmentsProps) {
  const navigation = useAppNavigationHost();
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  const currentImageItem =
    expandedImageIndex === null
      ? null
      : (imageItems[expandedImageIndex] ?? null);
  const hasMultipleImages = imageItems.length > 1;
  const justifyClassName = align === "end" ? "justify-end" : "justify-start";

  useEffect(() => {
    if (expandedImageIndex === null || expandedImageIndex < imageItems.length) {
      return;
    }
    setExpandedImageIndex(null);
  }, [expandedImageIndex, imageItems.length]);

  if (fileItems.length === 0 && imageItems.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {imageItems.length > 0 ? (
        <div className={cn("flex flex-wrap gap-2", justifyClassName)}>
          {imageItems.map((imageItem, index) => (
            <div
              key={`${imageItem.src}-${index}`}
              className={cn(
                "relative overflow-hidden rounded-md border",
                align === "end"
                  ? "border-surface-selected-border bg-surface-raised"
                  : "border-border bg-surface-recessed",
              )}
            >
              <button
                type="button"
                className="block cursor-zoom-in"
                onClick={() => setExpandedImageIndex(index)}
                title={imageItem.alt}
              >
                <img
                  src={imageItem.src}
                  alt={imageItem.alt}
                  className={cn(
                    "object-cover",
                    align === "end" ? "h-20 max-w-36" : "h-16 w-24",
                  )}
                  loading="lazy"
                  decoding="async"
                />
              </button>
              {imageItem.downloadUrl === null ? null : (
                <a
                  href={imageItem.downloadUrl}
                  download={imageItem.alt}
                  aria-label={`Download ${imageItem.alt}`}
                  className="absolute bottom-1 right-1 rounded bg-black/55 p-1 text-white hover:bg-black/70"
                >
                  <Icon name="Download" className="size-3" aria-hidden />
                </a>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {fileItems.length > 0 ? (
        <div className={cn("flex flex-wrap gap-1.5", justifyClassName)}>
          {fileItems.map((fileItem) => {
            const { path } = fileItem;
            const identity = fileItem.identity;
            const className = cn(
              "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground",
              align === "end"
                ? "border-surface-selected-border bg-surface-raised"
                : "border-border bg-surface-recessed",
            );
            const label = (
              <span className="truncate">{fileNameFromPath(path)}</span>
            );
            if (identity !== null) {
              return (
                <span key={path} className={cn(className, "gap-1")}>
                  <button
                    type="button"
                    className="min-w-0 cursor-pointer hover:text-foreground"
                    onClick={() => navigation.openFilePreview({ identity })}
                    aria-label={`Open ${fileNameFromPath(path)}`}
                  >
                    {label}
                  </button>
                  {fileItem.downloadUrl === null ? null : (
                    <a
                      href={fileItem.downloadUrl}
                      download={fileNameFromPath(path)}
                      aria-label={`Download ${fileNameFromPath(path)}`}
                      className="shrink-0 rounded p-0.5 hover:bg-state-hover hover:text-foreground"
                    >
                      <Icon name="Download" className="size-3" aria-hidden />
                    </a>
                  )}
                </span>
              );
            }

            if (!onOpenLocalFileLink || !isAbsoluteLocalPath({ path })) {
              return (
                <span key={path} className={cn(className, "cursor-default")}>
                  {label}
                </span>
              );
            }

            return (
              <button
                key={path}
                type="button"
                className={cn(className, "cursor-pointer hover:bg-state-hover")}
                onClick={() => {
                  onOpenLocalFileLink({ lineRange: null, path });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      <ImageLightbox
        title="Attached image preview"
        imageSrc={currentImageItem?.src ?? null}
        imageAlt={currentImageItem?.alt ?? "Attached image"}
        downloadUrl={currentImageItem?.downloadUrl ?? null}
        downloadName={currentImageItem?.alt}
        hasMultipleImages={hasMultipleImages}
        onPrevious={() => {
          setExpandedImageIndex(
            expandedImageIndex === null || imageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "previous",
                  itemCount: imageItems.length,
                }),
          );
        }}
        onNext={() => {
          setExpandedImageIndex(
            expandedImageIndex === null || imageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "next",
                  itemCount: imageItems.length,
                }),
          );
        }}
        onClose={() => setExpandedImageIndex(null)}
      />
    </div>
  );
}
