import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildPluginHost } from "./build-plugin-host.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

interface BuiltHostEntry {
  readonly experimental_apiVersion: 1;
  readonly handlers: Readonly<
    Record<string, (input: unknown, context: unknown) => unknown>
  >;
}

function isBuiltHostEntry(value: unknown): value is BuiltHostEntry {
  if (typeof value !== "object" || value === null) return false;
  return (
    Reflect.get(value, "experimental_apiVersion") === 1 &&
    typeof Reflect.get(value, "handlers") === "object"
  );
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
    const imported: unknown = await import(
      `${pathToFileURL(built.jsPath).href}?test=${Date.now()}`
    );
    const entry = Reflect.get(Object(imported), "default");
    if (!isBuiltHostEntry(entry)) {
      throw new Error("Keep Awake did not build a valid host entry");
    }

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
});
