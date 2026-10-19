import { describe, expect, it } from "vitest";
import {
  allowsSubframeLoad,
  isServerApiUrl,
  resolveOpenWindowAction,
  resolveServerFileUrl,
  supportsNativeDownloads,
} from "./shell-save-file";

const ROOT = "https://bee.getbb.app";
const PREFIXED = "https://box.example.ts.net/bb";

describe("resolveServerFileUrl", () => {
  it("accepts a url on the server's origin, inside or outside its prefix", () => {
    expect(resolveServerFileUrl(`${ROOT}/api/v1/files/a`, ROOT)).toBe(
      `${ROOT}/api/v1/files/a`,
    );
    expect(
      resolveServerFileUrl("https://box.example.ts.net/api/v1/x", PREFIXED),
    ).toBe("https://box.example.ts.net/api/v1/x");
  });

  it("refuses another origin, credentials, and non-http schemes", () => {
    expect(resolveServerFileUrl("https://evil.example/x", ROOT)).toBeNull();
    expect(
      resolveServerFileUrl("https://user:pw@bee.getbb.app/x", ROOT),
    ).toBeNull();
    expect(resolveServerFileUrl("http://bee.getbb.app/x", ROOT)).toBeNull();
    expect(resolveServerFileUrl("file:///etc/passwd", ROOT)).toBeNull();
    expect(resolveServerFileUrl("not a url", ROOT)).toBeNull();
  });
});

describe("isServerApiUrl", () => {
  it("recognizes the api at the root and under the prefix", () => {
    expect(isServerApiUrl(`${ROOT}/api/v1/x`, ROOT)).toBe(true);
    expect(
      isServerApiUrl("https://box.example.ts.net/api/v1/x", PREFIXED),
    ).toBe(true);
    expect(isServerApiUrl(`${PREFIXED}/api/v1/x`, PREFIXED)).toBe(true);
    expect(isServerApiUrl(`${ROOT}/threads/thr_1`, ROOT)).toBe(false);
    expect(isServerApiUrl("https://evil.example/api/v1/x", ROOT)).toBe(false);
  });
});

describe("resolveOpenWindowAction", () => {
  it("saves a server file instead of replacing the app with it", () => {
    expect(resolveOpenWindowAction(`${ROOT}/api/v1/files/a.zip`, ROOT)).toBe(
      "save",
    );
  });

  it("keeps an app page in the shell and sends other sites out", () => {
    expect(resolveOpenWindowAction(`${ROOT}/threads/thr_1`, ROOT)).toBe(
      "navigate",
    );
    expect(resolveOpenWindowAction("https://example.com/docs", ROOT)).toBe(
      "external",
    );
    expect(resolveOpenWindowAction("blob:https://bee.getbb.app/1", ROOT)).toBe(
      "ignore",
    );
  });
});

describe("allowsSubframeLoad", () => {
  it("lets a frame show page-local and same-origin content", () => {
    expect(
      allowsSubframeLoad("blob:https://box.example.ts.net/1", PREFIXED),
    ).toBe(true);
    expect(allowsSubframeLoad("about:blank", PREFIXED)).toBe(true);
    expect(
      allowsSubframeLoad("https://box.example.ts.net/api/v1/x", PREFIXED),
    ).toBe(true);
  });

  it("leaves other sites to the top-frame rules", () => {
    expect(allowsSubframeLoad("https://example.com/", PREFIXED)).toBe(false);
    expect(allowsSubframeLoad("not a url", PREFIXED)).toBe(false);
  });
});

describe("native download binary support", () => {
  it("does not enable new JavaScript handlers on an older native binary", () => {
    for (const nativeModule of [
      null,
      undefined,
      {},
      { nativeDownloadsSupported: true },
    ]) {
      expect(supportsNativeDownloads(nativeModule)).toBe(false);
    }
    expect(
      supportsNativeDownloads({ nativeDownloadsSupported: () => true }),
    ).toBe(true);
  });
  it("falls back when the platform rejects or cannot answer the support query", () => {
    expect(
      supportsNativeDownloads({ nativeDownloadsSupported: () => false }),
    ).toBe(false);
    expect(
      supportsNativeDownloads({ nativeDownloadsSupported: () => "true" }),
    ).toBe(false);
    expect(
      supportsNativeDownloads({
        nativeDownloadsSupported: () => {
          throw new Error("Unsupported binary");
        },
      }),
    ).toBe(false);
  });
});
