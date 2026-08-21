// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { hostFilePreviewQueryKey } from "./query-keys";
import { HEAVY_PAYLOAD_GC_TIME_MS } from "./query-policies";
import { useHostFilePreview } from "./host-file-preview-query";

const filesSdk = vi.hoisted(() => ({
  createPreview: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { files: filesSdk },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useHostFilePreview", () => {
  it("uses a successful preview lease for media without reading or retaining file bytes", async () => {
    filesSdk.createPreview.mockResolvedValue({
      baseUrl: "/api/v1/file-previews/lease-1",
      expiresAtMs: Date.now() + 60_000,
    });
    filesSdk.read.mockResolvedValue({
      path: "/tmp/diagram.png",
      content: "iVBORw0KGgo=",
      contentEncoding: "base64",
      mimeType: "image/png",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 8,
    });
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/diagram.png"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(filesSdk.createPreview).toHaveBeenCalledTimes(1);
    expect(filesSdk.read).not.toHaveBeenCalled();
    expect(result.current.data).toEqual({
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      path: "/tmp/diagram.png",
      url: "/api/v1/file-previews/lease-1/diagram.png",
    });
    expect(
      queryClient.getQueryCache().find({
        queryKey: hostFilePreviewQueryKey("host-1", "/tmp/diagram.png"),
      })?.gcTime,
    ).toBe(HEAVY_PAYLOAD_GC_TIME_MS);
  });

  it("keeps HTML source bytes while avoiding a base64 fallback after a lease succeeds", async () => {
    filesSdk.createPreview.mockResolvedValue({
      baseUrl: "/api/v1/file-previews/lease-2",
      expiresAtMs: Date.now() + 60_000,
    });
    filesSdk.read.mockResolvedValue({
      path: "/tmp/report.html",
      content: "<h1>Report</h1>",
      contentEncoding: "utf8",
      mimeType: "text/html",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 15,
    });
    const encodeSpy = vi.spyOn(globalThis, "btoa");
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/report.html"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(filesSdk.createPreview).toHaveBeenCalledTimes(1);
    expect(filesSdk.read).toHaveBeenCalledTimes(1);
    expect(filesSdk.createPreview.mock.invocationCallOrder[0]).toBeLessThan(
      filesSdk.read.mock.invocationCallOrder[0]!,
    );
    expect(encodeSpy).not.toHaveBeenCalled();
    expect(result.current.data).toMatchObject({
      kind: "text",
      content: "<h1>Report</h1>",
      url: "/api/v1/file-previews/lease-2/report.html",
    });
  });

  it("keeps ambiguous TypeScript paths on the source-preview path", async () => {
    filesSdk.createPreview.mockResolvedValue({
      baseUrl: "/api/v1/file-previews/lease-3",
      expiresAtMs: Date.now() + 60_000,
    });
    filesSdk.read.mockResolvedValue({
      path: "/tmp/example.ts",
      content: "export const value = 1;\n",
      contentEncoding: "utf8",
      mimeType: "video/mp2t",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 24,
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/example.ts"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(filesSdk.read).toHaveBeenCalledTimes(1);
    expect(result.current.data).toMatchObject({
      kind: "text",
      content: "export const value = 1;\n",
    });
  });

  it("reads and builds a data URL only after preview lease creation fails", async () => {
    filesSdk.createPreview.mockRejectedValue(new Error("host unavailable"));
    filesSdk.read.mockResolvedValue({
      path: "/tmp/diagram.png",
      content: "iVBORw0KGgo=",
      contentEncoding: "base64",
      mimeType: "image/png",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 8,
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/diagram.png"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(filesSdk.createPreview.mock.invocationCallOrder[0]).toBeLessThan(
      filesSdk.read.mock.invocationCallOrder[0]!,
    );
    expect(result.current.data).toMatchObject({
      kind: "image",
      url: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("aborts an active read and releases the heavy cache entry when disabled", async () => {
    let readSignal: AbortSignal | undefined;
    filesSdk.createPreview.mockResolvedValue({
      baseUrl: "/api/v1/file-previews/lease-4",
      expiresAtMs: Date.now() + 60_000,
    });
    filesSdk.read.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          readSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { rerender } = renderHook(
      ({ enabled }) =>
        useHostFilePreview("host-1", "/tmp/example.txt", { enabled }),
      { initialProps: { enabled: true }, wrapper },
    );

    await waitFor(() => expect(filesSdk.read).toHaveBeenCalledTimes(1));
    const activeQuery = queryClient.getQueryCache().find({
      queryKey: hostFilePreviewQueryKey("host-1", "/tmp/example.txt"),
    });
    expect(activeQuery).toBeDefined();

    vi.useFakeTimers();
    rerender({ enabled: false });
    expect(readSignal?.aborted).toBe(true);
    expect(activeQuery?.getObserversCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAVY_PAYLOAD_GC_TIME_MS + 1);
    });
    expect(
      queryClient.getQueryCache().find({
        queryKey: hostFilePreviewQueryKey("host-1", "/tmp/example.txt"),
      }),
    ).toBeUndefined();
  });
});
