import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_ANNOTATIONS_CONTROLLER_ID,
  BROWSER_ANNOTATIONS_PLUGIN_ID,
  createBrowserAnnotationsClient,
} from "./client.js";

const target = {
  clientId: "client-1",
  windowId: "window-1",
  tabId: "tab-1",
  navigationEpoch: 4,
};

const descriptor = {
  captureId: "capture-1",
  mimeType: "image/png" as const,
  pixelSize: { width: 1280, height: 720 },
  byteLength: 2048,
  target,
  expiresAt: 1_800_000_000_000,
};

describe("createBrowserAnnotationsClient", () => {
  it("sends the exact contribution envelope and parses screenshot descriptors", async () => {
    const experimental_requestContribution = vi.fn(async () => ({
      value: { screenshot: descriptor },
    }));
    const client = createBrowserAnnotationsClient({
      browser: { experimental_requestContribution },
    });

    await expect(client.request(target, { operation: "screenshot" })).resolves.toEqual({
      screenshot: descriptor,
    });
    expect(experimental_requestContribution).toHaveBeenCalledWith({
      pluginId: BROWSER_ANNOTATIONS_PLUGIN_ID,
      controllerId: BROWSER_ANNOTATIONS_CONTROLLER_ID,
      target,
      input: { operation: "screenshot" },
      timeoutMs: 30_000,
    });
  });

  it("rejects renderer preview URLs from contribution results", async () => {
    const client = createBrowserAnnotationsClient({
      browser: {
        experimental_requestContribution: vi.fn(async () => ({
          value: { screenshotUrl: "blob:local-preview" },
        })),
      },
    });

    await expect(client.request(target, { operation: "screenshot" })).rejects.toThrow(
      "invalid result",
    );
  });

  it("does not dispatch an already-aborted request", async () => {
    const experimental_requestContribution = vi.fn();
    const client = createBrowserAnnotationsClient({
      browser: { experimental_requestContribution },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.request(target, { operation: "get" }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(experimental_requestContribution).not.toHaveBeenCalled();
  });
});
