import { randomUUID } from "node:crypto";
import { mkdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import {
  PROMPT_ATTACHMENT_MAX_BYTES,
  type ClientTurnRequestId,
  type PromptInput,
} from "@bb/domain";
import { resolveContainedPath } from "@bb/process-utils";
import {
  CommandDispatchError,
  type CommandDispatchOptions,
} from "../command-dispatch-support.js";
import {
  hashFile,
  publishFileWithoutReplacing,
  writeVerifiedFile,
  type WrittenFile,
} from "../verified-file-transfer.js";

type AttachmentPromptInput = Extract<
  PromptInput,
  { type: "localFile" | "localImage" }
>;

const STAGED_ATTACHMENT_MODE = 0o600;

interface StagePromptAttachmentsArgs {
  fetchProjectAttachment: CommandDispatchOptions["fetchProjectAttachment"];
  input: PromptInput[];
  projectId: string;
  requestId: ClientTurnRequestId;
  threadStorageRootPath: string;
  threadId: string;
}

interface StagePromptAttachmentGroupsArgs extends Omit<
  StagePromptAttachmentsArgs,
  "input"
> {
  inputGroups: PromptInput[][];
}

interface StageAttachmentArgs extends StagePromptAttachmentsArgs {
  attachment: AttachmentPromptInput;
  createdPaths: string[];
  stagedPaths: readonly string[];
  stagingDir: string;
}

interface StagedPromptAttachments {
  cleanup: () => Promise<void>;
  input: PromptInput[];
}

interface StagedPromptAttachmentGroups {
  cleanup: () => Promise<void>;
  inputGroups: PromptInput[][];
}

interface StagePromptInputListArgs extends StagePromptAttachmentsArgs {
  createdPaths: string[];
  stagedPaths: string[];
  stagingDir: string;
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

function expectedAttachmentSizeBytes(
  attachment: AttachmentPromptInput,
): number | undefined {
  return attachment.type === "localFile" ? attachment.sizeBytes : undefined;
}

function validateExpectedAttachmentSize(args: StageAttachmentArgs): void {
  const expectedSizeBytes = expectedAttachmentSizeBytes(args.attachment);
  if (
    expectedSizeBytes !== undefined &&
    expectedSizeBytes > PROMPT_ATTACHMENT_MAX_BYTES
  ) {
    throw new CommandDispatchError(
      "attachment_unavailable",
      `Attachment ${args.attachment.path} exceeds ${PROMPT_ATTACHMENT_MAX_BYTES} byte limit`,
    );
  }
}

export function requireContainedPath(
  rootPath: string,
  candidatePath: string,
  message: string,
): string {
  const resolved = resolveContainedPath({
    rootPath,
    candidatePath,
  });
  if (!resolved) {
    throw new CommandDispatchError("invalid_path", message);
  }
  return resolved;
}

function resolveStagingDir(args: StagePromptAttachmentsArgs): string {
  const threadDir = requireContainedPath(
    args.threadStorageRootPath,
    path.join(args.threadStorageRootPath, args.threadId),
    "Attachment staging path escapes the thread storage root",
  );
  return requireContainedPath(
    args.threadStorageRootPath,
    path.join(threadDir, "Attachments"),
    "Attachment staging path escapes the thread storage root",
  );
}

function appendFilenameSuffix(filename: string, suffix: string): string {
  const extension = path.extname(filename);
  if (!extension) {
    return `${filename}${suffix}`;
  }
  return `${filename.slice(0, -extension.length)}${suffix}${extension}`;
}

async function hasContents(
  filePath: string,
  written: WrittenFile,
): Promise<boolean> {
  const existing = await hashFile(filePath);
  return (
    existing.sizeBytes === written.sizeBytes &&
    existing.sha256 === written.sha256
  );
}

async function publishStagedAttachment(
  args: StageAttachmentArgs,
  downloadPath: string,
  written: WrittenFile,
): Promise<string> {
  const filename = attachmentFilename(args.attachment);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = path.join(
      args.stagingDir,
      suffix === 1 ? filename : appendFilenameSuffix(filename, `-${suffix}`),
    );
    if (args.stagedPaths.includes(candidate)) continue;
    if (await publishFileWithoutReplacing(downloadPath, candidate)) {
      args.createdPaths.push(candidate);
      return candidate;
    }
    if (await hasContents(candidate, written)) return candidate;
  }
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

  const expectedSizeBytes = expectedAttachmentSizeBytes(args.attachment);
  const downloadPath = path.join(
    args.stagingDir,
    `.bb-attachment-${randomUUID()}.partial`,
  );
  try {
    let written: WrittenFile;
    try {
      const attachment = await args.fetchProjectAttachment({
        expectedSizeBytes,
        maxBytes: PROMPT_ATTACHMENT_MAX_BYTES,
        projectId: args.projectId,
        threadId: args.threadId,
        path: args.attachment.path,
      });
      written = await writeVerifiedFile({
        destinationPath: downloadPath,
        expected: {
          maxBytes: PROMPT_ATTACHMENT_MAX_BYTES,
          sha256: null,
          sizeBytes: expectedSizeBytes ?? null,
        },
        label: `Attachment ${args.attachment.path}`,
        mode: STAGED_ATTACHMENT_MODE,
        source: attachment.content,
      });
    } catch (error) {
      throw new CommandDispatchError(
        "attachment_unavailable",
        `Failed to fetch attachment ${args.attachment.path}: ${attachmentFetchErrorMessage(error)}`,
      );
    }
    return await publishStagedAttachment(args, downloadPath, written);
  } finally {
    await rm(downloadPath, { force: true });
  }
}

async function stagePromptInputList(
  args: StagePromptInputListArgs,
): Promise<PromptInput[]> {
  const stagedInput: PromptInput[] = [];
  for (const input of args.input) {
    if (!shouldStageAttachment(input)) {
      stagedInput.push(input);
      continue;
    }
    const stagedPath = await stageAttachment({ ...args, attachment: input });
    stagedInput.push({ ...input, path: stagedPath });
    args.stagedPaths.push(stagedPath);
  }
  return stagedInput;
}

export async function stagePromptAttachments(
  args: StagePromptAttachmentsArgs,
): Promise<StagedPromptAttachments> {
  const staged = await stagePromptAttachmentGroups({
    ...args,
    inputGroups: [args.input],
  });
  return {
    cleanup: staged.cleanup,
    input: staged.inputGroups[0] ?? args.input,
  };
}

export async function stagePromptAttachmentGroups(
  args: StagePromptAttachmentGroupsArgs,
): Promise<StagedPromptAttachmentGroups> {
  if (
    !args.inputGroups.some((inputGroup) =>
      inputGroup.some(shouldStageAttachment),
    )
  ) {
    return {
      cleanup: async () => undefined,
      inputGroups: args.inputGroups,
    };
  }

  const stagingDir = resolveStagingDir({ ...args, input: [] });
  await mkdir(stagingDir, { recursive: true });

  const createdPaths: string[] = [];
  const stagedPaths: string[] = [];
  try {
    const inputGroups: PromptInput[][] = [];
    for (const input of args.inputGroups) {
      inputGroups.push(
        await stagePromptInputList({
          ...args,
          createdPaths,
          input,
          stagedPaths,
          stagingDir,
        }),
      );
    }
    return {
      cleanup: () => cleanupStagedAttachments(stagingDir, createdPaths),
      inputGroups,
    };
  } catch (error) {
    await cleanupStagedAttachments(stagingDir, createdPaths);
    throw error;
  }
}
