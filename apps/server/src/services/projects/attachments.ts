// oxlint-disable-next-line no-restricted-imports
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve,
  win32,
} from "node:path";
import { resolveContainedPath } from "@bb/process-utils";
import type { PromptInput } from "@bb/domain";
import type { HostDaemonOnlineRpcResultByType } from "@bb/host-daemon-contract";
import type { UploadedPromptAttachment } from "@bb/server-contract";
import mimeTypes from "mime-types";
import { ApiError } from "../../errors.js";

const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const FILE_LIMIT_BYTES = 25 * 1024 * 1024;

const HEIF_IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

type PromptAttachmentInput = Extract<
  PromptInput,
  { type: "localFile" | "localImage" }
>;

interface ValidatePromptAttachmentReferencesArgs {
  dataDir: string;
  input: PromptInput[];
  projectId: string;
}

interface PreparePromptAttachmentInputGroupsArgs extends Omit<
  ValidatePromptAttachmentReferencesArgs,
  "input"
> {
  inputGroups: readonly PromptInput[][];
  readHostFile: (
    path: string,
  ) => Promise<HostDaemonOnlineRpcResultByType["host.read_file"]>;
}

type StoredPromptAttachmentType = "localFile" | "localImage";

interface StoreAttachmentBytesArgs {
  bytes: Uint8Array;
  dataDir: string;
  mimeType?: string;
  originalName: string;
  projectId: string;
  type: StoredPromptAttachmentType;
}

function sanitizeFilename(name: string): string {
  const base = basename(name.replaceAll("\\", "/")).replace(
    /[^a-zA-Z0-9._-]+/gu,
    "-",
  );
  return base.length > 0 ? base : "attachment";
}

function buildStoredFilename(
  originalName: string,
  mimeType: string | undefined,
  type: StoredPromptAttachmentType,
): string {
  const sanitized = sanitizeFilename(originalName);
  const originalExtension = extname(sanitized);
  const normalizedMimeType = mimeType?.split(";")[0]?.trim().toLowerCase();
  const originalExtensionMimeType = mimeTypes.lookup(sanitized);
  const inferredExtension = normalizedMimeType
    ? mimeTypes.extension(normalizedMimeType)
    : false;
  const useInferredImageExtension =
    type === "localImage" &&
    inferredExtension !== false &&
    originalExtensionMimeType !== normalizedMimeType;
  const extension =
    useInferredImageExtension || originalExtension.length === 0
      ? inferredExtension
        ? `.${inferredExtension}`
        : originalExtension
      : originalExtension;
  const stem =
    originalExtension.length > 0
      ? sanitized.slice(0, -originalExtension.length)
      : sanitized;
  return `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
}

function projectAttachmentDir(dataDir: string, projectId: string): string {
  return join(dataDir, "attachments", projectId);
}

function resolveAttachmentPath(
  attachmentDir: string,
  relativePath: string,
): string {
  const normalizedRelativePath = normalize(relativePath.replaceAll("\\", "/"));
  const resolvedAttachmentDir = resolve(attachmentDir);
  const resolvedCandidatePath = resolve(
    resolvedAttachmentDir,
    normalizedRelativePath,
  );

  if (resolvedCandidatePath === resolvedAttachmentDir) {
    throw new ApiError(
      400,
      "invalid_request",
      "Attachment path must refer to a file inside the project directory",
    );
  }

  const resolvedPath = resolveContainedPath({
    rootPath: resolvedAttachmentDir,
    candidatePath: resolvedCandidatePath,
  });

  if (resolvedPath) {
    return resolvedPath;
  }

  throw new ApiError(
    400,
    "invalid_request",
    "Attachment path escapes project directory",
  );
}

function pathLooksRuntimeReadable(rawPath: string): boolean {
  return (
    isAbsolute(rawPath) ||
    win32.isAbsolute(rawPath) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath)
  );
}

function shouldValidateProjectAttachmentReference(
  input: PromptInput,
): input is PromptAttachmentInput {
  if (input.type !== "localFile" && input.type !== "localImage") {
    return false;
  }
  return !pathLooksRuntimeReadable(input.path);
}

function missingAttachmentReferenceError(attachmentPath: string): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    `Attachment ${attachmentPath} was not uploaded for this project. Upload files with POST /api/v1/projects/:id/attachments and use the returned path in localFile/localImage prompt input; relative workspace file paths are not valid attachment references.`,
  );
}

async function ensureAttachmentReferenceExists(
  dataDir: string,
  projectId: string,
  attachmentPath: string,
): Promise<void> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, attachmentPath);
  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw missingAttachmentReferenceError(attachmentPath);
  }
}

export async function validatePromptAttachmentReferences(
  args: ValidatePromptAttachmentReferencesArgs,
): Promise<void> {
  for (const input of args.input) {
    if (!shouldValidateProjectAttachmentReference(input)) {
      continue;
    }
    await ensureAttachmentReferenceExists(
      args.dataDir,
      args.projectId,
      input.path,
    );
  }
}

function isHeifImageMimeType(rawMimeType: string | undefined): boolean {
  const mimeType = (rawMimeType?.split(";")[0] ?? "").trim().toLowerCase();
  return HEIF_IMAGE_MIME_TYPES.has(mimeType);
}

function attachmentSizeLimitBytes(type: StoredPromptAttachmentType): number {
  return type === "localImage" ? IMAGE_LIMIT_BYTES : FILE_LIMIT_BYTES;
}

function validateAttachmentMetadata(args: {
  mimeType: string | undefined;
  sizeBytes: number;
  type: StoredPromptAttachmentType;
}): void {
  if (args.type === "localImage" && isHeifImageMimeType(args.mimeType)) {
    throw new ApiError(
      400,
      "invalid_request",
      "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.",
    );
  }
  const sizeLimit = attachmentSizeLimitBytes(args.type);
  if (args.sizeBytes > sizeLimit) {
    throw new ApiError(
      400,
      "invalid_request",
      `Attachment exceeds ${Math.floor(sizeLimit / (1024 * 1024))}MB limit`,
    );
  }
}

async function storeAttachmentBytes(
  args: StoreAttachmentBytesArgs,
): Promise<UploadedPromptAttachment> {
  validateAttachmentMetadata({
    mimeType: args.mimeType,
    sizeBytes: args.bytes.byteLength,
    type: args.type,
  });

  const dir = projectAttachmentDir(args.dataDir, args.projectId);
  await mkdir(dir, { recursive: true });

  const storedName = buildStoredFilename(
    args.originalName,
    args.mimeType,
    args.type,
  );
  await writeFile(join(dir, storedName), args.bytes);

  return {
    type: args.type,
    path: storedName,
    name: args.originalName,
    ...(args.mimeType ? { mimeType: args.mimeType } : {}),
    sizeBytes: args.bytes.byteLength,
  };
}

export async function storeAttachment(
  dataDir: string,
  projectId: string,
  file: File,
): Promise<UploadedPromptAttachment> {
  const isImage = (file.type || "").startsWith("image/");
  const type = isImage ? "localImage" : "localFile";
  validateAttachmentMetadata({
    mimeType: file.type || undefined,
    sizeBytes: file.size,
    type,
  });
  return storeAttachmentBytes({
    bytes: new Uint8Array(await file.arrayBuffer()),
    dataDir,
    mimeType: file.type || undefined,
    originalName: file.name,
    projectId,
    type,
  });
}

function hostPathFromImageReference(pathOrUrl: string): string | null {
  if (isAbsolute(pathOrUrl) || win32.isAbsolute(pathOrUrl)) {
    return pathOrUrl;
  }
  if (!pathOrUrl.toLowerCase().startsWith("file:")) {
    return null;
  }

  try {
    const url = new URL(pathOrUrl);
    if (url.protocol !== "file:") {
      return null;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//u.test(pathname)) {
      return pathname.slice(1);
    }
    return url.hostname ? `//${url.hostname}${pathname}` : pathname;
  } catch {
    return null;
  }
}

function originalNameFromHostPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "image";
}

function decodeHostFileBytes(
  result: HostDaemonOnlineRpcResultByType["host.read_file"],
): Uint8Array {
  const bytes = Buffer.from(result.content, result.contentEncoding);
  if (bytes.byteLength !== result.sizeBytes) {
    throw new ApiError(
      502,
      "attachment_size_mismatch",
      `Host image size mismatch: expected ${result.sizeBytes} bytes, received ${bytes.byteLength}`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== result.sha256) {
    throw new ApiError(
      502,
      "attachment_checksum_mismatch",
      "Host image checksum did not match the bytes received",
    );
  }
  return bytes;
}

function inferPngMimeType(bytes: Uint8Array): "image/png" | undefined {
  return bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
    ? "image/png"
    : undefined;
}

export async function preparePromptAttachmentInputGroups(
  args: PreparePromptAttachmentInputGroupsArgs,
): Promise<PromptInput[][]> {
  for (const input of args.inputGroups) {
    await validatePromptAttachmentReferences({
      dataDir: args.dataDir,
      input,
      projectId: args.projectId,
    });
  }

  const storedPathByHostPath = new Map<string, Promise<string | null>>();
  const prepareInput = async (input: PromptInput): Promise<PromptInput> => {
    if (input.type !== "localImage") {
      return input;
    }
    const hostPath = hostPathFromImageReference(input.path);
    if (!hostPath) {
      return input;
    }
    let storedPath = storedPathByHostPath.get(hostPath);
    if (!storedPath) {
      storedPath = (async () => {
        let hostFile: HostDaemonOnlineRpcResultByType["host.read_file"];
        try {
          hostFile = await args.readHostFile(hostPath);
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.body.code === "file_too_large"
          ) {
            return null;
          }
          throw error;
        }
        const declaredMimeType =
          hostFile.mimeType || mimeTypes.lookup(hostPath) || undefined;
        if (
          isHeifImageMimeType(declaredMimeType) ||
          hostFile.sizeBytes > IMAGE_LIMIT_BYTES
        ) {
          return null;
        }
        const bytes = decodeHostFileBytes(hostFile);
        const mimeType = declaredMimeType ?? inferPngMimeType(bytes);
        const attachment = await storeAttachmentBytes({
          bytes,
          dataDir: args.dataDir,
          ...(mimeType ? { mimeType } : {}),
          originalName: originalNameFromHostPath(hostPath),
          projectId: args.projectId,
          type: "localImage",
        });
        return attachment.path;
      })();
      storedPathByHostPath.set(hostPath, storedPath);
    }
    const path = await storedPath;
    return path === null ? input : { ...input, path };
  };

  try {
    return await Promise.all(
      args.inputGroups.map((input) => Promise.all(input.map(prepareInput))),
    );
  } catch (error) {
    const storedPaths = (
      await Promise.allSettled(storedPathByHostPath.values())
    ).flatMap((result) =>
      result.status === "fulfilled" && result.value !== null
        ? [result.value]
        : [],
    );
    const attachmentDir = projectAttachmentDir(args.dataDir, args.projectId);
    await Promise.allSettled(
      storedPaths.map((path) =>
        rm(resolveAttachmentPath(attachmentDir, path), { force: true }),
      ),
    );
    throw error;
  }
}

interface StoredAttachmentContent {
  content: Buffer;
  etag: string;
  mimeType?: string;
}

export async function readAttachment(
  dataDir: string,
  projectId: string,
  relativePath: string,
): Promise<StoredAttachmentContent> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, relativePath);

  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new ApiError(404, "invalid_request", "Attachment not found");
  }

  return {
    content: await readFile(resolved),
    etag: `"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`,
    mimeType: mimeTypes.lookup(resolved) || undefined,
  };
}

export async function copyProjectAttachments(
  dataDir: string,
  sourceProjectId: string,
  targetProjectId: string,
  attachmentPaths: readonly string[],
): Promise<void> {
  if (sourceProjectId === targetProjectId || attachmentPaths.length === 0) {
    return;
  }

  const uniquePaths = [...new Set(attachmentPaths)];
  const targetDir = projectAttachmentDir(dataDir, targetProjectId);
  const attachments = await Promise.all(
    uniquePaths.map(async (attachmentPath) => ({
      content: (await readAttachment(dataDir, sourceProjectId, attachmentPath))
        .content,
      targetPath: resolveAttachmentPath(targetDir, attachmentPath),
    })),
  );

  await Promise.all(
    attachments.map(async ({ content, targetPath }) => {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
    }),
  );
}

export async function deleteProjectAttachments(
  dataDir: string,
  projectId: string,
): Promise<void> {
  await rm(projectAttachmentDir(dataDir, projectId), {
    force: true,
    recursive: true,
  });
}
