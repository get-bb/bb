import { describe, expect, it, vi } from "vitest";
import {
  cleanupStalePromptAttachmentCopies,
  hasPromptDraftAttachmentsOutsideProject,
  reconcileTransferredPromptAttachments,
  transferPromptAttachments,
} from "./prompt-attachment-transfer";

const SOURCE_IMAGE = {
  type: "localImage" as const,
  path: "screenshot-source.png",
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  sourceProjectId: "proj_source",
};

describe("transferPromptAttachments", () => {
  it("copies an attachment from its source project and marks the copy as destination-owned", async () => {
    const readAttachment = vi
      .fn()
      .mockResolvedValue(new Blob(["png!"], { type: "image/png" }));
    const uploadAttachment = vi.fn().mockResolvedValue({
      type: "localImage",
      path: "screenshot-destination.png",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 4,
    });

    const result = await transferPromptAttachments({
      attachments: [SOURCE_IMAGE],
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    expect(readAttachment).toHaveBeenCalledWith({
      projectId: "proj_source",
      path: "screenshot-source.png",
    });
    expect(uploadAttachment).toHaveBeenCalledWith({
      projectId: "proj_destination",
      file: expect.objectContaining({
        name: "screenshot.png",
        type: "image/png",
      }),
    });
    const uploadRequest = uploadAttachment.mock.calls[0]?.[0];
    await expect(uploadRequest?.file.text()).resolves.toBe("png!");
    expect(result).toEqual({
      failedAttachments: [],
      transferredAttachments: [
        {
          sourceProjectId: "proj_source",
          sourcePath: "screenshot-source.png",
          targetAttachment: {
            type: "localImage",
            path: "screenshot-destination.png",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 4,
            sourceProjectId: "proj_destination",
          },
        },
      ],
    });
  });

  it("does not re-upload attachments that already belong to the destination project", async () => {
    const readAttachment = vi.fn();
    const uploadAttachment = vi.fn();

    const result = await transferPromptAttachments({
      attachments: [
        {
          ...SOURCE_IMAGE,
          sourceProjectId: "proj_destination",
        },
      ],
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    expect(result).toEqual({
      failedAttachments: [],
      transferredAttachments: [],
    });
    expect(readAttachment).not.toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("collects an error before reading an attachment whose source project is unknown", async () => {
    const readAttachment = vi.fn();
    const uploadAttachment = vi.fn();

    const result = await transferPromptAttachments({
      attachments: [{ ...SOURCE_IMAGE, sourceProjectId: undefined }],
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    expect(readAttachment).not.toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(result.transferredAttachments).toEqual([]);
    expect(result.failedAttachments).toEqual([
      expect.objectContaining({
        attachment: { ...SOURCE_IMAGE, sourceProjectId: undefined },
        error: expect.objectContaining({
          message: "Attachment source project is missing",
        }),
      }),
    ]);
  });

  it("collects a source-read failure without attempting the destination upload", async () => {
    const readAttachment = vi.fn().mockRejectedValue(new Error("Not found"));
    const uploadAttachment = vi.fn();

    const result = await transferPromptAttachments({
      attachments: [SOURCE_IMAGE],
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(result.transferredAttachments).toEqual([]);
    expect(result.failedAttachments[0]?.error.message).toBe("Not found");
  });

  it("collects a destination-upload failure after reading the source attachment", async () => {
    const readAttachment = vi
      .fn()
      .mockResolvedValue(new Blob(["png!"], { type: "image/png" }));
    const uploadAttachment = vi
      .fn()
      .mockRejectedValue(new Error("Destination full"));

    const result = await transferPromptAttachments({
      attachments: [SOURCE_IMAGE],
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    expect(readAttachment).toHaveBeenCalledOnce();
    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(result.transferredAttachments).toEqual([]);
    expect(result.failedAttachments[0]?.error.message).toBe("Destination full");
  });

  it("keeps successful copies when another attachment fails, then retries only the failure", async () => {
    const failedAttachment = {
      ...SOURCE_IMAGE,
      path: "failed-source.png",
      name: "failed.png",
    };
    const readAttachment = vi
      .fn()
      .mockResolvedValue(new Blob(["png!"], { type: "image/png" }));
    const uploadAttachment = vi
      .fn()
      .mockResolvedValueOnce({
        ...SOURCE_IMAGE,
        path: "successful-destination.png",
        sourceProjectId: undefined,
      })
      .mockRejectedValueOnce(new Error("Temporary destination failure"))
      .mockResolvedValueOnce({
        ...failedAttachment,
        path: "retried-destination.png",
        sourceProjectId: undefined,
      });

    const firstResult = await transferPromptAttachments({
      attachments: [SOURCE_IMAGE, failedAttachment],
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    expect(firstResult.transferredAttachments).toHaveLength(1);
    expect(firstResult.failedAttachments).toHaveLength(1);
    expect(firstResult.failedAttachments[0]?.attachment).toEqual(
      failedAttachment,
    );

    const retryResult = await transferPromptAttachments({
      attachments: firstResult.failedAttachments.map(
        (failure) => failure.attachment,
      ),
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    expect(retryResult).toEqual({
      failedAttachments: [],
      transferredAttachments: [
        expect.objectContaining({ sourcePath: "failed-source.png" }),
      ],
    });
    expect(readAttachment.mock.calls.map((call) => call[0].path)).toEqual([
      "screenshot-source.png",
      "failed-source.png",
      "failed-source.png",
    ]);
  });

  it("processes attachment copies one at a time", async () => {
    const secondImage = { ...SOURCE_IMAGE, path: "second-source.png" };
    let resolveFirstUpload: (() => void) | undefined;
    const firstUpload = new Promise<void>((resolve) => {
      resolveFirstUpload = resolve;
    });
    const readAttachment = vi
      .fn()
      .mockResolvedValue(new Blob(["png!"], { type: "image/png" }));
    const uploadAttachment = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstUpload;
        return { ...SOURCE_IMAGE, path: "first-destination.png" };
      })
      .mockResolvedValueOnce({
        ...secondImage,
        path: "second-destination.png",
      });

    const transfer = transferPromptAttachments({
      attachments: [SOURCE_IMAGE, secondImage],
      targetProjectId: "proj_destination",
      readAttachment,
      uploadAttachment,
    });

    await vi.waitFor(() => expect(uploadAttachment).toHaveBeenCalledOnce());
    expect(readAttachment).toHaveBeenCalledOnce();
    resolveFirstUpload?.();
    await transfer;
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(readAttachment).toHaveBeenCalledTimes(2);
  });
});

describe("cleanupStalePromptAttachmentCopies", () => {
  const transferredAttachment = {
    sourceProjectId: "proj_source",
    sourcePath: "screenshot-source.png",
    targetAttachment: {
      ...SOURCE_IMAGE,
      path: "screenshot-destination.png",
      sourceProjectId: "proj_destination",
    },
  };

  it("deletes a stale target copy when the project changes during transfer", async () => {
    const deleteAttachment = vi.fn().mockResolvedValue(undefined);

    const result = await cleanupStalePromptAttachmentCopies({
      currentAttachments: [SOURCE_IMAGE],
      currentProjectId: "proj_later_selection",
      deleteAttachment,
      targetProjectId: "proj_destination",
      transferredAttachments: [transferredAttachment],
    });

    expect(deleteAttachment).toHaveBeenCalledWith({
      path: "screenshot-destination.png",
      projectId: "proj_destination",
    });
    expect(result).toEqual({
      deletedAttachments: [transferredAttachment],
      failedAttachments: [],
    });
  });

  it("does not delete a copy referenced by the live draft or current target", async () => {
    const deleteAttachment = vi.fn();

    await cleanupStalePromptAttachmentCopies({
      currentAttachments: [transferredAttachment.targetAttachment],
      currentProjectId: "proj_later_selection",
      deleteAttachment,
      targetProjectId: "proj_destination",
      transferredAttachments: [transferredAttachment],
    });
    await cleanupStalePromptAttachmentCopies({
      currentAttachments: [],
      currentProjectId: "proj_destination",
      deleteAttachment,
      targetProjectId: "proj_destination",
      transferredAttachments: [transferredAttachment],
    });

    expect(deleteAttachment).not.toHaveBeenCalled();
  });

  it("cleans up stale target copies sequentially", async () => {
    let resolveFirstDelete: (() => void) | undefined;
    const firstDelete = new Promise<void>((resolve) => {
      resolveFirstDelete = resolve;
    });
    const secondTransferredAttachment = {
      ...transferredAttachment,
      targetAttachment: {
        ...transferredAttachment.targetAttachment,
        path: "second-destination.png",
      },
    };
    const deleteAttachment = vi
      .fn()
      .mockImplementationOnce(async () => firstDelete)
      .mockResolvedValueOnce(undefined);

    const cleanup = cleanupStalePromptAttachmentCopies({
      currentAttachments: [],
      currentProjectId: "proj_later_selection",
      deleteAttachment,
      targetProjectId: "proj_destination",
      transferredAttachments: [
        transferredAttachment,
        secondTransferredAttachment,
      ],
    });

    await vi.waitFor(() => expect(deleteAttachment).toHaveBeenCalledOnce());
    resolveFirstDelete?.();
    await cleanup;
    expect(deleteAttachment).toHaveBeenCalledTimes(2);
  });
});

describe("hasPromptDraftAttachmentsOutsideProject", () => {
  it("only blocks submission for attachments that are still owned by another project", () => {
    expect(
      hasPromptDraftAttachmentsOutsideProject({
        attachments: [SOURCE_IMAGE],
        projectId: "proj_destination",
      }),
    ).toBe(true);
    expect(
      hasPromptDraftAttachmentsOutsideProject({
        attachments: [SOURCE_IMAGE],
        projectId: "proj_source",
      }),
    ).toBe(false);
    expect(
      hasPromptDraftAttachmentsOutsideProject({
        attachments: [{ ...SOURCE_IMAGE, sourceProjectId: undefined }],
        projectId: "proj_destination",
      }),
    ).toBe(false);
  });
});

describe("reconcileTransferredPromptAttachments", () => {
  it("only replaces source attachments that still exist in the live draft", () => {
    const currentAttachments = [
      SOURCE_IMAGE,
      {
        type: "localFile" as const,
        path: "new-note.md",
        name: "new-note.md",
        mimeType: "text/markdown",
        sizeBytes: 8,
        sourceProjectId: "proj_destination",
      },
    ];

    expect(
      reconcileTransferredPromptAttachments({
        currentProjectId: "proj_destination",
        currentAttachments,
        targetProjectId: "proj_destination",
        transferredAttachments: [
          {
            sourceProjectId: "proj_source",
            sourcePath: "screenshot-source.png",
            targetAttachment: {
              ...SOURCE_IMAGE,
              path: "screenshot-destination.png",
              sourceProjectId: "proj_destination",
            },
          },
        ],
      }),
    ).toEqual([
      {
        ...SOURCE_IMAGE,
        path: "screenshot-destination.png",
        sourceProjectId: "proj_destination",
      },
      currentAttachments[1],
    ]);
  });

  it("does not resurrect an attachment the user removed while the copy was pending", () => {
    expect(
      reconcileTransferredPromptAttachments({
        currentProjectId: "proj_destination",
        currentAttachments: [],
        targetProjectId: "proj_destination",
        transferredAttachments: [
          {
            sourceProjectId: "proj_source",
            sourcePath: "screenshot-source.png",
            targetAttachment: {
              ...SOURCE_IMAGE,
              path: "screenshot-destination.png",
              sourceProjectId: "proj_destination",
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("does not replace a same-path attachment that belongs to another source project", () => {
    const destinationAttachment = {
      ...SOURCE_IMAGE,
      sourceProjectId: "proj_new_source",
    };

    expect(
      reconcileTransferredPromptAttachments({
        currentProjectId: "proj_destination",
        currentAttachments: [destinationAttachment],
        targetProjectId: "proj_destination",
        transferredAttachments: [
          {
            sourceProjectId: "proj_source",
            sourcePath: "screenshot-source.png",
            targetAttachment: {
              ...SOURCE_IMAGE,
              path: "screenshot-destination.png",
              sourceProjectId: "proj_destination",
            },
          },
        ],
      }),
    ).toEqual([destinationAttachment]);
  });

  it("does not apply a completed transfer after the user selects another project", () => {
    expect(
      reconcileTransferredPromptAttachments({
        currentProjectId: "proj_later_selection",
        currentAttachments: [SOURCE_IMAGE],
        targetProjectId: "proj_destination",
        transferredAttachments: [
          {
            sourceProjectId: "proj_source",
            sourcePath: "screenshot-source.png",
            targetAttachment: {
              ...SOURCE_IMAGE,
              path: "screenshot-destination.png",
              sourceProjectId: "proj_destination",
            },
          },
        ],
      }),
    ).toBeNull();
  });
});
