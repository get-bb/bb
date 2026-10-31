// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalFileLinkOpener } from "./useLocalFileLinkOpener";

const mocks = vi.hoisted(() => ({
  openPathInFileTarget: vi.fn(async () => true),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useLiveFileOpenTargets", () => ({
  useLiveFileOpenTargets: (root: { hostId: string } | null) => ({
    fileOpenTargets: root === null ? [] : [{ id: "cursor" }],
    openPathInFileTarget: mocks.openPathInFileTarget,
  }),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: mocks.toastError },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderOpener(hostId: string | null) {
  const openFilePreview = vi.fn(() => true);
  const { result } = renderHook(() =>
    useLocalFileLinkOpener({
      canOpenInEditor: true,
      hostId,
      openFilePreview,
      threadStorage: null,
      workspace: { environmentId: "env_1", rootPath: "/repo" },
    }),
  );
  return { openFilePreview, openLink: result.current.openLink };
}

describe("useLocalFileLinkOpener", () => {
  it("opens editor links in the editor they name", () => {
    const { openFilePreview, openLink } = renderOpener("host_1");

    expect(
      openLink({
        lineRange: { startLineNumber: 7, endLineNumber: 9 },
        openTargetId: "cursor",
        path: "/repo/src/a.ts",
      }),
    ).toBe(true);

    expect(mocks.openPathInFileTarget).toHaveBeenCalledWith({
      lineNumber: 7,
      path: "/repo/src/a.ts",
      rememberTarget: false,
      targetId: "cursor",
    });
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("previews workspace files with the caller's viewer", () => {
    const { openFilePreview, openLink } = renderOpener("host_1");

    openLink(
      { lineRange: null, openTargetId: null, path: "/repo/README.md" },
      { viewer: "builtin" },
    );

    expect(openFilePreview).toHaveBeenCalledWith({
      target: { kind: "workspace", environmentId: "env_1", path: "README.md" },
      location: null,
      viewer: "builtin",
    });
  });

  it("explains a path outside every root when there is no machine", () => {
    const { openFilePreview, openLink } = renderOpener(null);

    expect(
      openLink({ lineRange: null, openTargetId: null, path: "/etc/hosts" }),
    ).toBe(true);

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to open file locally",
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
