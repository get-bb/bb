import { describe, expect, it, vi } from "vitest";
import {
  claimPromptAttachmentTransfers,
  cleanupStalePromptAttachmentCopies,
  hasPromptDraftAttachmentsOutsideProject,
  pruneCompletedPromptAttachmentTransfers,
  pruneFailedPromptAttachmentTransfers,
  reconcileTransferredPromptAttachments,
  recordCompletedPromptAttachmentTransfers,
  recordPromptAttachmentTransferFailures,
  releasePromptAttachmentTransfers,
  shouldSchedulePromptAttachmentTransfer,
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

describe("prompt attachment transfer claims", () => {
  it("deduplicates a destination transfer while the first claim is in flight", () => {
    const completedTransfers = new Map<string, Set<string>>();
    const failedTransfers = new Map<string, Set<string>>();
    const inFlightTransfers = new Map<string, Set<string>>();
    const claim = () =>
      claimPromptAttachmentTransfers({
        attachments: [SOURCE_IMAGE],
        completedTransfers,
        failedTransfers,
        inFlightTransfers,
        retryFailed: false,
        targetProjectId: "proj_destination",
      });

    expect(claim()).toEqual([SOURCE_IMAGE]);
    expect(claim()).toEqual([]);

    // Leaving and re-entering a project must not clear its active claim.
    claimPromptAttachmentTransfers({
      attachments: [SOURCE_IMAGE],
      completedTransfers,
      failedTransfers,
      inFlightTransfers,
      retryFailed: false,
      targetProjectId: "proj_later_selection",
    });
    expect(claim()).toEqual([]);

    releasePromptAttachmentTransfers({
      attachments: [SOURCE_IMAGE],
      inFlightTransfers,
      targetProjectId: "proj_destination",
    });
    expect(claim()).toEqual([SOURCE_IMAGE]);
  });

  it("retains failed claims for explicit retry instead of hiding recovery", () => {
    const completedTransfers = new Map<string, Set<string>>();
    const failedTransfers = new Map<string, Set<string>>();
    const inFlightTransfers = new Map<string, Set<string>>();
    const error = new Error("Destination full");

    const firstClaim = claimPromptAttachmentTransfers({
      attachments: [SOURCE_IMAGE],
      completedTransfers,
      failedTransfers,
      inFlightTransfers,
      retryFailed: false,
      targetProjectId: "proj_destination",
    });
    recordPromptAttachmentTransferFailures({
      attemptedAttachments: firstClaim,
      failedAttachments: [{ attachment: SOURCE_IMAGE, error }],
      failedTransfers,
      targetProjectId: "proj_destination",
    });
    releasePromptAttachmentTransfers({
      attachments: firstClaim,
      inFlightTransfers,
      targetProjectId: "proj_destination",
    });

    expect(
      claimPromptAttachmentTransfers({
        attachments: [SOURCE_IMAGE],
        completedTransfers,
        failedTransfers,
        inFlightTransfers,
        retryFailed: false,
        targetProjectId: "proj_destination",
      }),
    ).toEqual([]);
    expect(
      claimPromptAttachmentTransfers({
        attachments: [SOURCE_IMAGE],
        completedTransfers,
        failedTransfers,
        inFlightTransfers,
        retryFailed: true,
        targetProjectId: "proj_destination",
      }),
    ).toEqual([SOURCE_IMAGE]);
  });

  it("holds a completed claim until the live draft reflects its destination copy", () => {
    const completedTransfers = new Map<string, Set<string>>();
    const failedTransfers = new Map<string, Set<string>>();
    const inFlightTransfers = new Map<string, Set<string>>();
    const targetAttachment = {
      ...SOURCE_IMAGE,
      path: "screenshot-destination.png",
      sourceProjectId: "proj_destination",
    };

    recordCompletedPromptAttachmentTransfers({
      completedTransfers,
      targetProjectId: "proj_destination",
      transferredAttachments: [
        {
          sourcePath: SOURCE_IMAGE.path,
          sourceProjectId: SOURCE_IMAGE.sourceProjectId,
          targetAttachment,
        },
      ],
    });
    expect(
      claimPromptAttachmentTransfers({
        attachments: [SOURCE_IMAGE],
        completedTransfers,
        failedTransfers,
        inFlightTransfers,
        retryFailed: false,
        targetProjectId: "proj_destination",
      }),
    ).toEqual([]);

    pruneCompletedPromptAttachmentTransfers({
      attachments: [targetAttachment],
      completedTransfers,
      targetProjectId: "proj_destination",
    });
    expect(
      claimPromptAttachmentTransfers({
        attachments: [SOURCE_IMAGE],
        completedTransfers,
        failedTransfers,
        inFlightTransfers,
        retryFailed: false,
        targetProjectId: "proj_destination",
      }),
    ).toEqual([SOURCE_IMAGE]);
  });

  it("keeps an older failed claim visible when a newer claim succeeds", () => {
    const failedAttachment = {
      ...SOURCE_IMAGE,
      path: "failed-source.png",
    };
    const successfulAttachment = {
      ...SOURCE_IMAGE,
      path: "successful-source.png",
    };
    const failedTransfers = new Map<string, Set<string>>();

    recordPromptAttachmentTransferFailures({
      attemptedAttachments: [failedAttachment],
      failedAttachments: [
        {
          attachment: failedAttachment,
          error: new Error("Destination full"),
        },
      ],
      failedTransfers,
      targetProjectId: "proj_destination",
    });
    recordPromptAttachmentTransferFailures({
      attemptedAttachments: [successfulAttachment],
      failedAttachments: [],
      failedTransfers,
      targetProjectId: "proj_destination",
    });

    expect(failedTransfers.get("proj_destination")).toEqual(
      new Set(["proj_source:failed-source.png"]),
    );
    pruneFailedPromptAttachmentTransfers({
      attachments: [successfulAttachment],
      failedTransfers,
      targetProjectId: "proj_destination",
    });
    expect(failedTransfers.has("proj_destination")).toBe(false);
  });

  it("schedules another claim when a released destination is current again", () => {
    expect(
      shouldSchedulePromptAttachmentTransfer({
        attachments: [SOURCE_IMAGE],
        currentProjectId: "proj_destination",
        releasedTargetProjectId: "proj_destination",
      }),
    ).toBe(true);
    expect(
      shouldSchedulePromptAttachmentTransfer({
        attachments: [SOURCE_IMAGE],
        currentProjectId: "proj_later_selection",
        releasedTargetProjectId: "proj_destination",
      }),
    ).toBe(false);
  });
});

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
      deleteAttachment,
      getCurrentState: () => ({
        attachments: [SOURCE_IMAGE],
        projectId: "proj_later_selection",
      }),
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
      deleteAttachment,
      getCurrentState: () => ({
        attachments: [transferredAttachment.targetAttachment],
        projectId: "proj_later_selection",
      }),
      targetProjectId: "proj_destination",
      transferredAttachments: [transferredAttachment],
    });
    await cleanupStalePromptAttachmentCopies({
      deleteAttachment,
      getCurrentState: () => ({
        attachments: [],
        projectId: "proj_destination",
      }),
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
      deleteAttachment,
      getCurrentState: () => ({
        attachments: [],
        projectId: "proj_later_selection",
      }),
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

  it("stops stale cleanup when its destination becomes current again", async () => {
    let currentProjectId = "proj_later_selection";
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
      .mockImplementation(async () => firstDelete);

    const cleanup = cleanupStalePromptAttachmentCopies({
      deleteAttachment,
      getCurrentState: () => ({
        attachments: [SOURCE_IMAGE],
        projectId: currentProjectId,
      }),
      targetProjectId: "proj_destination",
      transferredAttachments: [
        transferredAttachment,
        secondTransferredAttachment,
      ],
    });

    await vi.waitFor(() => expect(deleteAttachment).toHaveBeenCalledOnce());
    currentProjectId = "proj_destination";
    resolveFirstDelete?.();
    await cleanup;

    expect(deleteAttachment).toHaveBeenCalledOnce();
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
