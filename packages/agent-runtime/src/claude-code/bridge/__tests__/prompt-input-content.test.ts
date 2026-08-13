import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openActualMock, openMock } = vi.hoisted(() => ({
  openActualMock: vi.fn<typeof import("node:fs/promises").open>(),
  openMock: vi.fn<typeof import("node:fs/promises").open>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  openActualMock.mockImplementation(actual.open);
  openMock.mockImplementation(actual.open);
  return { ...actual, open: openMock };
});

import {
  buildClaudePromptContent,
  buildClaudePromptContents,
  CLAUDE_BASE64_IMAGE_SESSION_BUDGET_BYTES,
} from "../prompt-input-content.js";

type ClaudePromptContent = SDKUserMessage["message"]["content"];
type ClaudePromptBlock = Exclude<ClaudePromptContent, string>[number];

const VALID_IMAGES = [
  {
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
      "base64",
    ),
    extension: "png",
    mediaType: "image/png",
  },
  {
    bytes: Buffer.from(
      "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z",
      "base64",
    ),
    extension: "jpg",
    mediaType: "image/jpeg",
  },
  {
    bytes: Buffer.from(
      "R0lGODlhAQABAIAAAExpcf8AACH5BAUAAAAALAAAAAABAAEAAAICTAEAOw==",
      "base64",
    ),
    extension: "gif",
    mediaType: "image/gif",
  },
  {
    bytes: Buffer.from(
      "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
      "base64",
    ),
    extension: "webp",
    mediaType: "image/webp",
  },
] as const;
const PNG_BYTES = VALID_IMAGES[0].bytes;
const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bb-claude-prompt-"));
  tempDirs.push(directory);
  return directory;
}

function requireBlocks(
  content: ClaudePromptContent | undefined,
): ClaudePromptBlock[] {
  if (!Array.isArray(content)) {
    throw new Error("Expected Claude content blocks");
  }
  return content;
}

describe("buildClaudePromptContent", () => {
  afterEach(async () => {
    for (const directory of tempDirs.splice(0)) {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves text-only prompts as strings", async () => {
    await expect(
      buildClaudePromptContent([
        { type: "text", text: "Line one" },
        { type: "text", text: "Line two" },
      ]),
    ).resolves.toBe("Line one\nLine two");
  });

  it.each(VALID_IMAGES)(
    "inlines a decoded local $extension image as $mediaType",
    async (testCase) => {
      const directory = await createTempDir();
      const path = join(directory, `image.${testCase.extension}`);
      await writeFile(path, testCase.bytes);

      const blocks = requireBlocks(
        await buildClaudePromptContent([{ type: "localImage", path }]),
      );
      expect(blocks).toEqual([
        {
          type: "image",
          source: {
            type: "base64",
            media_type: testCase.mediaType,
            data: testCase.bytes.toString("base64"),
          },
        },
      ]);
    },
  );

  it("keeps text and native images ordered in one user message", async () => {
    const directory = await createTempDir();
    const path = join(directory, "image.png");
    await writeFile(path, PNG_BYTES);

    const blocks = requireBlocks(
      await buildClaudePromptContent([
        { type: "text", text: "Before" },
        { type: "localImage", path },
        { type: "text", text: "After" },
      ]),
    );
    expect(blocks).toEqual([
      { type: "text", text: "Before" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: PNG_BYTES.toString("base64"),
        },
      },
      { type: "text", text: "After" },
    ]);
  });

  it.each(["http", "https"])(
    "sends %s URL images as native image blocks",
    async (protocol) => {
      const url = `${protocol}://example.com/image.png`;
      const blocks = requireBlocks(
        await buildClaudePromptContent([{ type: "image", url }]),
      );
      expect(blocks).toEqual([
        {
          type: "image",
          source: { type: "url", url },
        },
      ]);
    },
  );

  it("keeps non-HTTP image URLs as text markers", async () => {
    const url = "ftp://example.com/image.png";
    await expect(
      buildClaudePromptContent([{ type: "image", url }]),
    ).resolves.toBe(`[Attached image: ${url}]`);
  });

  it("keeps ordinary files as path markers beside native images", async () => {
    const blocks = requireBlocks(
      await buildClaudePromptContent([
        { type: "image", url: "https://example.com/image.png" },
        {
          type: "localFile",
          path: "/tmp/report.pdf",
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 42,
        },
      ]),
    );
    expect(blocks).toEqual([
      {
        type: "image",
        source: { type: "url", url: "https://example.com/image.png" },
      },
      {
        type: "text",
        text: '[Attached file "report.pdf" (application/pdf, 42 bytes). It is on disk at /tmp/report.pdf — use the Read tool to view it.]',
      },
    ]);
  });

  it.each([
    { name: "missing", bytes: null },
    { name: "unsupported SVG", bytes: Buffer.from("<svg></svg>") },
    { name: "unknown image data", bytes: Buffer.from("not an image") },
    {
      name: "truncated PNG",
      bytes: PNG_BYTES.subarray(0, Math.floor(PNG_BYTES.length / 2)),
    },
    {
      name: "warning-level JPEG corruption",
      bytes: Buffer.concat([
        VALID_IMAGES[1].bytes.subarray(0, 2),
        Buffer.alloc(16),
        VALID_IMAGES[1].bytes.subarray(2),
      ]),
    },
  ])("keeps $name available as a Read-tool marker", async (testCase) => {
    const directory = await createTempDir();
    const path = join(directory, "image.svg");
    if (testCase.bytes !== null) await writeFile(path, testCase.bytes);

    await expect(
      buildClaudePromptContent([{ type: "localImage", path }]),
    ).resolves.toBe(
      `[Attached image. It is on disk at ${path} — use the Read tool to view it.]`,
    );
  });

  it("rejects images whose decoded dimensions exceed Claude's limit", async () => {
    const directory = await createTempDir();
    const path = join(directory, "too-wide.png");
    const bytes = await sharp({
      create: {
        width: 8_001,
        height: 1,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();
    await writeFile(path, bytes);

    await expect(
      buildClaudePromptContent([{ type: "localImage", path }]),
    ).resolves.toContain("use the Read tool to view it");
  });

  it("inlines the exact base64 size limit and falls back above it", async () => {
    const directory = await createTempDir();
    const exactPath = join(directory, "exact.png");
    const oversizedPath = join(directory, "oversized.png");
    const encodedLimit = 10 * 1024 * 1024;
    const exactRawSize = 3 * (encodedLimit / 4);

    await writeFile(exactPath, PNG_BYTES);
    await truncate(exactPath, exactRawSize);
    const exactBlocks = requireBlocks(
      await buildClaudePromptContent([{ type: "localImage", path: exactPath }]),
    );
    const exactImage = exactBlocks[0];
    expect(exactImage?.type).toBe("image");
    if (exactImage?.type !== "image" || exactImage.source.type !== "base64") {
      throw new Error("Expected a base64 image block at the size limit");
    }
    expect(exactImage.source.data).toHaveLength(encodedLimit);

    await writeFile(oversizedPath, PNG_BYTES);
    await truncate(oversizedPath, exactRawSize + 1);
    await expect(
      buildClaudePromptContent([{ type: "localImage", path: oversizedPath }]),
    ).resolves.toContain("use the Read tool to view it");
  });

  it("keeps aggregate native image data within the message budget", async () => {
    const directory = await createTempDir();
    const path = join(directory, "budget.png");
    await writeFile(path, PNG_BYTES);
    await truncate(path, 6 * 1024 * 1024);

    const blocks = requireBlocks(
      await buildClaudePromptContent([
        { type: "localImage", path },
        { type: "localImage", path },
        { type: "localImage", path },
      ]),
    );

    expect(blocks.slice(0, 2).map((block) => block.type)).toEqual([
      "image",
      "image",
    ]);
    expect(blocks[2]).toEqual({
      type: "text",
      text: `[Attached image. It is on disk at ${path} — use the Read tool to view it.]`,
    });
    const encodedBytes = blocks.reduce(
      (total, block) =>
        block.type === "image" && block.source.type === "base64"
          ? total + block.source.data.length
          : total,
      0,
    );
    expect(encodedBytes).toBe(16 * 1024 * 1024);
    expect(encodedBytes).toBeLessThanOrEqual(20 * 1024 * 1024);
  });

  it("shares the native-image budget across grouped SDK messages", async () => {
    const directory = await createTempDir();
    const path = join(directory, "grouped-budget.png");
    await writeFile(path, PNG_BYTES);
    await truncate(path, 6 * 1024 * 1024);

    const result = await buildClaudePromptContents(
      [
        [{ type: "localImage", path }],
        [{ type: "localImage", path }],
        [{ type: "localImage", path }],
      ],
      CLAUDE_BASE64_IMAGE_SESSION_BUDGET_BYTES,
    );
    if (!result) throw new Error("Expected grouped Claude prompt content");

    expect(result.base64ImageBytes).toBe(16 * 1024 * 1024);
    expect(
      result.contents.map((content) =>
        Array.isArray(content) ? content[0]?.type : "text",
      ),
    ).toEqual(["image", "image", "text"]);
    expect(result.contents[2]).toContain("use the Read tool to view it");
  });

  it("falls back when a local image grows during its bounded read", async () => {
    const path = "/tmp/growing.png";
    const read = vi
      .fn()
      .mockImplementationOnce(async (bytes: Buffer) => {
        PNG_BYTES.copy(bytes);
        return { buffer: bytes, bytesRead: PNG_BYTES.length };
      })
      .mockImplementationOnce(async (bytes: Buffer) => ({
        buffer: bytes,
        bytesRead: 1,
      }));
    const close = vi.fn().mockResolvedValue(undefined);
    openMock.mockResolvedValueOnce({
      close,
      read,
      stat: vi.fn().mockResolvedValue({
        isFile: () => true,
        size: PNG_BYTES.length,
      }),
    } as never);

    await expect(
      buildClaudePromptContent([{ type: "localImage", path }]),
    ).resolves.toBe(
      `[Attached image. It is on disk at ${path} — use the Read tool to view it.]`,
    );
    expect(read).toHaveBeenNthCalledWith(
      1,
      expect.any(Buffer),
      0,
      PNG_BYTES.length,
      0,
    );
    expect(read).toHaveBeenNthCalledWith(
      2,
      expect.any(Buffer),
      0,
      1,
      PNG_BYTES.length,
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
