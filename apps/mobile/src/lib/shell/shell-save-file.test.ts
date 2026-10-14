import { describe, expect, it } from "vitest";
import {
  allowsSubframeLoad,
  buildCookieHeader,
  createFileTransferRegistry,
  describeDownloadFailure,
  isServerApiUrl,
  resolveOpenWindowAction,
  resolveServerFileUrl,
  sanitizeSaveFileName,
  type FileTransferSink,
} from "./shell-save-file";

const ROOT = "https://bee.getbb.app";
const PREFIXED = "https://box.example.ts.net/bb";

describe("sanitizeSaveFileName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeSaveFileName("report 2026.pdf")).toBe("report 2026.pdf");
  });

  it("never lets a name climb out of the save directory", () => {
    expect(sanitizeSaveFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(sanitizeSaveFileName("a\\b:c\u0000d")).toBe("a_b_c_d");
    expect(sanitizeSaveFileName(".hidden")).toBe("hidden");
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeSaveFileName("  ")).toBe("download");
    expect(sanitizeSaveFileName("...")).toBe("download");
  });

  it("shortens a long name but keeps its extension", () => {
    const name = sanitizeSaveFileName(`${"x".repeat(400)}.tar.gz`);
    expect(name.length).toBe(180);
    expect(name.endsWith(".gz")).toBe(true);
  });
});

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

describe("buildCookieHeader", () => {
  it("joins cookies and reports none as null", () => {
    expect(
      buildCookieHeader({
        a: { name: "a", value: "1" },
        b: { name: "b", value: "2" },
      }),
    ).toBe("a=1; b=2");
    expect(buildCookieHeader({})).toBeNull();
  });
});

interface FakeSink extends FileTransferSink {
  chunks: string[];
  discarded: boolean;
}

function setup(options: { maxTransfers?: number; idleMs?: number } = {}) {
  let now = 1_000;
  const sinks: FakeSink[] = [];
  const registry = createFileTransferRegistry<FakeSink>({
    maxTransfers: options.maxTransfers ?? 4,
    idleMs: options.idleMs ?? 60_000,
    now: () => now,
  });
  const createSink = (): FakeSink => {
    const sink: FakeSink = {
      chunks: [],
      discarded: false,
      append(data) {
        sink.chunks.push(data);
      },
      discard() {
        sink.discarded = true;
      },
    };
    sinks.push(sink);
    return sink;
  };
  return {
    registry,
    sinks,
    createSink,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createFileTransferRegistry", () => {
  it("assembles chunks in order and hands the sink over once complete", () => {
    const { registry, createSink } = setup();
    const id = registry.start(8, createSink);
    expect(registry.append(id, 0, "aGVsbG8=")).toBe(5);
    expect(registry.append(id, 5, "YWJj")).toBe(8);
    const sink = registry.finish(id);
    expect(sink.chunks).toEqual(["aGVsbG8=", "YWJj"]);
    expect(registry.size).toBe(0);
  });

  it("saves an empty file without any chunks", () => {
    const { registry, createSink } = setup();
    const id = registry.start(0, createSink);
    expect(registry.finish(id).discarded).toBe(false);
  });

  it("drops a transfer whose chunk is out of order or overflows", () => {
    const { registry, sinks, createSink } = setup();
    const skipped = registry.start(8, createSink);
    expect(() => registry.append(skipped, 3, "YWJj")).toThrow("out of order");
    expect(sinks[0]?.discarded).toBe(true);
    const overflow = registry.start(3, createSink);
    expect(() => registry.append(overflow, 0, "aGVsbG8=")).toThrow(
      "out of order",
    );
    expect(sinks[1]?.discarded).toBe(true);
    expect(() => registry.finish(overflow)).toThrow("Unknown file transfer");
  });

  it("refuses to save a transfer that is missing bytes", () => {
    const { registry, sinks, createSink } = setup();
    const id = registry.start(8, createSink);
    registry.append(id, 0, "aGVsbG8=");
    expect(() => registry.finish(id)).toThrow("incomplete");
    expect(sinks[0]?.discarded).toBe(true);
  });

  it("discards the sink when writing a chunk fails", () => {
    const { registry, createSink } = setup();
    let failing: FakeSink | null = null;
    const id = registry.start(5, () => {
      failing = createSink();
      failing.append = () => {
        throw new Error("disk full");
      };
      return failing;
    });
    expect(() => registry.append(id, 0, "aGVsbG8=")).toThrow("disk full");
    expect(failing).toMatchObject({ discarded: true });
  });

  it("expires a transfer the page abandoned, such as after a reload", () => {
    const { registry, sinks, createSink, advance } = setup({ idleMs: 100 });
    const id = registry.start(8, createSink);
    advance(101);
    expect(() => registry.append(id, 0, "aGVsbG8=")).toThrow(
      "Unknown file transfer",
    );
    expect(sinks[0]?.discarded).toBe(true);
  });

  it("caps concurrent transfers and frees the slot on clear", () => {
    const { registry, sinks, createSink } = setup({ maxTransfers: 1 });
    registry.start(1, createSink);
    expect(() => registry.start(1, createSink)).toThrow("Too many");
    registry.clear();
    expect(sinks[0]?.discarded).toBe(true);
    expect(registry.start(1, createSink)).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
});

describe("describeDownloadFailure", () => {
  it("drops the native exception wrapper and source location", () => {
    expect(
      describeDownloadFailure(
        "UnableToDownloadException: Unable to download a file: Could not connect to the server. (at ExpoFileSystem/FileSystemDownload.swift:135)",
      ),
    ).toBe("Could not connect to the server.");
  });

  it("names the status the server answered with", () => {
    expect(
      describeDownloadFailure(
        "Unable to download a file: response has status 401 (at x.swift:1)",
      ),
    ).toBe("The server answered 401.");
    expect(describeDownloadFailure("server returned HTTP 404")).toBe(
      "The server answered 404.",
    );
  });

  it("keeps an unfamiliar message and never returns nothing", () => {
    expect(describeDownloadFailure("Only files from this server")).toBe(
      "Only files from this server",
    );
    expect(describeDownloadFailure("")).toBe("The download failed.");
  });
});
