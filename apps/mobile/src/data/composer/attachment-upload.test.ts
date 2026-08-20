import { describe, expect, it } from "vitest";
import {
  buildAttachmentUploadRequest,
  fallbackAttachmentName,
  parseUploadedAttachment,
  validateAttachmentSize,
} from "./attachment-upload";

describe("attachment upload", () => {
  it("applies the server's 10 MiB image / 25 MiB file limits client-side", () => {
    const mib = 1024 * 1024;
    expect(
      validateAttachmentSize({
        name: "a.png",
        mimeType: "image/png",
        sizeBytes: 10 * mib,
      }),
    ).toBeNull();
    expect(
      validateAttachmentSize({
        name: "a.png",
        mimeType: "image/png",
        sizeBytes: 10 * mib + 1,
      }),
    ).toMatch(/10 MB image limit/);
    expect(
      validateAttachmentSize({
        name: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 20 * mib,
      }),
    ).toBeNull();
    expect(
      validateAttachmentSize({
        name: "a.pdf",
        mimeType: "",
        sizeBytes: 25 * mib + 1,
      }),
    ).toMatch(/25 MB file limit/);
    expect(
      validateAttachmentSize({ name: "?", mimeType: "", sizeBytes: 0 }),
    ).toBeNull();
  });

  it("posts exactly one `file` part with the RN file shape", () => {
    expect(
      buildAttachmentUploadRequest({
        serverUrl: "http://127.0.0.1:41999/",
        projectId: "proj 1",
        file: {
          uri: "file:///tmp/x.png",
          name: "x.png",
          mimeType: "image/png",
          sizeBytes: 3,
        },
      }),
    ).toEqual({
      url: "http://127.0.0.1:41999/api/v1/projects/proj%201/attachments",
      fields: [
        [
          "file",
          { uri: "file:///tmp/x.png", name: "x.png", type: "image/png" },
        ],
      ],
    });
    expect(
      buildAttachmentUploadRequest({
        serverUrl: "http://h",
        projectId: "p",
        file: { uri: "file:///doc", name: "doc", mimeType: "", sizeBytes: 0 },
      }).fields[0]?.[1],
    ).toMatchObject({ type: "application/octet-stream" });
  });

  it("validates the upload response and names nameless picks", () => {
    expect(
      parseUploadedAttachment({
        type: "localImage",
        path: "abc.png",
        name: "x.png",
        mimeType: "image/png",
        sizeBytes: 3,
      }),
    ).toEqual({
      type: "localImage",
      path: "abc.png",
      name: "x.png",
      mimeType: "image/png",
      sizeBytes: 3,
    });
    expect(() => parseUploadedAttachment({ type: "nope" })).toThrow();
    expect(fallbackAttachmentName("file:///tmp/IMG_1.HEIC", "image/heic")).toBe(
      "IMG_1.HEIC",
    );
    expect(fallbackAttachmentName("ph://asset-id", "image/jpeg", 5)).toBe(
      "photo-5.jpeg",
    );
  });
});
