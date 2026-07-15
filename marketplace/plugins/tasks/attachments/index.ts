import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import type { Attachment, TasksStore } from "../db";

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

const UPLOAD_PATH = "/attachments/upload";
const DOWNLOAD_PATH = "/attachments/download";
const DELETE_PATH = "/attachments/delete";
const MIME_PATTERN =
  /^(application|audio|font|image|message|model|multipart|text|video)\/[!#$&^_.+\-A-Za-z0-9]+$/;
const storeRoots = new WeakMap<TasksStore, string>();

export type AttachmentOwner =
  | { taskId: string; commentId?: never }
  | { taskId?: never; commentId: string };

export type SaveAttachmentFromPathOptions = AttachmentOwner & {
  fileName?: string;
  mime: string;
};

interface DatabaseListRow {
  name: string;
  file: string;
}

type PluginHttpContext = Parameters<
  Parameters<BbPluginApi["http"]["route"]>[2]
>[0];

class AttachmentRequestError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

function pluginDataDirectory(bb: BbPluginApi): string {
  const main = bb.storage
    .database()
    .prepare<[], DatabaseListRow>("PRAGMA database_list")
    .all()
    .find((database) => database.name === "main");
  if (!main?.file) {
    throw new Error("Tasks attachment storage requires a file-backed database");
  }
  return dirname(main.file);
}

function requireStoreRoot(store: TasksStore): string {
  const root = storeRoots.get(store);
  if (!root) {
    throw new Error(
      "Tasks attachment helpers require registerAttachments(bb, store) first",
    );
  }
  return root;
}

function pathInside(root: string, blobPath: string): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, blobPath);
  if (
    absolutePath !== absoluteRoot &&
    !absolutePath.startsWith(`${absoluteRoot}${sep}`)
  ) {
    throw new Error("Attachment blob path escapes the plugin data directory");
  }
  return absolutePath;
}

export async function removeAttachmentBlobs(
  bb: BbPluginApi,
  store: TasksStore,
  attachments: readonly Pick<Attachment, "id" | "blobPath">[],
): Promise<void> {
  if (attachments.length === 0) return;
  let root: string;
  try {
    root = requireStoreRoot(store);
  } catch (error) {
    bb.log.warn(
      `failed to resolve attachment blob storage: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        const absolutePath = pathInside(root, attachment.blobPath);
        await rm(dirname(absolutePath), { recursive: true, force: true });
      } catch (error) {
        bb.log.warn(
          `failed to remove attachment blob ${attachment.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}

function publishAttachmentChanged(
  bb: BbPluginApi,
  store: TasksStore,
  attachment: Attachment,
): void {
  const taskId =
    attachment.taskId ??
    (attachment.commentId
      ? store.getComment(attachment.commentId)?.taskId
      : undefined);
  const task = taskId ? store.getTask(taskId) : undefined;
  if (!task) {
    bb.log.warn(`failed to publish attachment change ${attachment.id}`);
    return;
  }
  bb.realtime.publish("tasks:changed", {
    taskId: task.id,
    projectId: task.projectId,
  });
}

function sanitizeFileName(fileName: string): string {
  const baseName = fileName
    .normalize("NFC")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.trim();
  let sanitized = (baseName ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  while (Buffer.byteLength(sanitized, "utf8") > 180) {
    sanitized = sanitized.slice(0, -1);
  }
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "attachment";
  }
  return sanitized;
}

function normalizeMime(mime: string): string {
  const normalized = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!MIME_PATTERN.test(normalized)) {
    throw new AttachmentRequestError(400, "mime must be a valid MIME type");
  }
  return normalized;
}

function normalizeOwner(
  taskId: string | null | undefined,
  commentId: string | null | undefined,
): AttachmentOwner {
  const normalizedTaskId = taskId?.trim() || undefined;
  const normalizedCommentId = commentId?.trim() || undefined;
  if (Boolean(normalizedTaskId) === Boolean(normalizedCommentId)) {
    throw new AttachmentRequestError(
      400,
      "exactly one of taskId or commentId is required",
    );
  }
  if (normalizedTaskId) return { taskId: normalizedTaskId };
  if (normalizedCommentId) return { commentId: normalizedCommentId };
  throw new Error("unreachable attachment owner state");
}

function attachmentParameters(context: PluginHttpContext): {
  owner: AttachmentOwner;
  fileName: string;
  mime: string;
} {
  const query = context.req.query();
  const owner = normalizeOwner(
    query.taskId ?? context.req.header("x-task-id"),
    query.commentId ?? context.req.header("x-comment-id"),
  );
  const requestedFileName =
    query.fileName ?? context.req.header("x-file-name") ?? "";
  if (!requestedFileName.trim()) {
    throw new AttachmentRequestError(400, "fileName is required");
  }
  const requestedMime =
    query.mime ??
    context.req.header("x-mime-type") ??
    context.req.header("content-type") ??
    "";
  return {
    owner,
    fileName: sanitizeFileName(requestedFileName),
    mime: normalizeMime(requestedMime),
  };
}

async function readRequestBody(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ATTACHMENT_SIZE_BYTES
  ) {
    throw new AttachmentRequestError(413, "attachment exceeds the 25 MB limit");
  }
  if (!request.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ATTACHMENT_SIZE_BYTES) {
        await reader.cancel();
        throw new AttachmentRequestError(
          413,
          "attachment exceeds the 25 MB limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function persistAttachment(
  store: TasksStore,
  owner: AttachmentOwner,
  fileName: string,
  mime: string,
  sizeBytes: number,
  writeBlob: (path: string) => Promise<void>,
): Promise<Attachment> {
  if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new AttachmentRequestError(413, "attachment exceeds the 25 MB limit");
  }
  const safeFileName = sanitizeFileName(fileName);
  const safeMime = normalizeMime(mime);
  const attachment = store.createAttachment({
    ...owner,
    fileName: safeFileName,
    mime: safeMime,
    sizeBytes,
    blobPath: join("blobs", "pending", safeFileName),
    isImage: safeMime.startsWith("image/"),
  });
  const blobPath = join("blobs", attachment.id, safeFileName);
  const absolutePath = pathInside(requireStoreRoot(store), blobPath);

  try {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeBlob(absolutePath);
    return store.updateAttachment(attachment.id, {
      blobPath,
    });
  } catch (error) {
    store.deleteAttachment(attachment.id);
    await rm(dirname(absolutePath), { recursive: true, force: true });
    throw error;
  }
}

export function buildAttachmentUrl(attachmentId: string): string {
  return `/api/v1/plugins/tasks/http${DOWNLOAD_PATH}?attachmentId=${encodeURIComponent(attachmentId)}`;
}

export async function saveAttachmentFromPath(
  store: TasksStore,
  sourcePath: string,
  options: SaveAttachmentFromPathOptions,
): Promise<Attachment> {
  const source = await stat(sourcePath);
  if (!source.isFile()) {
    throw new Error(`Attachment source is not a file: ${sourcePath}`);
  }
  return persistAttachment(
    store,
    normalizeOwner(options.taskId, options.commentId),
    options.fileName ?? sourcePath.split(/[\\/]/).at(-1) ?? "attachment",
    options.mime,
    source.size,
    (destinationPath) => copyFile(sourcePath, destinationPath),
  );
}

export async function readAttachmentToPath(
  store: TasksStore,
  attachmentId: string,
  destinationPath: string,
): Promise<Attachment> {
  const attachment = store.getAttachment(attachmentId);
  if (!attachment) throw new Error(`Attachment not found: ${attachmentId}`);
  const sourcePath = pathInside(requireStoreRoot(store), attachment.blobPath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  return attachment;
}

function errorResponse(context: PluginHttpContext, error: unknown): Response {
  if (error instanceof AttachmentRequestError) {
    return context.json({ error: error.message }, error.status);
  }
  throw error;
}

/**
 * Registers exact-match attachment routes. Upload accepts a raw request body
 * and therefore uses token auth; metadata may be supplied through query
 * parameters or x-task-id/x-comment-id/x-file-name/x-mime-type headers.
 */
export function registerAttachments(bb: BbPluginApi, store: TasksStore): void {
  const root = pluginDataDirectory(bb);
  storeRoots.set(store, root);

  bb.http.route(
    "POST",
    UPLOAD_PATH,
    async (context) => {
      try {
        const parameters = attachmentParameters(context);
        const body = await readRequestBody(context.req.raw);
        const attachment = await persistAttachment(
          store,
          parameters.owner,
          parameters.fileName,
          parameters.mime,
          body.byteLength,
          (destinationPath) => writeFile(destinationPath, body),
        );
        publishAttachmentChanged(bb, store, attachment);
        return context.json(
          {
            attachmentId: attachment.id,
            url: buildAttachmentUrl(attachment.id),
          },
          201,
        );
      } catch (error) {
        return errorResponse(context, error);
      }
    },
    { auth: "token" },
  );

  bb.http.route("GET", DOWNLOAD_PATH, async (context) => {
    const attachmentId = context.req.query("attachmentId")?.trim();
    const attachment = attachmentId
      ? store.getAttachment(attachmentId)
      : undefined;
    if (!attachment)
      return context.json({ error: "attachment not found" }, 404);

    const absolutePath = pathInside(root, attachment.blobPath);
    try {
      await stat(absolutePath);
    } catch {
      return context.json({ error: "attachment not found" }, 404);
    }
    const disposition = attachment.isImage ? "inline" : "attachment";
    const encodedName = encodeURIComponent(attachment.fileName).replaceAll(
      "'",
      "%27",
    );
    return new Response(new Uint8Array(await readFile(absolutePath)), {
      headers: {
        "Content-Type": attachment.mime,
        "Content-Length": String(attachment.sizeBytes),
        "Content-Disposition": `${disposition}; filename="${attachment.fileName}"; filename*=UTF-8''${encodedName}`,
      },
    });
  });

  bb.http.route("DELETE", DELETE_PATH, async (context) => {
    const attachmentId = context.req.query("attachmentId")?.trim();
    const attachment = attachmentId
      ? store.getAttachment(attachmentId)
      : undefined;
    if (!attachment)
      return context.json({ error: "attachment not found" }, 404);

    store.deleteAttachment(attachment.id);
    await removeAttachmentBlobs(bb, store, [attachment]);
    publishAttachmentChanged(bb, store, attachment);
    return context.json({ deleted: true });
  });
}
