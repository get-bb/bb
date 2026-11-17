import { fork } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  nativePluginMessageSchema,
  type NativePluginRequest,
  type NativePluginResult,
} from "../../fixtures/native-plugin-server-protocol.js";

function startNativePluginChild() {
  const child = fork(
    new URL("../../fixtures/native-plugin-server-child.ts", import.meta.url),
    [],
    {
      cwd: resolve(import.meta.dirname, "../../.."),
      execArgv: ["--conditions=source", "--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_192);
    });
  }
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let pending:
    | {
        resolve: (result: NativePluginResult) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let active: Promise<NativePluginResult> | undefined;
  const fail = (error: Error) => {
    readyReject(error);
    pending?.reject(error);
  };
  child.once("error", fail);
  const closed = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      fail(
        new Error(`Native plugin child exited (${code ?? signal}): ${output}`),
      );
      resolve();
    });
  });
  child.on("message", (raw: unknown) => {
    const message = nativePluginMessageSchema.safeParse(raw);
    if (!message.success) {
      fail(message.error);
      return;
    }
    if (message.data.kind === "ready") readyResolve();
    else if (message.data.kind === "error")
      pending?.reject(new Error(message.data.message));
    else pending?.resolve(message.data.result);
  });
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    })();
    return stopping;
  };
  return {
    ready,
    stop,
    async idle() {
      await active?.catch(() => undefined);
    },
    run(
      request: NativePluginRequest,
      signal: AbortSignal,
    ): Promise<NativePluginResult> {
      signal.throwIfAborted();
      if (!child.connected)
        return Promise.reject(
          new Error(`Native plugin child is disconnected: ${output}`),
        );
      if (pending !== undefined)
        return Promise.reject(
          new Error("Native plugin child already has an active request"),
        );
      const abort = () => {
        void stop();
      };
      signal.addEventListener("abort", abort, { once: true });
      active = new Promise<NativePluginResult>((resolve, reject) => {
        pending = { resolve, reject };
        child.send(request, (error) => {
          if (error) reject(error);
        });
      }).finally(() => {
        pending = undefined;
        signal.removeEventListener("abort", abort);
      });
      return active;
    },
  };
}

describe("native plugin server loading", () => {
  const tempDirs: string[] = [];
  let native: ReturnType<typeof startNativePluginChild>;

  beforeAll(async () => {
    native = startNativePluginChild();
    await native.ready;
  }, 30_000);

  afterAll(async () => {
    await native?.stop();
  });

  afterEach(async () => {
    await native?.idle();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("resolves BB-provided externals in a native Node import", async ({
    signal,
  }) => {
    const workDir = await mkdtemp(join(tmpdir(), "bb-native-plugin-load-"));
    tempDirs.push(workDir);
    const rootDir = join(workDir, "plugin");
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-native-externals",
        version: "0.1.0",
        bb: {
          name: "Native externals fixture",
          description: "Exercises native plugin server loading.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), "throw new Error('source');");
    await writeFile(
      join(rootDir, "dist", "server.js"),
      `import { defineRpcContract } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";
export default function plugin() {
  const database = new Database(":memory:");
  database.close();
  globalThis.__nativeExternalTypes = [typeof defineRpcContract, typeof Database];
}
`,
    );
    await writeFile(
      join(rootDir, "dist", "server.meta.json"),
      JSON.stringify({
        sdkMajor: PLUGIN_SDK_MAJOR,
        sdkVersion: PLUGIN_SDK_VERSION,
      }),
    );
    const result = await native.run(
      { kind: "prebuilt", rootDir, dataDir: join(workDir, "data") },
      signal,
    );

    expect(result).toEqual({
      status: "running",
      statusDetail: null,
      types: ["function", "function"],
    });
  });

  it("loads a TypeScript source plugin through the cache in native Node", async ({
    signal,
  }) => {
    const workDir = await mkdtemp(join(tmpdir(), "bb-native-source-load-"));
    tempDirs.push(workDir);
    const rootDir = join(workDir, "plugin");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-native-source",
        version: "0.1.0",
        bb: {
          name: "Native source fixture",
          description: "Exercises cached source plugin loading.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(rootDir, "server.ts"),
      `import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
const value: string = "loaded";
export default function plugin(bb: BbPluginApi) {
  void bb;
  globalThis.__nativeSourceResult = [value, typeof defineRpcContract];
}
`,
    );
    const result = await native.run(
      { kind: "source", rootDir, dataDir: join(workDir, "data") },
      signal,
    );

    expect(result).toEqual({
      status: "running",
      statusDetail: null,
      value: ["loaded", "function"],
    });
  });

  it("preserves cross-plugin dynamic imports across source reloads", async ({
    signal,
  }) => {
    const workDir = await mkdtemp(join(tmpdir(), "bb-native-source-reload-"));
    tempDirs.push(workDir);
    const importedDir = join(workDir, "bb-plugin-imported");
    const importerDir = join(workDir, "bb-plugin-importer");
    await mkdir(importedDir, { recursive: true });
    await mkdir(importerDir, { recursive: true });
    const importedSharedSpecifier =
      process.platform === "win32"
        ? "../bb-plugin-imported/shared.js"
        : join(importedDir, "shared.js");
    const packageJson = (name: string) =>
      JSON.stringify({
        name,
        version: "0.1.0",
        type: "module",
        bb: {
          name,
          description: "Native reload fixture.",
          branding: { icon: "Zap" },
          server: "./server.js",
        },
      });
    await writeFile(
      join(importedDir, "package.json"),
      packageJson("bb-plugin-imported"),
    );
    await writeFile(
      join(importerDir, "package.json"),
      packageJson("bb-plugin-importer"),
    );
    await writeFile(
      join(importedDir, "server.js"),
      `export default function plugin() {}
`,
    );
    await writeFile(
      join(importedDir, "shared.js"),
      `export const value = "before";
`,
    );
    await writeFile(
      join(importerDir, "server.js"),
      `export default function plugin() {
  globalThis.__readImportedPlugin = async () =>
    (await import(${JSON.stringify(importedSharedSpecifier)})).value;
}
`,
    );
    const result = await native.run(
      {
        kind: "reload",
        importedDir,
        importerDir,
        dataDir: join(workDir, "data"),
      },
      signal,
    );

    expect(result).toEqual({ before: "before", after: "after" });
  });
});
