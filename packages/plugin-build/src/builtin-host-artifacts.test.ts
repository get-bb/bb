import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonValue } from "@bb/domain";
import { buildPluginHost } from "./build-plugin-host.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

interface BuiltProviderBridge {
  readonly experimental_apiVersion: 1;
  readonly handleLine: (line: string) => void;
}

interface BuiltHostContext {
  readonly signal: AbortSignal;
  readonly lifecycle: { readonly signal: AbortSignal };
  readonly experimental_retainWorker: () => {
    readonly dispose: () => Promise<void>;
  };
}

type BuiltHostHandler = (
  input: JsonValue,
  context: BuiltHostContext,
) => JsonValue | Promise<JsonValue>;
interface BuiltHostEntry {
  readonly experimental_apiVersion: 1;
  readonly contract: object;
  readonly handlers: Readonly<Record<string, BuiltHostHandler>>;
}

interface BuiltHostModule {
  readonly default: BuiltHostEntry;
  readonly experimental_providerBridge?: BuiltProviderBridge;
}

describe("builtin host artifacts", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("builds and executes the self-contained Keep Awake artifact", async () => {
    const root = await mkdtemp(join(repositoryRoot, ".builtin-host-test-"));
    tempDirs.push(root);
    const source = join(repositoryRoot, "plugins", "keep-awake");
    for (const fileName of [
      "package.json",
      "server.ts",
      "contract.ts",
      "host.ts",
    ]) {
      await cp(join(source, fileName), join(root, fileName));
    }
    await symlink(
      join(source, "node_modules"),
      join(root, "node_modules"),
      "dir",
    );
    const toolchain = await resolvePluginBuildToolchain(
      join(repositoryRoot, "node_modules", ".unused-toolchain"),
    );
    const built = await buildPluginHost(root, "0.9.0-test", toolchain);
    // SAFETY: buildPluginHost emits the host module contract used by this test.
    const imported = (await import(
      `${pathToFileURL(built.jsPath).href}?test=${Date.now()}`
    )) as BuiltHostModule;
    const entry = imported.default;

    const result = await entry.handlers.setEnabled?.(
      { enabled: false },
      {
        signal: new AbortController().signal,
        lifecycle: { signal: new AbortController().signal },
        experimental_retainWorker: () => ({
          dispose: async () => undefined,
        }),
      },
    );

    expect(result).toEqual({
      enabled: false,
      supported: process.platform === "darwin",
    });
  }, 20_000);

  it.each([
    {
      pluginDir: "provider-acp",
      methods: ["probeAgent", "resolveNativeRoots"],
    },
    { pluginDir: "provider-claude-code", methods: ["resolveNativeRoots"] },
    { pluginDir: "provider-codex", methods: ["resolveNativeRoots"] },
    { pluginDir: "provider-pi", methods: ["resolveNativeRoots"] },
  ])(
    "builds the $pluginDir host entry that serves a host contract beside its bridge",
    async ({ pluginDir, methods }) => {
      const root = await mkdtemp(join(repositoryRoot, ".builtin-host-test-"));
      tempDirs.push(root);
      const source = join(repositoryRoot, "plugins", pluginDir);
      for (const fileName of ["package.json", "server.ts"]) {
        await cp(join(source, fileName), join(root, fileName));
      }
      await cp(join(source, "src"), join(root, "src"), { recursive: true });
      await cp(join(source, "icons"), join(root, "icons"), { recursive: true });
      await symlink(
        join(source, "node_modules"),
        join(root, "node_modules"),
        "dir",
      );
      const toolchain = await resolvePluginBuildToolchain(
        join(repositoryRoot, "node_modules", ".unused-toolchain"),
      );
      const built = await buildPluginHost(root, "0.9.0-test", toolchain);
      // SAFETY: buildPluginHost emits the host module contract used by this test.
      const imported = (await import(
        `${pathToFileURL(built.jsPath).href}?test=${Date.now()}`
      )) as BuiltHostModule;
      expect(imported.experimental_providerBridge).toMatchObject({
        experimental_apiVersion: 1,
        handleLine: expect.any(Function),
      });
      const entry = imported.default;
      expect(Object.keys(entry.contract)).toEqual(
        expect.arrayContaining(methods),
      );
    },
    90_000,
  );
});
