import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyProjectAttachments,
  readAttachment,
  validatePromptAttachmentReferences,
} from "./attachments.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-attachments-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("project attachments", () => {
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
