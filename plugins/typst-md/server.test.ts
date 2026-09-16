import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  MAX_ASSET_BYTES,
  MAX_MARKDOWN_SOURCE_BYTES,
} from "./server";
import {
  requireRelativeMarkdownFile,
  requireRelativeSourceFile,
  resolveContainedSourcePath,
} from "./lib/artifact-path";

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

const THREAD_WORKSPACE = { kind: "thread-workspace", threadId: "thr_1" } as const;
const THREAD_STORAGE = { kind: "thread-storage", threadId: "thr_1" } as const;

type ReadResult = {
  content: string;
  contentEncoding?: string;
  sizeBytes?: number;
};

async function load(sdk: {
  threads?: {
    get?: (args: unknown) => unknown;
    storageLocation?: (args: unknown) => unknown;
  };
  files?: { read?: (args: unknown) => ReadResult };
}) {
  const host = createFakePluginHost({
    pluginId: "typst-md",
    sdk: {
      files: {
        read: () => ({ content: "", contentEncoding: "utf8", sizeBytes: 0 }),
        ...sdk.files,
      },
      threads: sdk.threads,
    },
  });
  await plugin(host.bb);
  return host;
}

describe("requireRelativeMarkdownFile", () => {
  it("accepts nested markdown paths", () => {
    expect(requireRelativeMarkdownFile("notes.md")).toBe("notes.md");
    expect(requireRelativeMarkdownFile("reports/quarter one.MD")).toBe(
      "reports/quarter one.MD",
    );
    expect(requireRelativeMarkdownFile("a/b/c.markdown")).toBe("a/b/c.markdown");
  });

  it("rejects absolute, traversal, and unsupported paths", () => {
    expect(() => requireRelativeMarkdownFile("/etc/passwd.md")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeMarkdownFile("C:\\docs\\notes.md")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeMarkdownFile("../secret.md")).toThrow(
      /traversal|escape/,
    );
    expect(() => requireRelativeMarkdownFile("reports/../secret.md")).toThrow(
      /traversal/,
    );
    expect(() => requireRelativeMarkdownFile("notes.txt")).toThrow(/\.md/);
    expect(() => requireRelativeMarkdownFile("")).toThrow(/non-empty/);
  });
});

describe("requireRelativeSourceFile", () => {
  it("accepts any nested asset path", () => {
    expect(requireRelativeSourceFile("assets/logo.png")).toBe(
      "assets/logo.png",
    );
  });

  it("rejects absolute and traversing paths", () => {
    expect(() => requireRelativeSourceFile("/etc/passwd")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeSourceFile("../secret.png")).toThrow(
      /traversal|escape/,
    );
    expect(() => requireRelativeSourceFile("")).toThrow(/non-empty/);
  });
});

describe("resolveContainedSourcePath", () => {
  it("resolves under the root and rejects escapes", () => {
    expect(resolveContainedSourcePath(ROOT, "reports/notes.md")).toBe(
      path.resolve(ROOT, "reports/notes.md"),
    );
    expect(() =>
      resolveContainedSourcePath(ROOT, path.join("..", "outside.md")),
    ).toThrow(/escape/);
  });
});

describe("prepareDocument rpc", () => {
  it("returns workspace source for a live environment", async () => {
    const { harness } = await load({
      threads: {
        get: (args) => {
          expect(args).toEqual({ threadId: "thr_1", include: "environment" });
          return threadWithEnv();
        },
      },
      files: {
        read: (args) => {
          expect(args).toEqual({
            path: path.resolve(ROOT, "reports/notes.md"),
            rootPath: ROOT,
            hostId: HOST_ID,
          });
          return { content: "# Notes", contentEncoding: "utf8", sizeBytes: 7 };
        },
      },
    });

    await expect(
      harness.callRpc("prepareDocument", {
        source: THREAD_WORKSPACE,
        file: "reports/notes.md",
      }),
    ).resolves.toEqual({ file: "reports/notes.md", content: "# Notes" });
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
            path: path.resolve(storageRootPath, "reports/result.md"),
            rootPath: storageRootPath,
            hostId: HOST_ID,
          });
          return { content: "# Result", contentEncoding: "utf8", sizeBytes: 8 };
        },
      },
    });

    await expect(
      harness.callRpc("prepareDocument", {
        source: THREAD_STORAGE,
        file: "reports/result.md",
      }),
    ).resolves.toEqual({ file: "reports/result.md", content: "# Result" });
    expect(harness.sdk.callsTo("threads.storageLocation")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.get")).toHaveLength(0);
  });

  it("rejects unknown input fields and sources", async () => {
    const { harness } = await load({ threads: { get: () => threadWithEnv() } });
    await expect(
      harness.callRpc("prepareDocument", {
        source: THREAD_WORKSPACE,
        file: "notes.md",
        extra: true,
      }),
    ).rejects.toMatchObject({ code: "invalid_input", issues: expect.any(Array) });
    await expect(
      harness.callRpc("prepareDocument", {
        source: { kind: "project", projectId: "proj_1" },
        file: "notes.md",
      }),
    ).rejects.toMatchObject({ code: "invalid_input", issues: expect.any(Array) });
    expect(harness.sdk.calls).toHaveLength(0);
  });

  it("requires a live environment path and hostId", async () => {
    const missingPath = await load({
      threads: { get: () => threadWithEnv({ path: null }) },
    });
    await expect(
      missingPath.harness.callRpc("prepareDocument", {
        source: THREAD_WORKSPACE,
        file: "notes.md",
      }),
    ).rejects.toThrow(/no workspace path/);

    const missingHost = await load({
      threads: { get: () => threadWithEnv({ hostId: "" }) },
    });
    await expect(
      missingHost.harness.callRpc("prepareDocument", {
        source: THREAD_WORKSPACE,
        file: "notes.md",
      }),
    ).rejects.toThrow(/no hostId/);
  });

  it("maps missing files, non-utf8, and oversized content", async () => {
    const missing = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw Object.assign(new Error("not found"), { status: 404 });
        },
      },
    });
    await expect(
      missing.harness.callRpc("prepareDocument", {
        source: THREAD_WORKSPACE,
        file: "gone.md",
      }),
    ).rejects.toThrow(/not found/);

    const binary = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => ({ content: "????", contentEncoding: "base64", sizeBytes: 4 }),
      },
    });
    await expect(
      binary.harness.callRpc("prepareDocument", {
        source: THREAD_WORKSPACE,
        file: "binary.md",
      }),
    ).rejects.toThrow(/UTF-8/);

    const huge = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => ({
          content: "",
          contentEncoding: "utf8",
          sizeBytes: MAX_MARKDOWN_SOURCE_BYTES + 1,
        }),
      },
    });
    await expect(
      huge.harness.callRpc("prepareDocument", {
        source: THREAD_WORKSPACE,
        file: "big.md",
      }),
    ).rejects.toThrow(/too large/);
  });
});

describe("readAsset rpc", () => {
  it("returns binary asset bytes under the workspace root", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: (args) => {
          expect(args).toEqual({
            path: path.resolve(ROOT, "assets/logo.png"),
            rootPath: ROOT,
            hostId: HOST_ID,
          });
          return { content: "AAAA", contentEncoding: "base64", sizeBytes: 3 };
        },
      },
    });

    await expect(
      harness.callRpc("readAsset", {
        source: THREAD_WORKSPACE,
        file: "assets/logo.png",
      }),
    ).resolves.toEqual({
      file: "assets/logo.png",
      content: "AAAA",
      contentEncoding: "base64",
    });
  });

  it("names missing assets and enforces the size cap", async () => {
    const missing = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw Object.assign(new Error("not found"), { status: 404 });
        },
      },
    });
    await expect(
      missing.harness.callRpc("readAsset", {
        source: THREAD_WORKSPACE,
        file: "assets/gone.png",
      }),
    ).rejects.toThrow(/Markdown asset not found: assets\/gone\.png/);

    const huge = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => ({
          content: "AAAA",
          contentEncoding: "base64",
          sizeBytes: MAX_ASSET_BYTES + 1,
        }),
      },
    });
    await expect(
      huge.harness.callRpc("readAsset", {
        source: THREAD_WORKSPACE,
        file: "assets/huge.png",
      }),
    ).rejects.toThrow(/too large/);
  });

  it("rejects absolute and traversing asset paths before reading", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw new Error("should not read");
        },
      },
    });
    await expect(
      harness.callRpc("readAsset", {
        source: THREAD_WORKSPACE,
        file: "/etc/passwd",
      }),
    ).rejects.toThrow(/source-relative/);
    await expect(
      harness.callRpc("readAsset", {
        source: THREAD_WORKSPACE,
        file: "../outside/logo.png",
      }),
    ).rejects.toThrow(/traversal|escape/);
    expect(harness.sdk.callsTo("files.read")).toHaveLength(0);
  });
});
