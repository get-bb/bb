import type { PromptInput } from "@bb/domain";
import {
  createConnection,
  getProjectAttachment,
  migrate,
  projects,
} from "@bb/db";
import { beforeEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyProjectAttachments,
  readAttachment,
  resolvePromptAttachmentReferences,
  storeAttachment,
} from "./attachments.js";

const tempDirs: string[] = [];
let db: ReturnType<typeof createConnection>;
beforeEach(() => {
  db = createConnection(":memory:");
  migrate(db);
  for (const id of ["proj_test", "proj_source", "proj_target"])
    db.insert(projects)
      .values({
        id,
        name: id,
        kind: "standard",
        sortKey: id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-attachments-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  db.$client.close();
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

    await copyProjectAttachments(db, dataDir, "proj_source", "proj_target", [
      "image-uploaded.png",
    ]);

    const copied = await readAttachment(
      dataDir,
      "proj_target",
      "image-uploaded.png",
    );
    expect(copied.content.toString("utf8")).toBe("image bytes");
  });

  it("keeps the uploaded name and image type when copying across projects", async () => {
    const dataDir = await makeTempDir();
    const uploaded = await storeAttachment(
      db,
      dataDir,
      "proj_source",
      new File(["png bytes"], "screenshot", { type: "image/png" }),
    );

    await copyProjectAttachments(db, dataDir, "proj_source", "proj_target", [
      uploaded.path,
    ]);

    expect(
      getProjectAttachment(db, "proj_target", uploaded.path),
    ).toMatchObject({ originalName: "screenshot", mimeType: "image/png" });
  });

  it("does not partially copy when one source attachment is missing", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "present.txt"), "present");

    await expect(
      copyProjectAttachments(db, dataDir, "proj_source", "proj_target", [
        "present.txt",
        "missing.txt",
      ]),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      readAttachment(dataDir, "proj_target", "present.txt"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects unavailable portable attachments before copying or changing the input", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "present.txt"), "present");
    const input = [
      {
        type: "localFile" as const,
        path: "present.txt",
        sourceProjectId: "proj_source",
      },
      {
        type: "localFile" as const,
        path: "missing.txt",
        sourceProjectId: "proj_source",
      },
    ];

    await expect(
      resolvePromptAttachmentReferences({
        db,
        dataDir,
        projectId: "proj_target",
        hostId: null,
        input,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readAttachment(dataDir, "proj_target", "present.txt"),
    ).rejects.toMatchObject({ status: 404 });
    expect(input[0]).toEqual({
      type: "localFile",
      path: "present.txt",
      sourceProjectId: "proj_source",
    });
  });

  it("accepts prompt attachment references to uploaded project files", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");

    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(attachmentDir, "notes-uploaded.txt"), "hello", "utf8");

    await expect(
      resolvePromptAttachmentReferences({
        db,
        dataDir,
        projectId: "proj_test",
        hostId: null,
        input: [{ type: "localFile", path: "notes-uploaded.txt" }],
      }),
    ).resolves.toEqual([{ type: "localFile", path: "notes-uploaded.txt" }]);
  });

  it("rejects relative prompt attachment paths that were not uploaded", async () => {
    const dataDir = await makeTempDir();

    await expect(
      resolvePromptAttachmentReferences({
        db,
        dataDir,
        projectId: "proj_test",
        hostId: null,
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
      resolvePromptAttachmentReferences({
        db,
        dataDir,
        projectId: "proj_test",
        hostId: null,
        input: [
          { type: "localFile", path: "/tmp/workspace/alpha.txt" },
          { type: "localImage", path: "C:\\Users\\michael\\screenshot.png" },
          { type: "localFile", path: "https://example.test/notes.txt" },
        ],
      }),
    ).resolves.toEqual([
      { type: "localFile", path: "/tmp/workspace/alpha.txt" },
      { type: "localImage", path: "C:\\Users\\michael\\screenshot.png" },
      { type: "localFile", path: "https://example.test/notes.txt" },
    ]);

    await expect(
      resolvePromptAttachmentReferences({
        db,
        dataDir,
        projectId: "proj_target",
        hostId: null,
        input: [
          {
            type: "localFile",
            path: "/tmp/workspace/alpha.txt",
            sourceProjectId: "proj_source",
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("binds host file references to the destination machine", async () => {
    const dataDir = await makeTempDir();
    const resolve = (input: PromptInput[], hostId: string | null) =>
      resolvePromptAttachmentReferences({
        db,
        dataDir,
        projectId: "proj_test",
        hostId,
        input,
      });

    await expect(
      resolve(
        [
          {
            type: "localFile",
            path: "/tmp/workspace/alpha.txt",
            hostId: "host_a",
          },
        ],
        "host_a",
      ),
    ).resolves.toEqual([
      { type: "localFile", path: "/tmp/workspace/alpha.txt" },
    ]);
    await expect(
      resolve(
        [
          {
            type: "localImage",
            path: "/tmp/workspace/shot.png",
            hostId: "host_a",
          },
        ],
        "host_b",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      resolve(
        [
          {
            type: "localFile",
            path: "notes-uploaded.txt",
            hostId: "host_a",
          },
        ],
        "host_a",
      ),
    ).rejects.toMatchObject({ status: 400 });
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
