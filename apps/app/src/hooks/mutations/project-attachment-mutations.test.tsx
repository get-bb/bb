// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { registerLocalAttachmentPreview } from "@/lib/attachment-local-previews";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useUploadPromptAttachment } from "./project-mutations";

vi.mock("@/lib/sdk", () => ({
  sdk: { projects: { attachments: { upload: vi.fn() } } },
}));
vi.mock("@/lib/attachment-local-previews", () => ({
  registerLocalAttachmentPreview: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  ["image/heic", "photo.heic", false],
  ["image/png", "photo.png", true],
  ["image/jpeg", "photo.jpg", true],
])(
  "uses a compatible preview for %s uploads",
  async (mimeType, name, localPreview) => {
    const file = new File(["image bytes"], name, { type: mimeType });
    const uploaded = {
      type: "localImage" as const,
      sourceProjectId: "project-1",
      path: `uploaded-${mimeType === "image/heic" ? "photo.png" : name}`,
      name: mimeType === "image/heic" ? "photo.png" : name,
      mimeType: mimeType === "image/heic" ? "image/png" : mimeType,
      sizeBytes: 10,
    };
    vi.mocked(sdk.projects.attachments.upload).mockResolvedValue(uploaded);
    const { wrapper, queryClient } = createQueryClientTestHarness();
    const { result } = renderHook(() => useUploadPromptAttachment(), {
      wrapper,
    });
    await act(async () => {
      expect(
        await result.current.mutateAsync({ projectId: "project-1", file }),
      ).toEqual(uploaded);
    });
    if (localPreview) {
      expect(registerLocalAttachmentPreview).toHaveBeenCalledWith(
        uploaded.path,
        file,
      );
    } else {
      expect(registerLocalAttachmentPreview).not.toHaveBeenCalled();
    }
    queryClient.clear();
  },
);
