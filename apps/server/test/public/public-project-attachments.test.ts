import { describe, expect, it } from "vitest";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/node";
import { uploadedPromptAttachmentSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { readFile } from "node:fs/promises";

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
          type: "localFile" as const,
        },
        {
          bytes: new Uint8Array([0, 255, 1, 128, 13, 10]),
          filename: "payload.bin",
          mimeType: "application/x-bb-binary",
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
          sourceProjectId: project.id,
          name: fixture.filename,
          mimeType: fixture.mimeType,
          sizeBytes: fixture.bytes.byteLength,
        });

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
        const partial = await harness.app.request(contentUrl, {
          headers: { range: "bytes=0-1" },
        });
        expect(partial.status).toBe(206);
        expect(new Uint8Array(await partial.arrayBuffer())).toEqual(
          fixture.bytes.subarray(0, 2),
        );
        const etag = content.headers.get("etag");
        expect(etag).toMatch(/^"[^"]+"$/u);
        const revalidated = await harness.app.request(contentUrl, {
          headers: { "if-none-match": etag ?? "" },
        });
        expect(revalidated.status).toBe(304);
        expect(revalidated.headers.get("etag")).toBe(etag);
        expect((await revalidated.arrayBuffer()).byteLength).toBe(0);
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
      const retinaScreenshot = await upload(
        harness.app,
        project.id,
        new File([new Uint8Array(30 * 1024 * 1024)], "screenshot.png", {
          type: "image/png",
        }),
      );
      expect(retinaScreenshot.status).toBe(201);

      const oversized = await upload(
        harness.app,
        project.id,
        new File([new Uint8Array(36 * 1024 * 1024)], "huge.png", {
          type: "image/png",
        }),
      );
      expect(oversized.status).toBe(400);
      await expect(readJson(oversized)).resolves.toEqual({
        code: "invalid_request",
        message: "huge.png is 36MB, over the 35MB attachment limit",
      });

      const oversizedFile = await upload(
        harness.app,
        project.id,
        new File(
          [new Uint8Array(35 * 1024 * 1024 + 512 * 1024)],
          "huge-archive.bin",
          {
            type: "application/octet-stream",
          },
        ),
      );
      expect(oversizedFile.status).toBe(400);
      await expect(readJson(oversizedFile)).resolves.toEqual({
        code: "invalid_request",
        message: "huge-archive.bin is 35.5MB, over the 35MB attachment limit",
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

  it("rejects corrupt HEIC/HEIF images but preserves explicit file uploads", async () => {
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
        message: "Could not convert HEIC/HEIF image to PNG",
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

  const raw = "application/octet-stream";
  it.each([
    ["photo.heic", "image/heic", undefined, "image/png"],
    ["photo.HEIF", "Image/HEIF; charset=binary", undefined, "image/png"],
    ["photo.heic", "image/heic-sequence", undefined, "image/png"],
    ["photo.heif", "image/heif-sequence", undefined, "image/png"],
    ["photo", "image/heic", undefined, "image/png"],
    ["photo.HEIC", "", undefined, "image/png"],
    ["photo.heif", "", undefined, "image/png"],
    ["photo.heic", raw, undefined, raw],
    ["photo.heic", "image/heic", raw, raw],
    ["notes.txt", "", undefined, raw],
  ])(
    "uploads %s (%s, override %s) as %s",
    async (name, mimeType, override, storedMimeType) => {
      const bytes = await readFile(
        new URL("../fixtures/images/quadrants.heic", import.meta.url),
      );
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, { id: "host-heic-sdk" });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const sdk = createBbSdk({
          transport: createHttpTransport({
            baseUrl: "http://localhost",
            runtime: "browser",
            fetch: async (input, init) =>
              harness.app.request(new Request(input, init)),
          }),
        });
        const uploaded = await sdk.projects.attachments.upload({
          projectId: project.id,
          clientFile: new File([bytes], name, { type: mimeType }),
          ...(override === undefined ? {} : { mimeType: override }),
        });
        const converted = storedMimeType === "image/png";
        expect(uploaded).toMatchObject({
          type: converted ? "localImage" : "localFile",
          sourceProjectId: project.id,
          name: converted ? "photo.png" : name,
          mimeType: storedMimeType,
        });
        const content = await sdk.projects.attachments.read({
          projectId: project.id,
          path: uploaded.path,
        });
        expect(uploaded.sizeBytes).toBe(content.bytes.byteLength);
        const stored = Buffer.from(content.bytes);
        if (converted) {
          expect(content.mimeType).toBe("image/png");
          expect(uploaded.path).toMatch(/\.png$/u);
          expect(stored.subarray(0, 8)).toEqual(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          );
          expect([stored.readUInt32BE(16), stored.readUInt32BE(20)]).toEqual([
            64, 32,
          ]);
        } else {
          expect(stored).toEqual(bytes);
        }
      });
    },
  );

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
