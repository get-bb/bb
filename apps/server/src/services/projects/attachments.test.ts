import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../errors.js";
import {
  copyProjectAttachments,
  preparePromptAttachmentInputGroups,
  readAttachment,
  storeAttachment,
  validatePromptAttachmentReferences,
} from "./attachments.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-attachments-"));
  tempDirs.push(dir);
  return dir;
}

async function attachmentNames(
  dataDir: string,
  projectId: string,
): Promise<string[]> {
  return readdir(join(dataDir, "attachments", projectId)).catch(() => []);
}

async function waitForStoredAttachment(
  dataDir: string,
  projectId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await attachmentNames(dataDir, projectId)).length > 0) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
  }
  throw new Error("Timed out waiting for the successful sibling attachment");
}

class UnbufferableFile extends File {
  override async arrayBuffer(): Promise<ArrayBuffer> {
    throw new Error("Attachment body must not be buffered");
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("project attachments", () => {
  it("rejects HEIC uploads before buffering their body", async () => {
    const dataDir = await makeTempDir();
    const file = new UnbufferableFile(["heic"], "photo.heic", {
      type: "image/heic",
    });

    await expect(
      storeAttachment(dataDir, "proj_test", file),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: expect.stringContaining("HEIC images are not supported"),
      }),
    });
  });

  it("rejects oversized image uploads before buffering their body", async () => {
    const dataDir = await makeTempDir();
    const file = new UnbufferableFile(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "large.png",
      { type: "image/png" },
    );

    await expect(
      storeAttachment(dataDir, "proj_test", file),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment exceeds 10MB limit",
      }),
    });
  });

  it("reads attachments from inside the project attachment directory", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");
    const attachmentPath = join(attachmentDir, "notes.txt");

    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, "hello", "utf8");

    const result = await readAttachment(dataDir, "proj_test", "notes.txt");

    expect(result.content.toString("utf8")).toBe("hello");
    expect(result.mimeType).toBe("text/plain");
  });

  it("copies project-scoped attachments without changing their draft paths", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "image-uploaded.png"), "image bytes");

    await copyProjectAttachments(dataDir, "proj_source", "proj_target", [
      "image-uploaded.png",
    ]);

    const copied = await readAttachment(
      dataDir,
      "proj_target",
      "image-uploaded.png",
    );
    expect(copied.content.toString("utf8")).toBe("image bytes");
  });

  it("does not partially copy when one source attachment is missing", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "present.txt"), "present");

    await expect(
      copyProjectAttachments(dataDir, "proj_source", "proj_target", [
        "present.txt",
        "missing.txt",
      ]),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      readAttachment(dataDir, "proj_target", "present.txt"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("accepts prompt attachment references to uploaded project files", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");

    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(attachmentDir, "notes-uploaded.txt"), "hello", "utf8");

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [{ type: "localFile", path: "notes-uploaded.txt" }],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects relative prompt attachment paths that were not uploaded", async () => {
    const dataDir = await makeTempDir();

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [{ type: "localFile", path: "alpha.txt" }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: expect.stringContaining(
          "relative workspace file paths are not valid attachment references",
        ),
      }),
    });
  });

  it("allows runtime-readable prompt attachment paths without upload validation", async () => {
    const dataDir = await makeTempDir();

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [
          { type: "localFile", path: "/tmp/workspace/alpha.txt" },
          { type: "localImage", path: "C:\\Users\\michael\\screenshot.png" },
          { type: "localFile", path: "https://example.test/notes.txt" },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves uploaded and URL-like image references during prompt preparation", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(attachmentDir, "uploaded.png"), "uploaded bytes");
    const input = [
      { type: "localImage" as const, path: "uploaded.png" },
      { type: "localImage" as const, path: "https://example.test/image.png" },
      { type: "localImage" as const, path: "data:image/png;base64,aW1hZ2U=" },
      { type: "localImage" as const, path: "blob:https://example.test/id" },
      { type: "localFile" as const, path: "/remote/notes.txt" },
    ];

    await expect(
      preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [input],
        projectId: "proj_test",
        readHostFile: async () => {
          throw new Error("URL-like and file inputs must not be imported");
        },
      }),
    ).resolves.toEqual([input]);
  });

  it("imports Windows absolute image paths with their original filename", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.from("remote image bytes");
    const absolutePath = "C:\\Users\\michael\\reference.png";

    const [prepared] = await preparePromptAttachmentInputGroups({
      dataDir,
      inputGroups: [[{ type: "localImage", path: absolutePath }]],
      projectId: "proj_test",
      readHostFile: async (path) => ({
        path,
        content: bytes.toString("base64"),
        contentEncoding: "base64",
        mimeType: "image/png",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
      }),
    });
    const image = prepared?.[0];
    expect(image?.type).toBe("localImage");
    if (image?.type !== "localImage") {
      throw new Error("Expected imported image input");
    }
    expect(image.path).toMatch(/^reference-\d+-[a-z0-9]{6}\.png$/u);
    await expect(
      readAttachment(dataDir, "proj_test", image.path),
    ).resolves.toMatchObject({ content: bytes, mimeType: "image/png" });
  });

  it.each(["/remote/reference", "/remote/backup.2024"])(
    "makes PNG bytes from a non-image-looking host path renderable: %s",
    async (absolutePath) => {
      const dataDir = await makeTempDir();

      const [prepared] = await preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [[{ type: "localImage", path: absolutePath }]],
        projectId: "proj_test",
        readHostFile: async (path) => ({
          path,
          content: ONE_PIXEL_PNG.toString("base64"),
          contentEncoding: "base64",
          sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
          sizeBytes: ONE_PIXEL_PNG.byteLength,
        }),
      });
      const image = prepared?.[0];
      expect(image?.type).toBe("localImage");
      if (image?.type !== "localImage") {
        throw new Error("Expected imported image input");
      }

      expect(image.path).toMatch(/^(reference|backup)-\d+-[a-z0-9]{6}\.png$/u);
      await expect(
        readAttachment(dataDir, "proj_test", image.path),
      ).resolves.toMatchObject({
        content: ONE_PIXEL_PNG,
        mimeType: "image/png",
      });
    },
  );

  it("imports a file URL from the execution host", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.from("file URL image bytes");
    let readPath: string | null = null;

    const [prepared] = await preparePromptAttachmentInputGroups({
      dataDir,
      inputGroups: [
        [{ type: "localImage", path: "file:///remote/reference.png" }],
      ],
      projectId: "proj_test",
      readHostFile: async (path) => {
        readPath = path;
        return {
          path,
          content: bytes.toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/png",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
        };
      },
    });

    expect(readPath).toBe("/remote/reference.png");
    expect(prepared?.[0]).toMatchObject({
      type: "localImage",
      path: expect.stringMatching(/^reference-\d+-[a-z0-9]{6}\.png$/u),
    });
  });

  it("preserves per-input visibility while deduplicating the host image read", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.from("shared remote image bytes");
    const absolutePath = "/remote/reference.png";
    let readCount = 0;

    const [prepared] = await preparePromptAttachmentInputGroups({
      dataDir,
      inputGroups: [
        [
          {
            type: "localImage",
            path: absolutePath,
            visibility: "agent-only",
          },
          { type: "localImage", path: absolutePath },
        ],
      ],
      projectId: "proj_test",
      readHostFile: async (path) => {
        readCount += 1;
        return {
          path,
          content: bytes.toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/png",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
        };
      },
    });

    expect(readCount).toBe(1);
    expect(prepared?.[0]).toMatchObject({
      type: "localImage",
      visibility: "agent-only",
    });
    expect(prepared?.[1]).not.toHaveProperty("visibility");
    expect(prepared?.[0]?.type).toBe("localImage");
    expect(prepared?.[1]?.type).toBe("localImage");
    if (
      prepared?.[0]?.type !== "localImage" ||
      prepared[1]?.type !== "localImage"
    ) {
      throw new Error("Expected imported image input");
    }
    expect(prepared[0].path).toBe(prepared[1].path);
  });

  it("preserves an absolute HEIC path when it cannot become a durable image", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.from("heic image bytes");
    const input = [
      { type: "localImage" as const, path: "/remote/reference.heic" },
    ];

    await expect(
      preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [input],
        projectId: "proj_test",
        readHostFile: async (path) => ({
          path,
          content: bytes.toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/heic",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
        }),
      }),
    ).resolves.toEqual([input]);
  });

  it("preserves an absolute image path when the host transport size limit rejects it", async () => {
    const dataDir = await makeTempDir();
    const input = [
      { type: "localImage" as const, path: "/remote/reference-large.png" },
    ];

    await expect(
      preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [input],
        projectId: "proj_test",
        readHostFile: async () => {
          throw new ApiError(
            413,
            "file_too_large",
            "File exceeds the host image transport limit",
          );
        },
      }),
    ).resolves.toEqual([input]);
  });

  it("preserves visibility when non-image-looking host metadata exceeds the image limit", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
    const input = [
      {
        type: "localImage" as const,
        path: "/remote/reference-large",
        visibility: "agent-only" as const,
      },
    ];

    await expect(
      preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [input],
        projectId: "proj_test",
        readHostFile: async (path) => ({
          path,
          content: bytes.toString("base64"),
          contentEncoding: "base64",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
        }),
      }),
    ).resolves.toEqual([input]);
  });

  it("removes sibling imports when one image in the batch fails integrity validation", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.from("remote image bytes");
    const goodPath = "/remote/good.png";
    const corruptPath = "/remote/corrupt.png";

    await expect(
      preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [
          [
            { type: "localImage", path: goodPath },
            { type: "localImage", path: corruptPath },
          ],
        ],
        projectId: "proj_test",
        readHostFile: async (path) => {
          if (path === corruptPath) {
            await waitForStoredAttachment(dataDir, "proj_test");
          }
          return {
            path,
            content: bytes.toString("base64"),
            contentEncoding: "base64",
            mimeType: "image/png",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            sizeBytes:
              path === corruptPath ? bytes.byteLength + 1 : bytes.byteLength,
          };
        },
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: expect.objectContaining({ code: "attachment_size_mismatch" }),
    });

    await expect(attachmentNames(dataDir, "proj_test")).resolves.toEqual([]);
  });

  it("rejects a host image whose checksum does not match its bytes", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.from("remote image bytes");

    await expect(
      preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [[{ type: "localImage", path: "/remote/corrupt.png" }]],
        projectId: "proj_test",
        readHostFile: async (path) => ({
          path,
          content: bytes.toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/png",
          sha256: "0".repeat(64),
          sizeBytes: bytes.byteLength,
        }),
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: expect.objectContaining({ code: "attachment_checksum_mismatch" }),
    });
    await expect(attachmentNames(dataDir, "proj_test")).resolves.toEqual([]);
  });

  it("rejects POSIX traversal outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "../secret.txt"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects Windows-style traversal outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "..\\secret.txt"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects absolute paths outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "/etc/passwd"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects attachment paths that resolve to the attachment directory itself", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "."),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message:
          "Attachment path must refer to a file inside the project directory",
      }),
    });
  });

  it("treats percent-encoded traversal markers as literal file names", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "%2e%2e%2fsecret.txt"),
    ).rejects.toMatchObject({
      status: 404,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment not found",
      }),
    });
  });
});
