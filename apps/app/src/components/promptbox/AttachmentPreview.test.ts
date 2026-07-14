import { describe, expect, it } from "vitest";
import { getAttachmentPreviewProjectId } from "./AttachmentPreview";

describe("getAttachmentPreviewProjectId", () => {
  it("keeps a transferred attachment preview on its source project until the copy completes", () => {
    expect(
      getAttachmentPreviewProjectId(
        {
          type: "localImage",
          path: "screenshot.png",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 64,
          sourceProjectId: "proj_source",
        },
        "proj_destination",
      ),
    ).toBe("proj_source");
  });

  it("uses the currently selected project for attachments without transfer metadata", () => {
    expect(
      getAttachmentPreviewProjectId(
        {
          type: "localImage",
          path: "screenshot.png",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 64,
        },
        "proj_destination",
      ),
    ).toBe("proj_destination");
  });
});
