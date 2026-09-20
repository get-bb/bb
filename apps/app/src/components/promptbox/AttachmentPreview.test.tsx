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

  it("shows a local preview before upload completion and releases it on settlement", () => {
    const file = new File(["image"], "pending.png", { type: "image/png" });
    const props = {
      attachments: [],
      expandedImageIndex: null,
      onExpandedImageIndexChange: vi.fn(),
    };
    const { getByRole, queryByRole, rerender } = render(
      <AttachmentPreview {...props} pendingUploads={[{ id: "upload-1", file }]} />,
    );
    const status = getByRole("status", { name: "Uploading pending.png" });
    expect(status.querySelector("img")?.getAttribute("src")).toBe("blob:local-1");
    expect(status.textContent).toContain("Uploading");
    expect(queryByRole("button", { name: "Remove pending.png" })).toBeNull();

    rerender(<AttachmentPreview {...props} />);
    expect(queryByRole("status")).toBeNull();
    expect(revoked).toEqual(["blob:local-1"]);
  });

  it("keeps upload feedback in the collapsed composer and releases previews on unmount", () => {
    const props = {
      attachments: [],
      pendingUploads: [{ id: "upload-1", file: new File(["image"], "pending.png", { type: "image/png" }) }],
      expandedImageIndex: null,
      onExpandedImageIndexChange: vi.fn(),
    };
    const { getByRole, rerender, unmount } = render(<AttachmentPreview {...props} compact />);
    const uploading = getByRole("status", { name: "1 uploading" });
    expect(uploading.textContent).toBe("1");
    expect(uploading.querySelector('[data-icon="Paperclip"]')).not.toBeNull();
    const attachments = [{ type: "localImage" as const, path: "done.png", name: "done.png", sizeBytes: 5 }];
    rerender(<AttachmentPreview {...props} attachments={attachments} compact />);
    const mixed = getByRole("status", { name: "1 attachment, 1 uploading" });
    expect(mixed.textContent).toBe("2");
    rerender(<AttachmentPreview {...props} attachments={attachments} pendingUploads={[]} compact />);
    const settled = getByRole("img", { name: "1 attachment" });
    expect(settled.querySelector('[data-icon="Loading"]')).toBeNull();
    rerender(<AttachmentPreview {...props} />);
    expect(getByRole("status", { name: "Uploading pending.png" }).querySelector("img")).not.toBeNull();
    unmount();
    expect(revoked).toEqual(["blob:local-1"]);
  });

  it("renders a just-picked image from its local object URL and revokes it on remove", () => {
    registerLocalAttachmentPreview(
      "photo-1-abc.png",
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    );
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

  it("separates compact touch targets from attachment remove visuals", () => {
    const { getByRole } = render(
      <AttachmentPreview
        attachments={[
          {
            type: "localImage",
            path: "screenshot.png",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
          {
            type: "localFile",
            path: "diff.patch",
            name: "diff.patch",
            mimeType: "text/plain",
            sizeBytes: 3,
          },
        ]}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={() => {}}
      />,
    );

    const imageRemoveButton = getByRole("button", {
      name: "Remove screenshot.png",
    });
    expect(
      imageRemoveButton.classList.contains("max-md:pointer-coarse:size-7"),
    ).toBe(true);
    expect(imageRemoveButton.classList.contains("bg-black/55")).toBe(false);
    expect(
      imageRemoveButton.firstElementChild?.classList.contains("size-4"),
    ).toBe(true);
    expect(
      imageRemoveButton.firstElementChild?.classList.contains("bg-black/55"),
    ).toBe(true);

    const fileRemoveButton = getByRole("button", {
      name: "Remove diff.patch",
    });
    expect(
      fileRemoveButton.classList.contains("max-md:pointer-coarse:size-7"),
    ).toBe(true);
    expect(fileRemoveButton.parentElement?.classList.contains("size-4")).toBe(
      true,
    );
    expect(
      fileRemoveButton.firstElementChild?.classList.contains("size-4"),
    ).toBe(true);
  });
});
