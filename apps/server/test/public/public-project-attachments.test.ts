import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { uploadedPromptAttachmentSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

async function upload(
  app: {
    request(input: string, init?: RequestInit): Response | Promise<Response>;
  },
  projectId: string,
  file: File,
  extraField?: [string, string],
): Promise<Response> {
  const form = new FormData();
  form.set("file", file);
  if (extraField) form.set(...extraField);
  return app.request(`/api/v1/projects/${projectId}/attachments`, {
    body: form,
    method: "POST",
  });
}

describe("public project attachments", () => {
  it("preserves text and binary bytes plus upload filename and MIME metadata", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-attachments",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const fixtures = [
        {
          bytes: new TextEncoder().encode("alpha\nβeta\n"),
          filename: "notes.txt",
          mimeType: "text/plain;charset=utf-8",
          responseMimeType: "text/plain",
          type: "localFile" as const,
        },
        {
          bytes: new Uint8Array([0, 255, 1, 128, 13, 10]),
          filename: "payload.bin",
          mimeType: "application/x-bb-binary",
          responseMimeType: "application/octet-stream",
          type: "localFile" as const,
        },
      ];

      for (const fixture of fixtures) {
        const response = await upload(
          harness.app,
          project.id,
          new File([fixture.bytes], fixture.filename, {
            type: fixture.mimeType,
          }),
        );
        expect(response.status).toBe(201);
        const uploaded = uploadedPromptAttachmentSchema.parse(
          await readJson(response),
        );
        expect(uploaded).toMatchObject({
          type: fixture.type,
          name: fixture.filename,
          mimeType: fixture.mimeType,
          sizeBytes: fixture.bytes.byteLength,
        });
        expect(uploaded.path.endsWith(`/${fixture.filename}`)).toBe(true);

        const contentUrl = `/api/v1/projects/${project.id}/attachments/content?path=${encodeURIComponent(uploaded.path)}`;
        const content = await harness.app.request(contentUrl);
        expect(content.status).toBe(200);
        expect(new Uint8Array(await content.arrayBuffer())).toEqual(
          fixture.bytes,
        );
        expect(content.headers.get("cache-control")).toBe(
          "private, immutable, max-age=31536000",
        );
        expect(content.headers.get("content-length")).toBe(
          String(fixture.bytes.byteLength),
        );
        expect(content.headers.get("content-disposition")).toContain("inline;");
        const etag = content.headers.get("etag");
        expect(etag).toMatch(/^"[^"]+"$/u);
        const revalidated = await harness.app.request(contentUrl, {
          headers: { "if-none-match": etag ?? "" },
        });
        expect(revalidated.status).toBe(304);
        expect(revalidated.headers.get("etag")).toBe(etag);
        expect((await revalidated.arrayBuffer()).byteLength).toBe(0);

        const preview = await harness.app.request(
          `/api/v1/projects/${project.id}/attachments/preview?path=${encodeURIComponent(uploaded.path)}`,
        );
        const download = await harness.app.request(
          `/api/v1/projects/${project.id}/attachments/download?path=${encodeURIComponent(uploaded.path)}`,
        );
        expect(preview.status).toBe(200);
        expect(preview.headers.get("content-disposition")).toContain("inline;");
        expect(download.status).toBe(200);
        expect(download.headers.get("content-disposition")).toContain(
          `attachment; filename="${fixture.filename}";`,
        );
        expect(download.headers.get("content-type")).toBe(
          fixture.responseMimeType,
        );
      }
    });
  });

  it("returns stable invalid_request envelopes for oversize and ambiguous forms", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-attachment-limits",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const oversized = await upload(
        harness.app,
        project.id,
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.png", {
          type: "image/png",
        }),
      );
      expect(oversized.status).toBe(400);
      await expect(readJson(oversized)).resolves.toEqual({
        code: "invalid_request",
        message: "Attachment exceeds 10MB limit",
      });

      const oversizedFile = await upload(
        harness.app,
        project.id,
        new File([new Uint8Array(25 * 1024 * 1024 + 1)], "huge-archive.bin", {
          type: "application/octet-stream",
        }),
      );
      expect(oversizedFile.status).toBe(400);
      await expect(readJson(oversizedFile)).resolves.toEqual({
        code: "invalid_request",
        message: "Attachment exceeds 25MB limit",
      });

      const ambiguous = await upload(
        harness.app,
        project.id,
        new File(["ok"], "ok.txt", { type: "text/plain" }),
        ["filename", "ignored.txt"],
      );
      expect(ambiguous.status).toBe(400);
      await expect(readJson(ambiguous)).resolves.toEqual({
        code: "invalid_request",
        message:
          'Attachment upload accepts exactly one multipart field named "file"',
      });
    });
  });

  it("preserves safe Unicode, spaces, percent, and hash characters in download names", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-attachment-name",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const fileName = "資料 100%# final.md";
      const uploadedResponse = await upload(
        harness.app,
        project.id,
        new File(["# Notes"], fileName, { type: "text/markdown" }),
      );
      const uploaded = uploadedPromptAttachmentSchema.parse(
        await readJson(uploadedResponse),
      );
      expect(uploaded.path.endsWith(`/${fileName}`)).toBe(true);

      const download = await harness.app.request(
        `/api/v1/projects/${project.id}/attachments/download?path=${encodeURIComponent(uploaded.path)}`,
      );
      const disposition = download.headers.get("content-disposition") ?? "";
      const encodedName = disposition.split("filename*=UTF-8''")[1] ?? "";
      expect(download.status).toBe(200);
      expect(disposition).toContain("attachment;");
      expect(decodeURIComponent(encodedName)).toBe(fileName);
    });
  });

  it("rejects encoded and decoded paths outside the project attachment root", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-attachment-containment",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const attachmentRoot = join(harness.deps.config.dataDir, "attachments");
      await mkdir(attachmentRoot, { recursive: true });
      await writeFile(join(attachmentRoot, "outside.txt"), "outside");

      for (const path of [
        "../outside.txt",
        "..%2Foutside.txt",
        "%2e%2e%2foutside.txt",
      ]) {
        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/attachments/preview?path=${path}`,
        );
        expect(response.status, path).toBe(400);
        await expect(readJson(response)).resolves.toEqual({
          code: "invalid_request",
          message: "Attachment path escapes project directory",
        });
      }
    });
  });

  it("rejects HEIC/HEIF image uploads instead of storing an image nothing can render", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-attachment-heic",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const heicBytes = new Uint8Array([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
        0x00, 0x00, 0x00, 0x00, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63,
      ]);
      const rejected = {
        code: "invalid_request",
        message:
          "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.",
      };

      const heic = await upload(
        harness.app,
        project.id,
        new File([heicBytes], "IMG_0001.heic", { type: "image/heic" }),
      );
      expect(heic.status).toBe(400);
      await expect(readJson(heic)).resolves.toEqual(rejected);

      const heif = await upload(
        harness.app,
        project.id,
        new File([heicBytes], "IMG_0002.HEIF", {
          type: "Image/HEIF; charset=binary",
        }),
      );
      expect(heif.status).toBe(400);
      await expect(readJson(heif)).resolves.toEqual(rejected);

      const asFile = await upload(
        harness.app,
        project.id,
        new File([heicBytes], "IMG_0003.heic", {
          type: "application/octet-stream",
        }),
      );
      expect(asFile.status).toBe(201);
      expect(
        uploadedPromptAttachmentSchema.parse(await readJson(asFile)),
      ).toMatchObject({ type: "localFile", name: "IMG_0003.heic" });

      const stillAcceptsOtherImages = await upload(
        harness.app,
        project.id,
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "ok.png", {
          type: "image/png",
        }),
      );
      expect(stillAcceptsOtherImages.status).toBe(201);
    });
  });

  it("keeps attachment read tokens scoped to their owning project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-attachment-scope",
      });
      const { project: owner } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const { project: other } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const response = await upload(
        harness.app,
        owner.id,
        new File(["secret"], "owner.txt", { type: "text/plain" }),
      );
      const uploaded = uploadedPromptAttachmentSchema.parse(
        await readJson(response),
      );

      const foreignRead = await harness.app.request(
        `/api/v1/projects/${other.id}/attachments/content?path=${encodeURIComponent(uploaded.path)}`,
      );
      expect(foreignRead.status).toBe(404);
      await expect(readJson(foreignRead)).resolves.toEqual({
        code: "invalid_request",
        message: "Attachment not found",
      });
    });
  });
});
