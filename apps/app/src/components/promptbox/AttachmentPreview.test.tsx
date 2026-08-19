// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalAttachmentPreviews,
  registerLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";
import { AttachmentPreview } from "./AttachmentPreview";

describe("AttachmentPreview", () => {
  const revoked: string[] = [];
  let created = 0;

  beforeEach(() => {
    created = 0;
    revoked.length = 0;
    // jsdom's URL has no object-URL methods; install recording stand-ins.
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => `blob:local-${++created}`,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: (url: string) => {
        revoked.push(url);
      },
    });
  });

  afterEach(() => {
    cleanup();
    clearLocalAttachmentPreviews();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("renders a just-picked image from its local object URL and revokes it on remove", () => {
    registerLocalAttachmentPreview(
      "photo-1-abc.png",
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    );
    // A non-image never gets an object URL.
    registerLocalAttachmentPreview(
      "notes-1-abc.txt",
      new Blob(["hi"], { type: "text/plain" }),
    );
    const onRemoveAttachment = vi.fn();
    const { getAllByRole, getByLabelText } = render(
      <AttachmentPreview
        attachmentProjectId="proj_1"
        attachments={[
          {
            type: "localImage",
            path: "photo-1-abc.png",
            name: "photo.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
          {
            type: "localImage",
            path: "restored-2-def.png",
            name: "restored.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ]}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );
    const images = getAllByRole("img");
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "blob:local-1",
      "/api/v1/projects/proj_1/attachments/content?path=restored-2-def.png",
    ]);
    expect(
      images.every((image) => image.getAttribute("decoding") === "async"),
    ).toBe(true);

    fireEvent.click(getByLabelText("Remove photo.png"));
    expect(onRemoveAttachment).toHaveBeenCalledWith("photo-1-abc.png");
    expect(revoked).toEqual(["blob:local-1"]);
  });
});
