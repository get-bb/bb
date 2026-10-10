import { useEffect, useState } from "react";
import type { PendingAttachmentUpload } from "./usePendingAttachmentUploads";
import { useAttachmentOpener } from "@/components/secondary-panel/AttachmentOpenerContext";
import { isProjectAttachmentPath } from "@/lib/file-content-urls";
import {
  getWrappedImageIndex,
  ImageLightbox,
} from "@/components/ui/image-lightbox.js";
import { Icon } from "@bb/shared-ui/icon";
import type { PromptDraftAttachment } from "@bb/client-core";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import { SealedImage } from "@/lib/sealed";
import {
  getLocalAttachmentPreviewSrc,
  releaseLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";

function resolveAttachmentPreviewSrc(
  path: string,
  attachmentProjectId: string | undefined,
): string {
  return (
    getLocalAttachmentPreviewSrc(path) ??
    toUserAttachmentImageSrc(path, attachmentProjectId)
  );
}

const FILE_ATTACHMENT_PILL_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-recessed px-2 py-0.5 text-xs text-muted-foreground";

export function isImageAttachment(attachment: PromptDraftAttachment): boolean {
  return (
    attachment.type === "localImage" ||
    attachment.mimeType?.toLowerCase().startsWith("image/") === true
  );
}

interface AttachmentPreviewProps {
  attachments: PromptDraftAttachment[];
  pendingUploads?: readonly PendingAttachmentUpload[];
  compact?: boolean;
  attachmentProjectId?: string;
  expandedImageIndex: number | null;
  onExpandedImageIndexChange: (index: number | null) => void;
  onRemoveAttachment?: (path: string) => void;
}

function isImageUpload(upload: PendingAttachmentUpload): boolean {
  return upload.file.type.startsWith("image/");
}

function ImageUploadPreview({ file }: { file: File }) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div
      role="status"
      aria-label={`Uploading ${file.name}`}
      className="relative shrink-0 overflow-hidden rounded-md border border-border bg-surface-recessed"
    >
      <span className="block h-16 w-24">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-full object-cover opacity-50"
          />
        ) : null}
      </span>
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/90 py-1 text-xs text-foreground">
        <Icon
          name="Loading"
          className="size-3 animate-spin motion-reduce:animate-none"
        />
        Uploading
      </span>
    </div>
  );
}

function FileAttachmentName({
  name,
  path,
  projectId,
}: {
  name: string;
  path: string;
  projectId: string | undefined;
}) {
  const openAttachment = useAttachmentOpener();
  if (!openAttachment || !projectId || !isProjectAttachmentPath({ path })) {
    return <span className="truncate">{name}</span>;
  }
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => openAttachment({ name, path, projectId })}
      className="truncate hover:underline focus-visible:outline-none focus-visible:underline"
    >
      {name}
    </button>
  );
}

function FileUploadPreview({ file }: { file: File }) {
  return (
    <span
      role="status"
      aria-label={`Uploading ${file.name}`}
      className={FILE_ATTACHMENT_PILL_CLASS}
    >
      <span className="truncate">{file.name}</span>
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <Icon
          name="Loading"
          className="size-3 animate-spin motion-reduce:animate-none"
        />
      </span>
    </span>
  );
}

export function AttachmentPreview({
  attachments,
  pendingUploads = [],
  compact = false,
  attachmentProjectId,
  expandedImageIndex,
  onExpandedImageIndexChange,
  onRemoveAttachment,
}: AttachmentPreviewProps) {
  const imageAttachments = attachments.filter(isImageAttachment);
  const nonImageAttachments = attachments.filter(
    (attachment) => !isImageAttachment(attachment),
  );
  const imageUploads = pendingUploads.filter(isImageUpload);
  const fileUploads = pendingUploads.filter((upload) => !isImageUpload(upload));
  const attachmentImageItems = imageAttachments.map((attachment) => ({
    alt: attachment.name,
    src: resolveAttachmentPreviewSrc(
      attachment.path,
      attachment.sourceProjectId ?? attachmentProjectId,
    ),
  }));
  const hasMultipleAttachmentImages = imageAttachments.length > 1;
  const currentAttachmentImage =
    expandedImageIndex !== null
      ? (attachmentImageItems[expandedImageIndex] ?? null)
      : null;

  useEffect(() => {
    if (expandedImageIndex === null) return;
    if (expandedImageIndex < imageAttachments.length) return;
    onExpandedImageIndexChange(null);
  }, [expandedImageIndex, imageAttachments.length, onExpandedImageIndexChange]);

  const attachmentCount = attachments.length;
  const uploadingCount = pendingUploads.length;
  if (attachmentCount + uploadingCount === 0) {
    return null;
  }

  return (
    <>
      {compact ? (
        <span
          data-promptbox-attachments=""
          role={uploadingCount > 0 ? "status" : "img"}
          aria-label={[
            attachmentCount > 0
              ? `${attachmentCount} ${attachmentCount === 1 ? "attachment" : "attachments"}`
              : null,
            uploadingCount > 0 ? `${uploadingCount} uploading` : null,
          ]
            .filter(Boolean)
            .join(", ")}
          className="ml-3 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-surface-recessed px-1.5 text-xs text-muted-foreground"
        >
          <Icon name="Paperclip" className="size-3.5" />
          <span aria-hidden="true">{attachmentCount + uploadingCount}</span>
          {uploadingCount > 0 ? (
            <Icon
              name="Loading"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : null}
        </span>
      ) : (
        <div className="mx-3 mb-1 mt-1">
          {imageAttachments.length > 0 || imageUploads.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-2">
              {imageAttachments.map((attachment, index) => (
                <div key={`${attachment.path}-${index}`} className="relative">
                  <button
                    type="button"
                    className="block cursor-zoom-in overflow-hidden rounded-md border border-border bg-surface-recessed"
                    onClick={() => onExpandedImageIndexChange(index)}
                    title={attachment.name}
                  >
                    <SealedImage
                      src={attachmentImageItems[index]?.src}
                      alt={attachment.name}
                      className="h-16 w-24 object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                  {onRemoveAttachment ? (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.currentTarget.blur();
                        releaseLocalAttachmentPreview(attachment.path);
                        onRemoveAttachment(attachment.path);
                      }}
                      className="group/attachment-remove-image absolute right-1 top-1 z-10 inline-flex size-4 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:-right-1 max-md:pointer-coarse:-top-1 max-md:pointer-coarse:size-7"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <span className="inline-flex size-4 items-center justify-center rounded-full bg-black/55 transition-colors group-hover/attachment-remove-image:bg-black/70">
                        <Icon name="X" className="size-3" />
                      </span>
                    </button>
                  ) : null}
                </div>
              ))}
              {imageUploads.map((upload) => (
                <ImageUploadPreview key={upload.id} file={upload.file} />
              ))}
            </div>
          ) : null}

          {nonImageAttachments.length > 0 || fileUploads.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {nonImageAttachments.map((attachment) => (
                <span
                  key={attachment.path}
                  className={FILE_ATTACHMENT_PILL_CLASS}
                >
                  <FileAttachmentName
                    name={attachment.name}
                    path={attachment.path}
                    projectId={
                      attachment.sourceProjectId ?? attachmentProjectId
                    }
                  />
                  {onRemoveAttachment ? (
                    <span className="relative size-4 shrink-0">
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.currentTarget.blur();
                          onRemoveAttachment(attachment.path);
                        }}
                        className="group/attachment-remove-file absolute left-1/2 top-1/2 inline-flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:size-7"
                        aria-label={`Remove ${attachment.name}`}
                      >
                        <span className="inline-flex size-4 items-center justify-center rounded transition-colors group-hover/attachment-remove-file:bg-state-hover">
                          <Icon name="X" className="size-3" />
                        </span>
                      </button>
                    </span>
                  ) : null}
                </span>
              ))}
              {fileUploads.map((upload) => (
                <FileUploadPreview key={upload.id} file={upload.file} />
              ))}
            </div>
          ) : null}
        </div>
      )}

      <ImageLightbox
        imageSrc={currentAttachmentImage?.src ?? null}
        imageAlt={currentAttachmentImage?.alt ?? "Attached image"}
        title="Attached image preview"
        hasMultipleImages={hasMultipleAttachmentImages}
        onPrevious={() => {
          onExpandedImageIndexChange(
            expandedImageIndex === null || attachmentImageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "previous",
                  itemCount: attachmentImageItems.length,
                }),
          );
        }}
        onNext={() => {
          onExpandedImageIndexChange(
            expandedImageIndex === null || attachmentImageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "next",
                  itemCount: attachmentImageItems.length,
                }),
          );
        }}
        onClose={() => onExpandedImageIndexChange(null)}
      />
    </>
  );
}
