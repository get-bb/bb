import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { promptInputSchema } from "@bb/domain";
import sharp from "sharp";

type ClaudePromptContent = SDKUserMessage["message"]["content"];

type ClaudePromptBlock = Exclude<ClaudePromptContent, string>[number];
type ClaudeImageBlock = Extract<ClaudePromptBlock, { type: "image" }>;
type ClaudeImageMediaType = Extract<
  ClaudeImageBlock["source"],
  { type: "base64" }
>["media_type"];
type ClaudePromptPart = string | ClaudeImageBlock;
type ClaudePromptContents = ClaudePromptContent[];

interface ClaudePromptContentsResult {
  base64ImageBytes: number;
  contents: ClaudePromptContents;
}

interface Base64ImageBudget {
  remainingBytes: number;
}

// Anthropic limits direct-API images to 10 MiB after base64 encoding. Larger
// staged images remain available through Claude Code's Read tool.
const CLAUDE_BASE64_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
// Keep native image data well below the 32 MiB request limit so text and JSON
// framing still have room. The bridge applies this across retained session
// history because the SDK can coalesce messages and resend earlier images.
export const CLAUDE_BASE64_IMAGE_SESSION_BUDGET_BYTES = 20 * 1024 * 1024;
const CLAUDE_MAX_IMAGE_DIMENSION = 8_000;
const CLAUDE_MAX_IMAGE_PIXELS =
  CLAUDE_MAX_IMAGE_DIMENSION * CLAUDE_MAX_IMAGE_DIMENSION;

function localAttachmentMarker(args: {
  kind: "image" | "file";
  path: string;
  name?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
}): string {
  const namePart = args.name && args.name.length > 0 ? ` "${args.name}"` : "";
  const details: string[] = [];
  if (args.mimeType) details.push(args.mimeType);
  if (args.sizeBytes !== undefined) details.push(`${args.sizeBytes} bytes`);
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `[Attached ${args.kind}${namePart}${suffix}. It is on disk at ${args.path} — use the Read tool to view it.]`;
}

function remoteImageMarker(url: string): string {
  return `[Attached image: ${url}]`;
}

function isHttpUrl(url: string): boolean {
  const protocol = new URL(url).protocol;
  return protocol === "http:" || protocol === "https:";
}

function base64EncodedSize(rawSize: number): number {
  return 4 * Math.ceil(rawSize / 3);
}

function toClaudeImageMediaType(
  format: string | undefined,
): ClaudeImageMediaType | null {
  switch (format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

async function validateClaudeImage(
  bytes: Buffer,
): Promise<ClaudeImageMediaType | null> {
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: CLAUDE_MAX_IMAGE_PIXELS,
    pages: -1,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  const mediaType = toClaudeImageMediaType(metadata.format);
  if (
    mediaType === null ||
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width > CLAUDE_MAX_IMAGE_DIMENSION ||
    metadata.height > CLAUDE_MAX_IMAGE_DIMENSION
  ) {
    return null;
  }

  // Metadata alone does not prove that the pixel stream is complete. Force a
  // small decode so truncated or corrupt images fall back to the Read tool.
  await image.resize({ width: 1, height: 1, fit: "inside" }).toBuffer();
  return mediaType;
}

async function readLocalImage(
  path: string,
  encodedSizeLimit: number,
): Promise<Buffer | null> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const file = await handle.stat();
    if (!file.isFile() || base64EncodedSize(file.size) > encodedSizeLimit) {
      return null;
    }

    const bytes = Buffer.alloc(file.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesRead === 0) return null;
      offset += result.bytesRead;
    }

    // A bounded read prevents a file that grows after stat() from causing an
    // unbounded allocation. Fall back if it changed while being read.
    const trailingByte = Buffer.allocUnsafe(1);
    const trailingRead = await handle.read(trailingByte, 0, 1, offset);
    return trailingRead.bytesRead === 0 ? bytes : null;
  } finally {
    await handle.close();
  }
}

async function buildLocalImagePart(
  path: string,
  remainingSessionBudget: number,
): Promise<ClaudePromptPart> {
  const fallback = localAttachmentMarker({ kind: "image", path });
  if (remainingSessionBudget <= 0) return fallback;
  try {
    const encodedSizeLimit = Math.min(
      CLAUDE_BASE64_IMAGE_LIMIT_BYTES,
      remainingSessionBudget,
    );
    const bytes = await readLocalImage(path, encodedSizeLimit);
    if (bytes === null) return fallback;
    const mediaType = await validateClaudeImage(bytes);
    if (mediaType === null) return fallback;

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: bytes.toString("base64"),
      },
    };
  } catch {
    return fallback;
  }
}

function toContentBlocks(parts: ClaudePromptPart[]): ClaudePromptBlock[] {
  const blocks: ClaudePromptBlock[] = [];
  let textParts: string[] = [];
  const flushText = (): void => {
    if (textParts.length === 0) return;
    blocks.push({ type: "text", text: textParts.join("\n") });
    textParts = [];
  };

  for (const part of parts) {
    if (typeof part === "string") {
      textParts.push(part);
      continue;
    }
    flushText();
    blocks.push(part);
  }
  flushText();
  return blocks;
}

async function buildClaudePromptContentWithBudget(
  input: unknown,
  budget: Base64ImageBudget,
): Promise<ClaudePromptContent | undefined> {
  if (typeof input === "string") {
    return input.length > 0 ? input : undefined;
  }
  if (!Array.isArray(input)) return undefined;

  const parts: ClaudePromptPart[] = [];
  for (const item of input) {
    const parsed = promptInputSchema.safeParse(item);
    if (!parsed.success) continue;
    const entry = parsed.data;
    switch (entry.type) {
      case "text":
        if (entry.text.length > 0) parts.push(entry.text);
        break;
      case "image":
        parts.push(
          isHttpUrl(entry.url)
            ? {
                type: "image",
                source: { type: "url", url: entry.url },
              }
            : remoteImageMarker(entry.url),
        );
        break;
      case "localImage": {
        const part = await buildLocalImagePart(
          entry.path,
          budget.remainingBytes,
        );
        parts.push(part);
        if (typeof part !== "string" && part.source.type === "base64") {
          budget.remainingBytes -= part.source.data.length;
        }
        break;
      }
      case "localFile":
        parts.push(
          localAttachmentMarker({
            kind: "file",
            path: entry.path,
            name: entry.name,
            mimeType: entry.mimeType,
            sizeBytes: entry.sizeBytes,
          }),
        );
        break;
    }
  }

  if (parts.length === 0) return undefined;
  return parts.some((part) => typeof part !== "string")
    ? toContentBlocks(parts)
    : parts.join("\n");
}

/** Convert one BB prompt input using a fresh Claude session image budget. */
export async function buildClaudePromptContent(
  input: unknown,
): Promise<ClaudePromptContent | undefined> {
  return buildClaudePromptContentWithBudget(input, {
    remainingBytes: CLAUDE_BASE64_IMAGE_SESSION_BUDGET_BYTES,
  });
}

/** Convert every message that may share one Claude provider request. */
export async function buildClaudePromptContents(
  inputs: readonly unknown[],
  base64ImageBudgetBytes: number,
): Promise<ClaudePromptContentsResult | undefined> {
  const budget = { remainingBytes: Math.max(0, base64ImageBudgetBytes) };
  const initialBudget = budget.remainingBytes;
  const contents: ClaudePromptContents = [];
  for (const input of inputs) {
    const content = await buildClaudePromptContentWithBudget(input, budget);
    if (content === undefined) return undefined;
    contents.push(content);
  }
  return {
    base64ImageBytes: initialBudget - budget.remainingBytes,
    contents,
  };
}
