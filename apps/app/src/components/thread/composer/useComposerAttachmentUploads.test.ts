import { describe, expect, it, vi } from "vitest";
import type { PromptDraftAttachment } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import { PromptAttachmentSizeError } from "@/lib/prompt-attachment-size";
import {
  isUnreadableFolder,
  uploadDraftAttachments,
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

  it("shows why an attachment is too large to upload", async () => {
    const message = "VID_0001.mp4 is 110MB, over the 35MB attachment limit";
    const result = await uploadDraftAttachments({
      uploads: [pending("VID_0001.mp4")],
      target: { key: "bottom", addAttachment: vi.fn() },
      upload: async () => {
        throw new PromptAttachmentSizeError(message);
      },
      getCurrentTarget: () => ({ key: "bottom", addAttachment: vi.fn() }),
      onUploadSettled: vi.fn(),
    });

    expect(result.failureMessage).toBe(
      `Failed to attach VID_0001.mp4: ${message}`,
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

function folderLike(name: string): File {
  const file = new File([], name, { type: "" });
  Object.defineProperty(file, "slice", {
    value: () => ({
      arrayBuffer: () =>
        Promise.reject(new DOMException("unreadable", "NotReadableError")),
    }),
  });
  return file;
}

describe("folders (#7827)", () => {
  it("treats a typeless file that cannot be read as a folder", async () => {
    expect(await isUnreadableFolder(folderLike("tab-radar"))).toBe(true);
  });

  it("does not treat readable files as folders, typed or not", async () => {
    expect(
      await isUnreadableFolder(new File(["x"], "Makefile", { type: "" })),
    ).toBe(false);
    expect(
      await isUnreadableFolder(new File([], "empty.txt", { type: "" })),
    ).toBe(false);
    expect(
      await isUnreadableFolder(new File(["x"], "a.png", { type: "image/png" })),
    ).toBe(false);
  });

  it("skips a pasted folder without uploading it and says why", async () => {
    const upload = vi.fn(async () => uploaded);
    const settled: string[] = [];

    const result = await uploadDraftAttachments({
      uploads: [{ id: "tab-radar", file: folderLike("tab-radar") }],
      target: { key: "bottom", addAttachment: vi.fn() },
      upload,
      getCurrentTarget: () => null,
      onUploadSettled: (u) => settled.push(u.id),
    });

    expect(upload).not.toHaveBeenCalled();
    expect(settled).toEqual(["tab-radar"]);
    expect(result).toEqual({
      added: [],
      failureMessage:
        "Folders can't be attached: tab-radar. Paste its path as text instead.",
    });
  });

  it("still uploads the real files pasted together with a folder", async () => {
    const addAttachment = vi.fn();
    const upload = vi.fn(async () => uploaded);

    const result = await uploadDraftAttachments({
      uploads: [
        { id: "tab-radar", file: folderLike("tab-radar") },
        pending("old.txt"),
      ],
      target: { key: "bottom", addAttachment },
      upload,
      getCurrentTarget: () => ({ key: "bottom", addAttachment }),
      onUploadSettled: vi.fn(),
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.added).toEqual([uploaded]);
    expect(result.failureMessage).toBe(
      "Folders can't be attached: tab-radar. Paste its path as text instead.",
    );
  });
});
