import { assembleBrowserCapture } from "@bb/domain";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import { bbDesktopBrowserCaptureDescriptorSchema } from "@bb/desktop-contract";

export async function captureBrowserPagePreview(
  desktopBrowser: Pick<
    BbDesktopBrowserApi,
    | "experimental_browserControlVersion"
    | "experimental_captureBrowserPage"
    | "experimental_readBrowserCaptureChunk"
    | "experimental_releaseBrowserCapture"
  >,
  request: {
    tabId: string;
    format: "png" | "jpeg";
    quality: number;
    expectedNavigationEpoch: number;
    signal?: AbortSignal;
  },
): Promise<{
  url: string;
  navigationEpoch: number;
  pixelSize: { width: number; height: number };
  dispose(): void;
}> {
  const capture = desktopBrowser.experimental_captureBrowserPage;
  const readChunk = desktopBrowser.experimental_readBrowserCaptureChunk;
  const release = desktopBrowser.experimental_releaseBrowserCapture;
  if (
    desktopBrowser.experimental_browserControlVersion !== 2 ||
    capture === undefined ||
    readChunk === undefined ||
    release === undefined
  ) {
    throw new Error("Browser captures require a newer BB desktop app");
  }
  request.signal?.throwIfAborted();
  const descriptor = await capture(
    {
      tabId: request.tabId,
      requestId: crypto.randomUUID(),
      format: request.format,
      quality: request.quality,
      expectedNavigationEpoch: request.expectedNavigationEpoch,
    },
    { signal: request.signal },
  );
  let assemblyOwnsRelease = false;
  try {
    const parsed = bbDesktopBrowserCaptureDescriptorSchema.parse(descriptor);
    if (parsed.navigationEpoch !== request.expectedNavigationEpoch) {
      throw new Error("Browser page changed before the capture completed");
    }
    assemblyOwnsRelease = true;
    const bytes = await assembleBrowserCapture({
      descriptor: parsed,
      signal: request.signal,
      read: (chunk) => readChunk({ ...chunk, tabId: request.tabId }),
      release: () =>
        release({ captureId: parsed.captureId, tabId: request.tabId }),
    });
    request.signal?.throwIfAborted();
    const blob = new Blob([bytes], {
      type: parsed.format === "png" ? "image/png" : "image/jpeg",
    });
    const url = URL.createObjectURL(blob);
    return {
      url,
      navigationEpoch: parsed.navigationEpoch,
      pixelSize: parsed.pixelSize,
      dispose: () => URL.revokeObjectURL(url),
    };
  } finally {
    if (!assemblyOwnsRelease && typeof descriptor.captureId === "string") {
      await release({ captureId: descriptor.captureId, tabId: request.tabId });
    }
  }
}
