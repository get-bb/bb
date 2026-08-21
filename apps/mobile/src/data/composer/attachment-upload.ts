import type { PromptDraftAttachment } from "@bb/client-core";
import { uploadedPromptAttachmentSchema } from "@bb/server-contract";
import type { MultipartRequest } from "./multipart-upload";

/**
 * `POST /projects/:id/attachments` from a locally picked file. The server
 * accepts exactly one multipart field, `file`, and enforces the size limits
 * below (apps/server/src/services/projects/attachments.ts); the client checks
 * them first so an oversized pick fails before the bytes leave the phone.
 */

const ATTACHMENT_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_FILE_LIMIT_BYTES = 25 * 1024 * 1024;

export interface PickedAttachmentFile {
  /** Local `file://` (or `ph://`, `content://`) URI from a picker. */
  uri: string;
  name: string;
  /** Empty when the picker reported none; the server then treats it as a file. */
  mimeType: string;
  /** Unknown size reads as 0 and is not checked client-side. */
  sizeBytes: number;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

function attachmentSizeLimitBytes(mimeType: string): number {
  return isImageMimeType(mimeType)
    ? ATTACHMENT_IMAGE_LIMIT_BYTES
    : ATTACHMENT_FILE_LIMIT_BYTES;
}

function formatMebibytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

/** Same wording shape as the server's 400 (`Attachment exceeds 10MB limit`). */
export function validateAttachmentSize(
  file: Pick<PickedAttachmentFile, "mimeType" | "sizeBytes" | "name">,
): string | null {
  const limit = attachmentSizeLimitBytes(file.mimeType);
  if (file.sizeBytes > limit) {
    return `${file.name} is larger than the ${formatMebibytes(limit)} ${
      isImageMimeType(file.mimeType) ? "image" : "file"
    } limit`;
  }
  return null;
}

function buildAttachmentUploadUrl(
  serverUrl: string,
  projectId: string,
): string {
  return `${serverUrl.replace(/\/+$/u, "")}/api/v1/projects/${encodeURIComponent(projectId)}/attachments`;
}

export function buildAttachmentUploadRequest(args: {
  serverUrl: string;
  projectId: string;
  file: PickedAttachmentFile;
}): MultipartRequest {
  return {
    url: buildAttachmentUploadUrl(args.serverUrl, args.projectId),
    fields: [
      [
        "file",
        {
          uri: args.file.uri,
          name: args.file.name,
          type: args.file.mimeType || "application/octet-stream",
        },
      ],
    ],
  };
}

/** Validate the upload response at the boundary. */
export function parseUploadedAttachment(body: unknown): PromptDraftAttachment {
  return uploadedPromptAttachmentSchema.parse(body);
}

/**
 * A stable file name for picker results that come without one (camera
 * captures, some photo-library assets): `<prefix>-<timestamp>.<ext>`.
 */
export function fallbackAttachmentName(
  uri: string,
  mimeType: string,
  now: number = Date.now(),
): string {
  const fromUri = uri.split(/[?#]/u)[0]?.split("/").pop() ?? "";
  if (fromUri.length > 0 && fromUri.includes(".")) return fromUri;
  const extension = mimeType.split("/")[1]?.split("+")[0] ?? "bin";
  const prefix = isImageMimeType(mimeType) ? "photo" : "file";
  return `${prefix}-${now}.${extension}`;
}
