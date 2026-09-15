import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  MAX_TYPST_DEPENDENCY_BYTES,
  MAX_TYPST_SOURCE_BYTES,
} from "./server";
import {
  requireRelativeSourceFile,
  requireRelativeTypstFile,
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
    pluginId: "typst-inline",
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

describe("requireRelativeTypstFile", () => {
  it("accepts nested typst paths", () => {
    expect(requireRelativeTypstFile("report.typ")).toBe("report.typ");
    expect(requireRelativeTypstFile("reports/quarter one.TYP")).toBe(
      "reports/quarter one.TYP",
    );
    expect(requireRelativeTypstFile("a/b/c.typ")).toBe("a/b/c.typ");
  });

  it("rejects absolute, traversal, and unsupported paths", () => {
    expect(() => requireRelativeTypstFile("/etc/passwd.typ")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeTypstFile("C:\\docs\\report.typ")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeTypstFile("\\\\host\\share\\report.typ")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeTypstFile("../secret.typ")).toThrow(
      /traversal|escape/,
    );
    expect(() => requireRelativeTypstFile("..\\secret.typ")).toThrow();
    expect(() => requireRelativeTypstFile("reports/../secret.typ")).toThrow(
      /traversal/,
    );
    expect(() => requireRelativeTypstFile("report.md")).toThrow(/\.typ/);
    expect(() => requireRelativeTypstFile("report.typ.txt")).toThrow(/\.typ/);
    expect(() => requireRelativeTypstFile("")).toThrow(/non-empty/);
  });
});

describe("requireRelativeSourceFile", () => {
  it("accepts any nested dependency path", () => {
    expect(requireRelativeSourceFile("assets/logo.png")).toBe(
      "assets/logo.png",
    );
    expect(requireRelativeSourceFile("a/b/c.typ")).toBe("a/b/c.typ");
  });

  it("rejects absolute and traversing paths", () => {
    expect(() => requireRelativeSourceFile("/etc/passwd")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeSourceFile("C:\\docs\\logo.png")).toThrow(
      /source-relative/,
    );
    expect(() => requireRelativeSourceFile("../secret.png")).toThrow(
      /traversal|escape/,
    );
    expect(() => requireRelativeSourceFile("")).toThrow(/non-empty/);
  });
});

describe("resolveContainedSourcePath", () => {
  it("resolves under the root", () => {
    expect(resolveContainedSourcePath(ROOT, "reports/report.typ")).toBe(
      path.resolve(ROOT, "reports/report.typ"),
    );
  });

  it("rejects resolved paths outside the root", () => {
    expect(() =>
      resolveContainedSourcePath(ROOT, path.join("..", "outside.typ")),
    ).toThrow(/escape/);
  });
});

describe("prepareArtifact rpc", () => {
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
            path: path.resolve(ROOT, "reports/report.typ"),
            rootPath: ROOT,
            hostId: HOST_ID,
          });
          return {
            content: "= Report",
            contentEncoding: "utf8",
            sizeBytes: 8,
          };
        },
      },
    });

    await expect(
      harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "reports/report.typ",
      }),
    ).resolves.toEqual({
      file: "reports/report.typ",
      content: "= Report",
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
            path: path.resolve(storageRootPath, "reports/result.typ"),
            rootPath: storageRootPath,
            hostId: HOST_ID,
          });
          return { content: "= Result", contentEncoding: "utf8", sizeBytes: 8 };
        },
      },
    });

    await expect(
      harness.callRpc("prepareArtifact", {
        source: THREAD_STORAGE,
        file: "reports/result.typ",
      }),
    ).resolves.toMatchObject({
      file: "reports/result.typ",
      content: "= Result",
    });
    expect(harness.sdk.callsTo("threads.storageLocation")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.get")).toHaveLength(0);
  });

  it("rejects unknown input fields immediately", async () => {
    const { harness } = await load({ threads: { get: () => threadWithEnv() } });
    await expect(
      harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "report.typ",
        extra: true,
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
  });

  it("rejects an unknown source during input validation", async () => {
    const { harness } = await load({ threads: { get: () => threadWithEnv() } });
    await expect(
      harness.callRpc("prepareArtifact", {
        source: { kind: "project", projectId: "proj_1" },
        file: "report.typ",
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    expect(harness.sdk.calls).toHaveLength(0);
  });

  it("rejects an incomplete source descriptor", async () => {
    const { harness } = await load({ threads: { get: () => threadWithEnv() } });
    await expect(
      harness.callRpc("prepareArtifact", {
        source: { kind: "workspace", environmentId: "env_1" },
        file: "report.typ",
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
  });

  it("rejects missing fields and non-object input", async () => {
    const { harness } = await load({ threads: { get: () => threadWithEnv() } });
    await expect(
      harness.callRpc("prepareArtifact", null),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    await expect(
      harness.callRpc("prepareArtifact", { source: THREAD_WORKSPACE }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    await expect(
      harness.callRpc("prepareArtifact", { file: "report.typ" }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
  });

  it("requires a live environment path and hostId", async () => {
    const missingPath = await load({
      threads: { get: () => threadWithEnv({ path: null }) },
    });
    await expect(
      missingPath.harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "report.typ",
      }),
    ).rejects.toThrow(/no workspace path/);

    const missingHost = await load({
      threads: { get: () => threadWithEnv({ hostId: "" }) },
    });
    await expect(
      missingHost.harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "report.typ",
      }),
    ).rejects.toThrow(/no hostId/);
  });

  it("rejects absolute, traversing, and unsupported paths before reading", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw new Error("should not read");
        },
      },
    });
    await expect(
      harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "/tmp/x.typ",
      }),
    ).rejects.toThrow(/source-relative/);
    await expect(
      harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "../etc/passwd.typ",
      }),
    ).rejects.toThrow(/traversal|escape/);
    await expect(
      harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "report.tex",
      }),
    ).rejects.toThrow(/\.typ/);
    expect(harness.sdk.callsTo("files.read")).toHaveLength(0);
  });

  it("maps missing files and rejects non-utf8 or oversized content", async () => {
    const missing = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw Object.assign(new Error("not found"), { status: 404 });
        },
      },
    });
    await expect(
      missing.harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "gone.typ",
      }),
    ).rejects.toThrow(/not found/);

    const binary = await load({
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
      binary.harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "binary.typ",
      }),
    ).rejects.toThrow(/UTF-8/);

    const huge = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => ({
          content: "",
          contentEncoding: "utf8",
          sizeBytes: MAX_TYPST_SOURCE_BYTES + 1,
        }),
      },
    });
    await expect(
      huge.harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "big.typ",
      }),
    ).rejects.toThrow(/too large/);
  });

  it("propagates non-404 read failures", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw Object.assign(new Error("host offline"), { status: 503 });
        },
      },
    });
    await expect(
      harness.callRpc("prepareArtifact", {
        source: THREAD_WORKSPACE,
        file: "report.typ",
      }),
    ).rejects.toThrow(/host offline/);
  });
});

describe("readArtifactFile rpc", () => {
  it("returns binary dependency bytes under the workspace root", async () => {
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
      harness.callRpc("readArtifactFile", {
        source: THREAD_WORKSPACE,
        file: "assets/logo.png",
      }),
    ).resolves.toEqual({
      file: "assets/logo.png",
      content: "AAAA",
      contentEncoding: "base64",
    });
  });

  it("reads thread-storage dependencies without resolving the workspace", async () => {
    const storageRootPath = "/thread-storage/thr_1";
    const { harness } = await load({
      threads: {
        storageLocation: () => ({ hostId: HOST_ID, storageRootPath }),
      },
      files: {
        read: (args) => {
          expect(args).toEqual({
            path: path.resolve(storageRootPath, "assets/plot.svg"),
            rootPath: storageRootPath,
            hostId: HOST_ID,
          });
          return { content: "<svg/>", contentEncoding: "utf8", sizeBytes: 6 };
        },
      },
    });

    await expect(
      harness.callRpc("readArtifactFile", {
        source: THREAD_STORAGE,
        file: "assets/plot.svg",
      }),
    ).resolves.toEqual({
      file: "assets/plot.svg",
      content: "<svg/>",
      contentEncoding: "utf8",
    });
    expect(harness.sdk.callsTo("threads.get")).toHaveLength(0);
  });

  it("rejects absolute and traversing dependency paths before reading", async () => {
    const { harness } = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw new Error("should not read");
        },
      },
    });
    await expect(
      harness.callRpc("readArtifactFile", {
        source: THREAD_WORKSPACE,
        file: "/etc/passwd",
      }),
    ).rejects.toThrow(/source-relative/);
    await expect(
      harness.callRpc("readArtifactFile", {
        source: THREAD_WORKSPACE,
        file: "../outside/logo.png",
      }),
    ).rejects.toThrow(/traversal|escape/);
    expect(harness.sdk.callsTo("files.read")).toHaveLength(0);
  });

  it("names missing dependencies and enforces the size cap", async () => {
    const missing = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => {
          throw Object.assign(new Error("not found"), { status: 404 });
        },
      },
    });
    await expect(
      missing.harness.callRpc("readArtifactFile", {
        source: THREAD_WORKSPACE,
        file: "assets/gone.png",
      }),
    ).rejects.toThrow(/Typst dependency not found: assets\/gone\.png/);

    const huge = await load({
      threads: { get: () => threadWithEnv() },
      files: {
        read: () => ({
          content: "AAAA",
          contentEncoding: "base64",
          sizeBytes: MAX_TYPST_DEPENDENCY_BYTES + 1,
        }),
      },
    });
    await expect(
      huge.harness.callRpc("readArtifactFile", {
        source: THREAD_WORKSPACE,
        file: "assets/huge.png",
      }),
    ).rejects.toThrow(/too large/);
  });
});
