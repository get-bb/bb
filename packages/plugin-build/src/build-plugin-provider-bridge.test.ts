import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPluginProviderBridge } from "./build-plugin-provider-bridge.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

/** The monorepo's own toolchain; resolves esbuild without downloading. */
function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));
}

async function writeFixture(dir: string, bridgeEntry = "./src/bridge.ts") {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-bridge-fixture",
      version: "0.0.0",
      bb: {
        name: "Bridge fixture",
        description: "Verifies the provider bridge build target.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        providerBridge: bridgeEntry,
      },
    }),
  );
  await writeFile(join(dir, "server.ts"), "export default function () {}\n");
}

describe("plugin provider bridge build", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("emits a self-contained bundle whose meta hashes the exact bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-bridge-"));
    tempDirs.push(dir);
    await writeFixture(dir);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "src"), { recursive: true });
    // A local import proves bundling; a node builtin proves builtins stay
    // external (the daemon's node provides them).
    await writeFile(
      join(dir, "src", "helper.ts"),
      'export const HELLO = "hello-from-helper";\n',
    );
    await writeFile(
      join(dir, "src", "bridge.ts"),
      [
        'import { createHash } from "node:crypto";',
        'import { HELLO } from "./helper.js";',
        "export function handleLine(line: string): string {",
        '  return createHash("sha256").update(HELLO + line).digest("hex");',
        "}",
        "",
      ].join("\n"),
    );

    const result = await buildPluginProviderBridge(dir, await testToolchain());

    expect(result.jsPath).toBe(join(dir, "dist", "provider-bridge.mjs"));
    const bundleBytes = await readFile(result.jsPath);
    const bundle = bundleBytes.toString("utf8");
    // Local import inlined; node builtin left as an import.
    expect(bundle).toContain("hello-from-helper");
    expect(bundle).toContain("node:crypto");
    expect(bundle).not.toContain('from "./helper');

    const expectedSha = createHash("sha256").update(bundleBytes).digest("hex");
    expect(result.sha256).toBe(expectedSha);
    expect(result.byteLength).toBe(bundleBytes.byteLength);
    expect(JSON.parse(await readFile(result.metaPath, "utf8"))).toEqual({
      sha256: expectedSha,
      byteLength: bundleBytes.byteLength,
    });
  });

  it("rejects a manifest without bb.providerBridge", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-bridge-none-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-bridge-fixture",
        version: "0.0.0",
        bb: {
          name: "Bridge fixture",
          description: "No bridge declared.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(dir, "server.ts"), "export default function () {}\n");

    await expect(
      buildPluginProviderBridge(dir, await testToolchain()),
    ).rejects.toThrow(/no provider bridge entry/);
  });

  it("rejects entries escaping the plugin directory and missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-bridge-escape-"));
    tempDirs.push(dir);
    await writeFixture(dir, "../outside.ts");
    await expect(
      buildPluginProviderBridge(dir, await testToolchain()),
    ).rejects.toThrow(/escapes the plugin directory/);

    await writeFixture(dir, "./src/missing.ts");
    await expect(
      buildPluginProviderBridge(dir, await testToolchain()),
    ).rejects.toThrow(/missing file/);
  });
});
