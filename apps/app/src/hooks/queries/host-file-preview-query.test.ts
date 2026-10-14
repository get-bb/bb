import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { hostFilePreviewQueryKey } from "./query-keys";
import { HEAVY_PAYLOAD_GC_TIME_MS } from "./query-policies";
import { hostFilePreviewQueryOptions } from "./host-file-preview-query";

const filesSdk = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { files: filesSdk },
}));

const fetchMock = vi.fn();
const unsubscribes: Array<() => void> = [];

function observePreview(
  queryClient: QueryClient,
  options: ReturnType<typeof hostFilePreviewQueryOptions>,
) {
  const observer = new QueryObserver(queryClient, options);
  unsubscribes.push(observer.subscribe(() => {}));
  return observer;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useHostFilePreview", () => {
  it("serves media from the host file URL without reading or retaining file bytes", async () => {
    filesSdk.read.mockResolvedValue({
      path: "/tmp/diagram.png",
      content: "iVBORw0KGgo=",
      contentEncoding: "base64",
      mimeType: "image/png",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 8,
    });
    const { queryClient } = createQueryClientTestHarness();
    const observer = observePreview(
      queryClient,
      hostFilePreviewQueryOptions("host-1", "/tmp/diagram.png"),
    );

    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isSuccess).toBe(true),
    );

    expect(filesSdk.read).not.toHaveBeenCalled();
    expect(observer.getCurrentResult().data).toEqual({
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      path: "/tmp/diagram.png",
      url: "/api/v1/hosts/host-1/files/tmp/diagram.png",
    });
    expect(
      queryClient.getQueryCache().find({
        queryKey: hostFilePreviewQueryKey("host-1", "/tmp/diagram.png"),
      })?.gcTime,
    ).toBe(HEAVY_PAYLOAD_GC_TIME_MS);
  });

  it("renders text from the host file URL without reading through the files API", async () => {
    fetchMock.mockResolvedValue(
      new Response("<h1>Report</h1>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const observer = observePreview(
      createQueryClientTestHarness().queryClient,
      hostFilePreviewQueryOptions("host-1", "/tmp/report.html"),
    );

    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isSuccess).toBe(true),
    );

    expect(filesSdk.read).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/hosts/host-1/files/tmp/report.html",
    );
    expect(observer.getCurrentResult().data).toMatchObject({
      kind: "text",
      content: "<h1>Report</h1>",
      url: "/api/v1/hosts/host-1/files/tmp/report.html",
    });
  });

  it("keeps ambiguous TypeScript paths on the source-preview path", async () => {
    fetchMock.mockResolvedValue(
      new Response("export const value = 1;\n", {
        headers: { "content-type": "video/mp2t" },
      }),
    );
    const observer = observePreview(
      createQueryClientTestHarness().queryClient,
      hostFilePreviewQueryOptions("host-1", "/tmp/example.ts"),
    );

    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isSuccess).toBe(true),
    );

    expect(observer.getCurrentResult().data).toMatchObject({
      kind: "text",
      content: "export const value = 1;\n",
    });
  });

  it("fails instead of reading the whole file when the host file URL fails", async () => {
    fetchMock.mockRejectedValue(new Error("host unavailable"));
    const observer = observePreview(
      createQueryClientTestHarness().queryClient,
      hostFilePreviewQueryOptions("host-1", "/tmp/archive.zip"),
    );

    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isError).toBe(true),
    );

    expect(filesSdk.read).not.toHaveBeenCalled();
  });

  it("aborts an active read and releases the heavy cache entry when disabled", async () => {
    let readSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal!;
          readSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const { queryClient } = createQueryClientTestHarness();
    const observer = observePreview(
      queryClient,
      hostFilePreviewQueryOptions("host-1", "/tmp/example.txt", {
        enabled: true,
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const activeQuery = queryClient.getQueryCache().find({
      queryKey: hostFilePreviewQueryKey("host-1", "/tmp/example.txt"),
    });
    expect(activeQuery).toBeDefined();

    vi.useFakeTimers();
    observer.setOptions(
      hostFilePreviewQueryOptions("host-1", "/tmp/example.txt", {
        enabled: false,
      }),
    );
    expect(readSignal?.aborted).toBe(true);
    expect(activeQuery?.getObserversCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(HEAVY_PAYLOAD_GC_TIME_MS + 1);
    expect(
      queryClient.getQueryCache().find({
        queryKey: hostFilePreviewQueryKey("host-1", "/tmp/example.txt"),
      }),
    ).toBeUndefined();
  });
});
