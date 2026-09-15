import { describe, expect, it } from "vitest";
import { toUserAttachmentImageSrc } from "./user-attachment-images";

describe("user attachment image sources", () => {
  it("resolves a durable project image through project attachment content", () => {
    expect(
      toUserAttachmentImageSrc(
        "reference-uploaded.png",
        "proj_test",
        "thr_test",
      ),
    ).toBe(
      "/api/v1/projects/proj_test/attachments/content?path=reference-uploaded.png",
    );
  });

  it.each([
    "https://example.test/reference.png",
    "data:image/png;base64,aW1hZ2U=",
    "blob:https://example.test/image-id",
  ])("preserves URL-like image source %s", (source) => {
    expect(toUserAttachmentImageSrc(source, "proj_test")).toBe(source);
    expect(toUserAttachmentImageSrc(source, "proj_test", "thr_test")).toBe(
      source,
    );
  });

  it("preserves the non-project absolute-file fallback", () => {
    expect(toUserAttachmentImageSrc("/tmp/reference.png")).toBe(
      "file:///tmp/reference.png",
    );
    expect(toUserAttachmentImageSrc("C:\\tmp\\reference.png")).toBe(
      "file:///C:/tmp/reference.png",
    );
  });

  it("keeps historical runtime-local image paths out of project attachment URLs", () => {
    expect(toUserAttachmentImageSrc("/tmp/reference.png", "proj_test")).toBe(
      "file:///tmp/reference.png",
    );
    expect(
      toUserAttachmentImageSrc("C:\\tmp\\reference.png", "proj_test"),
    ).toBe("file:///C:/tmp/reference.png");
    expect(
      toUserAttachmentImageSrc("file:///tmp/reference.png", "proj_test"),
    ).toBe("file:///tmp/reference.png");
  });

  it("serves historical host image paths through their thread", () => {
    expect(
      toUserAttachmentImageSrc("/tmp/reference.png", "proj_test", "thr_test"),
    ).toBe(
      "/api/v1/threads/thr_test/host-files/content?path=%2Ftmp%2Freference.png",
    );
    expect(
      toUserAttachmentImageSrc(
        "file:///tmp/reference.png",
        "proj_test",
        "thr_test",
      ),
    ).toBe(
      "/api/v1/threads/thr_test/host-files/content?path=%2Ftmp%2Freference.png",
    );
  });
});
