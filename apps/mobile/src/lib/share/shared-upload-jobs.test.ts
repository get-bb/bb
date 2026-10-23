import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  getReceipt: vi.fn(),
  getShare: vi.fn(),
  prepare: vi.fn(),
  record: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./share-inbox", () => ({
  acknowledgeShareForProject: mocks.acknowledge,
  getPendingShare: mocks.getShare,
  getSharedUploadReceipt: mocks.getReceipt,
  preparePendingShare: mocks.prepare,
  recordSharedUpload: mocks.record,
}));

vi.mock("@/app-shell/client-registry", () => ({
  getAppProfileClientRegistry: () => ({
    getClientForProfile: () => ({
      sdk: { projects: { attachments: { upload: mocks.upload } } },
    }),
  }),
}));

import {
  readSharedUploadStatus,
  startSharedUpload,
} from "./shared-upload-jobs";

const profile = {
  id: "profile-one",
  serverUrl: "https://bb.example",
  label: "bb",
  mode: "direct" as const,
  createdAt: 1,
};

describe("shared upload jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue({
      id: "fc78acaa-60d9-4a5d-95e7-a62b67e61da6",
      text: "",
      createdAt: 1,
      files: [
        {
          fileId: "b6d01a08-b480-4407-9e3a-881cc7b0be1b",
          fileName: "photo.png",
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 42,
          uri: "file:///private/share/photo.png",
          path: "photo.png",
        },
      ],
    });
    mocks.getReceipt.mockResolvedValue(null);
    mocks.upload.mockResolvedValue({
      type: "localImage",
      path: "photo-uploaded.png",
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 42,
    });
  });

  it("deduplicates same-scope starts and records successful SDK uploads", async () => {
    const first = startSharedUpload(
      profile,
      "fc78acaa-60d9-4a5d-95e7-a62b67e61da6",
      "b6d01a08-b480-4407-9e3a-881cc7b0be1b",
      "proj_one",
    );
    const second = startSharedUpload(
      profile,
      "fc78acaa-60d9-4a5d-95e7-a62b67e61da6",
      "b6d01a08-b480-4407-9e3a-881cc7b0be1b",
      "proj_one",
    );
    expect(second.jobId).toBe(first.jobId);
    await vi.waitFor(() => {
      expect(readSharedUploadStatus(profile, first.jobId).status).toBe(
        "complete",
      );
    });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith(
      "fc78acaa-60d9-4a5d-95e7-a62b67e61da6",
      profile.id,
      profile.serverUrl,
      "proj_one",
      "b6d01a08-b480-4407-9e3a-881cc7b0be1b",
      expect.objectContaining({ path: "photo-uploaded.png" }),
    );
    expect(
      readSharedUploadStatus({ ...profile, id: "profile-two" }, first.jobId)
        .status,
    ).toBe("failed");
  });

  it("keeps a file processing error retryable without uploading it", async () => {
    mocks.prepare.mockResolvedValueOnce({
      id: "d055f19f-e1a6-4a2e-8f16-7310892e8462",
      text: "",
      createdAt: 1,
      files: [
        {
          fileId: "2378152c-563a-4ef4-8845-61a14f08f797",
          fileName: "movie.mov",
          kind: "video",
          mimeType: "video/mp4",
          sizeBytes: 42,
          uri: "file:///private/share/movie.mov",
          path: "movie.mov",
          processingError: "Video export failed.",
        },
      ],
    });
    const started = startSharedUpload(
      profile,
      "d055f19f-e1a6-4a2e-8f16-7310892e8462",
      "2378152c-563a-4ef4-8845-61a14f08f797",
      "proj_one",
    );
    await vi.waitFor(() => {
      expect(readSharedUploadStatus(profile, started.jobId)).toMatchObject({
        status: "failed",
        error: "Video export failed.",
      });
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
