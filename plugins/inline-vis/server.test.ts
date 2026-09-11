import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  MAX_PREVIEW_BYTES,
  requireRelativePreviewFile,
  resolveContainedPreviewPath,
} from "./server";

const ROOT = "/workspace/project";
const HOST_ID = "host_1";

function threadWithEnv(overrides?: { path?: string | null; hostId?: string }) {
  return {
    id: "thr_1",
    environment: {
      id: "env_1",
      hostId: overrides?.hostId ?? HOST_ID,
      path: overrides && "path" in overrides ? overrides.path : ROOT,
    },
  };
}

async function load(sdk: {
  threads?: {
    get?: (args: unknown) => unknown;
    storageLocation?: (args: unknown) => unknown;
  };
  files?: { read: (args: unknown) => unknown };
}) {
  const host = createFakePluginHost({
    pluginId: "inline-vis",
    sdk,
  });
  await plugin(host.bb);
  return host;
}

describe("requireRelativePreviewFile", () => {
  it("accepts nested preview paths", () => {
    expect(requireRelativePreviewFile("demo.html")).toBe("demo.html");
    expect(requireRelativePreviewFile("charts/out.HTML")).toBe(
      "charts/out.HTML",
    );
    expect(requireRelativePreviewFile("notes.md")).toBe("notes.md");
    expect(requireRelativePreviewFile("docs/summary.MARKDOWN")).toBe(
      "docs/summary.MARKDOWN",
    );
  });

  it("rejects absolute, traversal, and unsupported paths", () => {
    expect(() => requireRelativePreviewFile("/etc/passwd.html")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativePreviewFile("../secret.html")).toThrow(
      /traversal|escape/,
    );
    expect(() => requireRelativePreviewFile("..\\secret.html")).toThrow();
    expect(() => requireRelativePreviewFile("charts/../secret.html")).toThrow(
      /traversal/,
    );
    expect(() => requireRelativePreviewFile("demo.txt")).toThrow(/\.html/);
    expect(() => requireRelativePreviewFile("notes.mdx")).toThrow(/\.md/);
    expect(() => requireRelativePreviewFile("")).toThrow(/non-empty/);
  });
});

describe("resolveContainedPreviewPath", () => {
  it("resolves under the root", () => {
    expect(resolveContainedPreviewPath(ROOT, "demo.html")).toBe(
      path.resolve(ROOT, "demo.html"),
    );
  });

  it("rejects resolved paths outside the root", () => {
    expect(() =>
      resolveContainedPreviewPath(ROOT, path.join("..", "outside.html")),
    ).toThrow(/escape/);
  });
});

describe("preparePreview rpc", () => {
  it("returns Markdown content for a workspace document", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: (args) => {
          expect(args).toEqual({
            path: path.resolve(ROOT, "notes.md"),
            rootPath: ROOT,
            hostId: HOST_ID,
          });
          return {
            content: "# Notes\n\nReady for review.",
            contentEncoding: "utf8",
            sizeBytes: 26,
            sha256: "abc",
          };
        },
      },
    });

    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "notes.md",
      }),
    ).resolves.toEqual({
      kind: "markdown",
      file: "notes.md",
      source: "workspace",
      content: "# Notes\n\nReady for review.",
      document: {
        rootPath: ROOT,
        threadId: "thr_1",
        target: { kind: "workspace", environmentId: "env_1", path: "notes.md" },
      },
    });
  });

  it("returns Markdown content for a thread-storage document", async () => {
    const storageRootPath = "/thread-storage/thr_1";
    const { harness } = await load({
      threads: {
        storageLocation: () => ({ hostId: HOST_ID, storageRootPath }),
      },
      files: {
        read: (args) => {
          expect(args).toEqual({
            path: path.resolve(storageRootPath, "reports/summary.markdown"),
            rootPath: storageRootPath,
            hostId: HOST_ID,
          });
          return {
            content: "# Report",
            contentEncoding: "utf8",
            sizeBytes: 8,
            sha256: "abc",
          };
        },
      },
    });

    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "reports/summary.markdown",
        source: "thread-storage",
      }),
    ).resolves.toEqual({
      kind: "markdown",
      file: "reports/summary.markdown",
      source: "thread-storage",
      content: "# Report",
      document: {
        rootPath: storageRootPath,
        threadId: "thr_1",
        target: {
          kind: "thread-storage",
          threadId: "thr_1",
          path: "reports/summary.markdown",
        },
      },
    });
    expect(harness.sdk.callsTo("threads.get")).toHaveLength(0);
  });

  it("rejects unknown input fields immediately", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: { read: () => ({ content: "", contentEncoding: "utf8" }) },
    });
    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "demo.html",
        extra: true,
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
  });

  it("rejects an unknown source during input validation", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: { read: () => ({ content: "", contentEncoding: "utf8" }) },
    });
    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "demo.html",
        source: "project",
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    expect(harness.sdk.calls).toHaveLength(0);
  });

  it("rejects missing fields and non-object input", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: { read: () => ({ content: "", contentEncoding: "utf8" }) },
    });
    await expect(harness.callRpc("preparePreview", null)).rejects.toMatchObject(
      {
        code: "invalid_input",
        issues: expect.any(Array),
      },
    );
    await expect(
      harness.callRpc("preparePreview", { threadId: "thr_1" }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    await expect(
      harness.callRpc("preparePreview", { file: "demo.html" }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
  });

  it("requires a live environment path and hostId", async () => {
    const { harness } = await load({
      threads: {
        get: () => threadWithEnv({ path: null }),
      },
      files: { read: () => ({ content: "<p>x</p>", contentEncoding: "utf8" }) },
    });
    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "demo.html",
      }),
    ).rejects.toThrow(/no workspace path/);
  });

  it("reads through bb.sdk.files with hostId + rootPath confinement", async () => {
    const { harness } = await load({
      threads: {
        get: (args) => {
          expect(args).toEqual({
            threadId: "thr_1",
            include: "environment",
          });
          return threadWithEnv();
        },
      },
      files: {
        read: (args) => {
          expect(args).toEqual({
            path: path.resolve(ROOT, "charts/demo.html"),
            rootPath: ROOT,
            hostId: HOST_ID,
          });
          return {
            content: "<html><body>ok</body></html>",
            contentEncoding: "utf8",
            sizeBytes: 32,
            sha256: "abc",
          };
        },
      },
    });

    const result = await harness.callRpc("preparePreview", {
      threadId: "thr_1",
      file: "charts/demo.html",
      source: "workspace",
    });
    expect(result).toEqual({
      kind: "html",
      file: "charts/demo.html",
      source: "workspace",
    });
    expect(harness.sdk.callsTo("files.read")).toHaveLength(1);
  });

  it("reads thread storage without resolving the workspace", async () => {
    const storageRootPath = "/thread-storage/thr_1";
    const { harness } = await load({
      threads: {
        storageLocation: (args) => {
          expect(args).toEqual({ threadId: "thr_1" });
          return { hostId: HOST_ID, storageRootPath };
        },
      },
      files: {
        read: (args) => {
          expect(args).toEqual({
            path: path.resolve(storageRootPath, "reports/result.html"),
            rootPath: storageRootPath,
            hostId: HOST_ID,
          });
          return {
            content: "<html><body>ok</body></html>",
            contentEncoding: "utf8",
            sizeBytes: 32,
            sha256: "abc",
          };
        },
      },
    });

    const result = await harness.callRpc("preparePreview", {
      threadId: "thr_1",
      file: "reports/result.html",
      source: "thread-storage",
    });
    expect(result).toEqual({
      kind: "html",
      file: "reports/result.html",
      source: "thread-storage",
    });
    expect(harness.sdk.callsTo("threads.storageLocation")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.get")).toHaveLength(0);
    expect(harness.sdk.callsTo("files.read")).toHaveLength(1);
  });

  it("rejects absolute and traversing file attributes before reading", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw new Error("should not read");
        },
      },
    });
    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "/tmp/x.html",
      }),
    ).rejects.toThrow(/source-relative/);
    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "../etc/passwd.html",
      }),
    ).rejects.toThrow(/traversal|escape/);
    await expect(
      harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "notes.txt",
      }),
    ).rejects.toThrow(/\.html/);
    expect(harness.sdk.callsTo("files.read")).toHaveLength(0);
  });

  it("maps missing files and rejects non-utf8 or oversized content", async () => {
    const missingHost = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw Object.assign(new Error("not found"), { status: 404 });
        },
      },
    });
    await expect(
      missingHost.harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "gone.html",
      }),
    ).rejects.toThrow(/not found/);

    const binaryHost = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => ({
          content: "????",
          contentEncoding: "base64",
          sizeBytes: 4,
        }),
      },
    });
    await expect(
      binaryHost.harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "bin.html",
      }),
    ).rejects.toThrow(/UTF-8/);

    const hugeHost = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => ({
          content: "",
          contentEncoding: "utf8",
          sizeBytes: MAX_PREVIEW_BYTES + 1,
        }),
      },
    });
    await expect(
      hugeHost.harness.callRpc("preparePreview", {
        threadId: "thr_1",
        file: "big.html",
      }),
    ).rejects.toThrow(/too large/);
  });
});
