import { describe, expect, it, vi } from "vitest";
import type { PromptDraftAttachment } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import { PROMPT_ATTACHMENT_MAX_BYTES } from "@bb/domain";
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
  it.each(["video/mp4", "image/png"])(
    "rejects an oversized %s before upload and still attaches a valid file",
    async (mimeType) => {
      const file = new File(
        [new Uint8Array(PROMPT_ATTACHMENT_MAX_BYTES + 1)],
        "large-attachment",
        { type: mimeType },
      );
      const upload = vi.fn(async () => uploaded);
      const addAttachment = vi.fn();
      const settled = vi.fn();
      const target = { key: "bottom", addAttachment };

      const result = await uploadDraftAttachments({
        uploads: [{ id: "large", file }, pending("old.txt")],
        target,
        upload,
        getCurrentTarget: () => target,
        onUploadSettled: settled,
      });

      expect(upload).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledWith(
        expect.objectContaining({ name: "old.txt" }),
      );
      expect(result.added).toEqual([uploaded]);
      expect(addAttachment).toHaveBeenCalledTimes(1);
      expect(settled).toHaveBeenCalledTimes(2);
      expect(result.failureMessage).toContain("large-attachment is 35.1 MB");
      expect(result.failureMessage).toContain("35 MB attachment limit");
    },
  );

  it.each(["", "Payload Too Large", "413"])(
    "explains an upstream 413 with generic reason %j",
    async (message) => {
      const upload = vi.fn(async () => {
        throw new BbHttpError({ body: null, code: null, message, status: 413 });
      });
      const target = { key: "bottom", addAttachment: vi.fn() };
      const result = await uploadDraftAttachments({
        uploads: [pending("clip.mp4")],
        target,
        upload,
        getCurrentTarget: () => target,
        onUploadSettled: vi.fn(),
      });

      expect(result.added).toEqual([]);
      expect(target.addAttachment).not.toHaveBeenCalled();
      expect(result.failureMessage).toContain("Upload rejected as too large");
      expect(result.failureMessage).toContain("35 MB");
    },
  );

  it("allows a file at the attachment size limit", async () => {
    const file = new File(
      [new Uint8Array(PROMPT_ATTACHMENT_MAX_BYTES)],
      "boundary.mp4",
      { type: "video/mp4" },
    );
    const upload = vi.fn(async () => uploaded);
    const target = { key: "bottom", addAttachment: vi.fn() };
    const result = await uploadDraftAttachments({
      uploads: [{ id: "boundary", file }],
      target,
      upload,
      getCurrentTarget: () => target,
      onUploadSettled: vi.fn(),
    });

    expect(upload).toHaveBeenCalledWith(file);
    expect(result).toEqual({ added: [uploaded], failureMessage: null });
  });

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

  it.each([
    [
      400,
      "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.",
    ],
    [413, "attachment exceeds the upstream 20 MB limit"],
  ])(
    "shows the server's reason when it refuses an upload with %s",
    async (status, message) => {
      const upload = vi
        .fn<(file: File) => Promise<PromptDraftAttachment>>()
        .mockRejectedValueOnce(
          new BbHttpError({
            body: { code: "invalid_request", message },
            code: "invalid_request",
            message,
            status,
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
    },
  );

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
