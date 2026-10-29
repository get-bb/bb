import { describe, expect, it, vi } from "vitest";
import type { PromptDraftAttachment } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import { uploadDraftAttachments } from "./useComposerAttachmentUploads";

const uploaded: PromptDraftAttachment = {
  type: "localFile",
  path: "uploads/old.txt",
  name: "old.txt",
  sizeBytes: 3,
};

function pending(name: string) {
  return { id: name, file: new File([name], name) };
}

describe("uploadDraftAttachments", () => {
  it("adds a late upload to the draft it started in after the composer moves to another draft", async () => {
    const addToThreadA = vi.fn();
    const addToThreadB = vi.fn();
    const threadA = { key: "thread-a", addAttachment: addToThreadA };
    let currentTarget = threadA;
    const settled: string[] = [];

    const result = await uploadDraftAttachments({
      uploads: [pending("old.txt")],
      target: threadA,
      upload: async () => {
        currentTarget = { key: "thread-b", addAttachment: addToThreadB };
        return uploaded;
      },
      getCurrentTarget: () => currentTarget,
      onUploadSettled: (upload) => settled.push(upload.id),
    });

    expect(result).toEqual({ added: [], failureMessage: null });
    expect(addToThreadA).toHaveBeenCalledWith(uploaded);
    expect(addToThreadB).not.toHaveBeenCalled();
    expect(settled).toEqual(["old.txt"]);
  });

  it("adds uploads to the target that is still current", async () => {
    const addAttachment = vi.fn();

    const result = await uploadDraftAttachments({
      uploads: [pending("old.txt")],
      target: { key: "bottom", addAttachment },
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
      target: { key: "bottom", addAttachment: vi.fn() },
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
      target: { key: "bottom", addAttachment: vi.fn() },
      upload: async () => {
        throw new Error("inline failed");
      },
      getCurrentTarget: () => ({ key: "bottom", addAttachment: vi.fn() }),
      onUploadSettled: vi.fn(),
    });

    expect(result.failureMessage).toBe("Failed to attach: inline.txt");
  });

});
