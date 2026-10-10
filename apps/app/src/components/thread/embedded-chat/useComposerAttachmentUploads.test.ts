import { describe, expect, it, vi } from "vitest";
import type { PromptDraftAttachment } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import {
  IDLE_DRAFT_ATTACHMENT_OPERATION,
  beginDraftAttachmentOperation,
  finishDraftAttachmentOperation,
  setDraftAttachmentOperationError,
  uploadDraftAttachments,
  viewDraftAttachmentOperation,
} from "./useComposerAttachmentUploads";

const uploaded: PromptDraftAttachment = {
  type: "localFile",
  path: "uploads/old.txt",
  name: "old.txt",
  sizeBytes: 3,
};

function pending(name: string) {
  return { id: name, file: new File([name], name) };
}

describe("draft attachment operation", () => {
  it("keeps attaching until every concurrent batch for the target settles", () => {
    const first = beginDraftAttachmentOperation(
      IDLE_DRAFT_ATTACHMENT_OPERATION,
      "bottom",
    );
    const both = beginDraftAttachmentOperation(first, "bottom");
    const oneLeft = finishDraftAttachmentOperation(both, "bottom", null, "bottom");

    expect(
      viewDraftAttachmentOperation(oneLeft, "bottom").isAttachingFiles,
    ).toBe(true);
    expect(
      viewDraftAttachmentOperation(
        finishDraftAttachmentOperation(oneLeft, "bottom", null, "bottom"),
        "bottom",
      ).isAttachingFiles,
    ).toBe(false);
  });

  it("hides another target's pending upload and error", () => {
    const failed = finishDraftAttachmentOperation(
      beginDraftAttachmentOperation(
        beginDraftAttachmentOperation(
          IDLE_DRAFT_ATTACHMENT_OPERATION,
          "edit-1",
        ),
        "edit-1",
      ),
      "edit-1",
      "Failed to attach: old.txt",
      "edit-1",
    );

    expect(viewDraftAttachmentOperation(failed, "edit-1")).toEqual({
      attachmentError: "Failed to attach: old.txt",
      isAttachingFiles: true,
    });
    expect(viewDraftAttachmentOperation(failed, "edit-2")).toEqual({
      attachmentError: null,
      isAttachingFiles: false,
    });
    expect(viewDraftAttachmentOperation(failed, null)).toEqual({
      attachmentError: null,
      isAttachingFiles: false,
    });
  });

  it("ignores a batch that settles after the target moved on", () => {
    const moved = beginDraftAttachmentOperation(
      beginDraftAttachmentOperation(IDLE_DRAFT_ATTACHMENT_OPERATION, "edit-1"),
      "edit-2",
    );

    expect(
      finishDraftAttachmentOperation(
        moved,
        "edit-1",
        "Failed to attach: old.txt",
        "edit-2",
      ),
    ).toBe(moved);
  });

  it("drops the failure of a batch whose target was dismissed before it settled", () => {
    const busy = beginDraftAttachmentOperation(
      IDLE_DRAFT_ATTACHMENT_OPERATION,
      "edit-1",
    );

    expect(
      viewDraftAttachmentOperation(
        finishDraftAttachmentOperation(
          busy,
          "edit-1",
          "Failed to attach: old.txt",
          null,
        ),
        "edit-1",
      ),
    ).toEqual({ attachmentError: null, isAttachingFiles: false });
  });

  it("starts a new target's error without inheriting the old target's pending count", () => {
    const busy = beginDraftAttachmentOperation(
      IDLE_DRAFT_ATTACHMENT_OPERATION,
      "edit-1",
    );

    expect(
      viewDraftAttachmentOperation(
        setDraftAttachmentOperationError(busy, "edit-2", "Too large"),
        "edit-2",
      ),
    ).toEqual({ attachmentError: "Too large", isAttachingFiles: false });
  });
});

describe("uploadDraftAttachments", () => {
  it("does not add a late upload to a target that replaced the original", async () => {
    const addFirst = vi.fn();
    const addSecond = vi.fn();
    let currentTarget = { key: "edit-1", addAttachment: addFirst };
    const settled: string[] = [];

    const result = await uploadDraftAttachments({
      uploads: [pending("old.txt")],
      targetKey: "edit-1",
      upload: async () => {
        currentTarget = { key: "edit-2", addAttachment: addSecond };
        return uploaded;
      },
      getCurrentTarget: () => currentTarget,
      onUploadSettled: (upload) => settled.push(upload.id),
    });

    expect(result).toEqual({ added: [], failureMessage: null });
    expect(addFirst).not.toHaveBeenCalled();
    expect(addSecond).not.toHaveBeenCalled();
    expect(settled).toEqual(["old.txt"]);
  });

  it("adds uploads to the target that is still current", async () => {
    const addAttachment = vi.fn();

    const result = await uploadDraftAttachments({
      uploads: [pending("old.txt")],
      targetKey: "bottom",
      upload: async () => uploaded,
      getCurrentTarget: () => ({ key: "bottom", addAttachment }),
      onUploadSettled: vi.fn(),
    });

    expect(result.added).toEqual([uploaded]);
    expect(addAttachment).toHaveBeenCalledWith(uploaded);
  });

  it("shows the server's reason when it refuses an upload", async () => {
    const message =
      "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.";
    const upload = vi
      .fn<(file: File) => Promise<PromptDraftAttachment>>()
      .mockRejectedValueOnce(
        new BbHttpError({
          body: { code: "invalid_request", message },
          code: "invalid_request",
          message,
          status: 400,
        }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await uploadDraftAttachments({
      uploads: [pending("IMG_0001.heic"), pending("shot.png")],
      targetKey: "bottom",
      upload,
      getCurrentTarget: () => ({ key: "bottom", addAttachment: vi.fn() }),
      onUploadSettled: vi.fn(),
    });

    expect(result.failureMessage).toBe(
      `Failed to attach IMG_0001.heic, shot.png: ${message}`,
    );
  });

  it("names failed files without a reason when the failure is not a server refusal", async () => {
    const result = await uploadDraftAttachments({
      uploads: [pending("inline.txt")],
      targetKey: "bottom",
      upload: async () => {
        throw new Error("inline failed");
      },
      getCurrentTarget: () => ({ key: "bottom", addAttachment: vi.fn() }),
      onUploadSettled: vi.fn(),
    });

    expect(result.failureMessage).toBe("Failed to attach: inline.txt");
  });

});
