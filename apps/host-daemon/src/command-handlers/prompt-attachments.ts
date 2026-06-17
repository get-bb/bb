import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClientTurnRequestId, PromptInput } from "@bb/domain";
import { resolveContainedPath } from "@bb/process-utils";
import {
  CommandDispatchError,
  type CommandDispatchOptions,
} from "../command-dispatch-support.js";

type AttachmentPromptInput = Extract<
  PromptInput,
  { type: "localFile" | "localImage" }
>;

const IMAGE_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const FILE_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
const STAGED_ATTACHMENT_MODE = 0o600;

interface StagePromptAttachmentsArgs {
  fetchProjectAttachment: CommandDispatchOptions["fetchProjectAttachment"];
  input: PromptInput[];
  projectId: string;
  requestId: ClientTurnRequestId;
  threadStorageRootPath: string;
  threadId: string;
}

interface StageAttachmentArgs extends StagePromptAttachmentsArgs {
  attachment: AttachmentPromptInput;
  stagedPath: string;
}

interface StagedPromptAttachments {
  cleanup: () => Promise<void>;
  input: PromptInput[];
}

function pathLooksRuntimeReadable(rawPath: string): boolean {
  return (
    path.isAbsolute(rawPath) ||
    path.win32.isAbsolute(rawPath) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath)
  );
}

function shouldStageAttachment(
  input: PromptInput,
): input is AttachmentPromptInput {
  if (input.type !== "localFile" && input.type !== "localImage") {
    return false;
  }
  return !pathLooksRuntimeReadable(input.path);
}

function attachmentFilename(attachment: AttachmentPromptInput): string {
  const rawName =
    attachment.type === "localFile" && attachment.name
      ? attachment.name
      : attachment.path;
  const normalized = rawName.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  const sanitized = basename.replace(/[^a-zA-Z0-9._-]+/gu, "-");
  return sanitized.length > 0 ? sanitized : "attachment";
}

function attachmentFetchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attachmentSizeLimitBytes(attachment: AttachmentPromptInput): number {
  return attachment.type === "localImage"
    ? IMAGE_ATTACHMENT_LIMIT_BYTES
    : FILE_ATTACHMENT_LIMIT_BYTES;
}

function expectedAttachmentSizeBytes(
  attachment: AttachmentPromptInput,
): number | undefined {
  return attachment.type === "localFile" ? attachment.sizeBytes : undefined;
}

function validateExpectedAttachmentSize(args: StageAttachmentArgs): void {
  const expectedSizeBytes = expectedAttachmentSizeBytes(args.attachment);
  const maxBytes = attachmentSizeLimitBytes(args.attachment);
  if (expectedSizeBytes !== undefined && expectedSizeBytes > maxBytes) {
    throw new CommandDispatchError(
      "attachment_unavailable",
      `Attachment ${args.attachment.path} exceeds ${maxBytes} byte limit`,
    );
  }
}

function validateFetchedAttachmentSize(
  attachment: AttachmentPromptInput,
  bytes: Uint8Array,
): void {
  const expectedSizeBytes = expectedAttachmentSizeBytes(attachment);
  if (
    expectedSizeBytes !== undefined &&
    bytes.byteLength !== expectedSizeBytes
  ) {
    throw new CommandDispatchError(
      "attachment_unavailable",
      `Attachment ${attachment.path} size mismatch: expected ${expectedSizeBytes} bytes, received ${bytes.byteLength}`,
    );
  }

  const maxBytes = attachmentSizeLimitBytes(attachment);
  if (bytes.byteLength > maxBytes) {
    throw new CommandDispatchError(
      "attachment_unavailable",
      `Attachment ${attachment.path} exceeds ${maxBytes} byte limit`,
    );
  }
}

function requireContainedPath(rootPath: string, candidatePath: string): string {
  const resolved = resolveContainedPath({
    rootPath,
    candidatePath,
  });
  if (!resolved) {
    throw new CommandDispatchError(
      "invalid_path",
      "Attachment staging path escapes the thread storage root",
    );
  }
  return resolved;
}

function resolveStagingDir(args: StagePromptAttachmentsArgs): string {
  const threadDir = requireContainedPath(
    args.threadStorageRootPath,
    path.join(args.threadStorageRootPath, args.threadId),
  );
  return requireContainedPath(
    args.threadStorageRootPath,
    path.join(threadDir, "Attachments"),
  );
}

function appendFilenameSuffix(filename: string, suffix: string): string {
  const extension = path.extname(filename);
  if (!extension) {
    return `${filename}${suffix}`;
  }
  return `${filename.slice(0, -extension.length)}${suffix}${extension}`;
}

function uniqueStagedPath(
  stagingDir: string,
  filename: string,
  stagedPaths: readonly string[],
): string {
  let candidate = path.join(stagingDir, filename);
  let suffix = 2;
  while (stagedPaths.includes(candidate)) {
    candidate = path.join(
      stagingDir,
      appendFilenameSuffix(filename, `-${suffix}`),
    );
    suffix += 1;
  }
  return candidate;
}

async function cleanupStagedAttachments(
  stagingDir: string,
  stagedPaths: readonly string[],
): Promise<void> {
  await Promise.all(
    stagedPaths.map((stagedPath) =>
      rm(stagedPath, { force: true, recursive: false }),
    ),
  );
  await rmdir(stagingDir).catch(() => undefined);
}

async function stageAttachment(args: StageAttachmentArgs): Promise<string> {
  validateExpectedAttachmentSize(args);

  let bytes: Uint8Array;
  try {
    const attachment = await args.fetchProjectAttachment({
      expectedSizeBytes: expectedAttachmentSizeBytes(args.attachment),
      maxBytes: attachmentSizeLimitBytes(args.attachment),
      projectId: args.projectId,
      threadId: args.threadId,
      path: args.attachment.path,
    });
    bytes = attachment.bytes;
  } catch (error) {
    throw new CommandDispatchError(
      "attachment_unavailable",
      `Failed to fetch attachment ${args.attachment.path}: ${attachmentFetchErrorMessage(error)}`,
    );
  }

  validateFetchedAttachmentSize(args.attachment, bytes);
  await writeFile(args.stagedPath, bytes, { mode: STAGED_ATTACHMENT_MODE });
  return args.stagedPath;
}

export async function stagePromptAttachments(
  args: StagePromptAttachmentsArgs,
): Promise<StagedPromptAttachments> {
  if (!args.input.some(shouldStageAttachment)) {
    return {
      cleanup: async () => undefined,
      input: args.input,
    };
  }

  const stagingDir = resolveStagingDir(args);
  await mkdir(stagingDir, { recursive: true });

  const stagedInput: PromptInput[] = [];
  const stagedPaths: string[] = [];
  try {
    for (const input of args.input) {
      if (!shouldStageAttachment(input)) {
        stagedInput.push(input);
        continue;
      }
      const stagedPath = uniqueStagedPath(
        stagingDir,
        attachmentFilename(input),
        stagedPaths,
      );
      stagedInput.push({
        ...input,
        path: await stageAttachment({
          ...args,
          attachment: input,
          stagedPath,
        }),
      });
      stagedPaths.push(stagedPath);
    }
  } catch (error) {
    await cleanupStagedAttachments(stagingDir, stagedPaths);
    throw error;
  }

  return {
    cleanup: () => cleanupStagedAttachments(stagingDir, stagedPaths),
    input: stagedInput,
  };
}
