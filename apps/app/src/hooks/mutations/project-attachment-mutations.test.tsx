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
  ["image/heic", "image/png", false],
  ["image/png", "image/png", true],
  ["image/jpeg", "image/jpeg", true],
])(
  "uses a compatible preview for %s uploads",
  async (inputType, outputType, localPreview) => {
    const file = new File(["image bytes"], "photo", { type: inputType });
    const uploaded = {
      type: "localImage" as const,
      path: "stored-image",
      name: "photo",
      mimeType: outputType,
      sizeBytes: 10,
    };
    vi.mocked(sdk.projects.attachments.upload).mockResolvedValue(uploaded);
    const { wrapper, queryClient } = createQueryClientTestHarness();
    const { result } = renderHook(() => useUploadPromptAttachment(), {
      wrapper,
    });
    await act(() =>
      result.current.mutateAsync({ projectId: "project-1", file }),
    );
    expect(vi.mocked(registerLocalAttachmentPreview).mock.calls).toEqual(
      localPreview ? [[uploaded.path, file]] : [],
    );
    queryClient.clear();
  },
);
