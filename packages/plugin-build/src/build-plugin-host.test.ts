import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPluginHost } from "./build-plugin-host.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

function testToolchain() {
  return resolvePluginBuildToolchain(join(process.cwd(), ".unused-toolchain"));
}

describe("plugin host build", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("builds a self-contained Node artifact with identity and digest metadata", async () => {
    // Keep the fixture outside the workspace so this proves the build does
    // not accidentally resolve the SDK from BB's own node_modules tree.
    const dir = await mkdtemp(join(tmpdir(), "bb-host-build-test-"));
    tempDirs.push(dir);
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-host-build-fixture",
        version: "1.2.3",
        engines: { bb: ">=0.0" },
        bb: {
          name: "Host fixture",
          description: "Exercises the host artifact builder.",
          branding: { icon: "Cpu" },
          server: "./server.ts",
          host: "./host.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(dir, "host.ts"),
      [
        'import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";',
        'import { experimental_defineHostRpcContract } from "@get-bb/plugin-sdk";',
        'const schema = { "~standard": { validate(value: unknown) { return { value }; } } };',
        "const contract = experimental_defineHostRpcContract({ methods: { echo: {",
        '  target: { kind: "host" },',
        "  input: schema,",
        "  output: schema,",
        "} } });",
        "export default experimental_defineHostEntry({",
        "  contract,",
        "  handlers: { echo: (input) => input },",
        "});",
        "",
      ].join("\n"),
    );

    const result = await buildPluginHost(
      dir,
      "0.9.0-test",
      await testToolchain(),
    );
    const bytes = await readFile(result.jsPath);
    const bundle = bytes.toString("utf8");
    const metadata = JSON.parse(await readFile(result.metaPath, "utf8")) as {
      pluginId: string;
      pluginVersion: string;
      builtWith: { bbVersion: string };
      artifactDigest: string;
    };

    expect(bundle).not.toMatch(/from\s+["']@get-bb\/plugin-sdk/u);
    expect(metadata).toMatchObject({
      pluginId: "host-build-fixture",
      pluginVersion: "1.2.3",
      builtWith: { bbVersion: "0.9.0-test" },
      artifactDigest: result.artifactDigest,
    });
    expect(result.artifactDigest).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );

    const builtEntry = (await import(result.jsPath)) as {
      default: {
        experimental_apiVersion: number;
        handlers: { echo: (input: string) => string };
      };
    };
    expect(builtEntry.default.experimental_apiVersion).toBe(1);
    expect(builtEntry.default.handlers.echo("from-artifact")).toBe(
      "from-artifact",
    );
  });

  it("rejects a host entry outside the plugin directory", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".host-build-escape-test-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-host-escape-fixture",
        version: "1.0.0",
        engines: { bb: ">=0.0" },
        bb: {
          name: "Escape fixture",
          description: "Invalid host path.",
          branding: { icon: "Cpu" },
          server: "./server.ts",
          host: "../host.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );

    await expect(
      buildPluginHost(dir, "0.9.0-test", await testToolchain()),
    ).rejects.toThrow(/escapes the plugin directory/u);
  });

  it("rejects private BB workspace imports from host entries", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".host-build-private-test-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-host-private-fixture",
        version: "1.0.0",
        engines: { bb: ">=0.0" },
        bb: {
          name: "Private import fixture",
          description: "Invalid host dependency.",
          branding: { icon: "Cpu" },
          server: "./server.ts",
          host: "./host.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(dir, "host.ts"),
      'import value from "./helper.js";\nexport default value;\n',
    );
    await writeFile(
      join(dir, "helper.ts"),
      'import type { JsonValue } from "@bb/domain";\nexport default function helper(value: JsonValue) { return value; }\n',
    );

    await expect(
      buildPluginHost(dir, "0.9.0-test", await testToolchain()),
    ).rejects.toThrow(/cannot import private BB workspace package/u);
  });

  it("rejects relative type imports into private BB workspace packages", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bb-host-relative-private-"));
    tempDirs.push(parent);
    const dir = join(parent, "plugin");
    const privatePackage = join(parent, "private-package");
    await mkdir(dir, { recursive: true });
    await mkdir(privatePackage, { recursive: true });
    await writeFile(
      join(privatePackage, "package.json"),
      JSON.stringify({ name: "@bb/private-fixture", type: "module" }),
    );
    await writeFile(
      join(privatePackage, "index.ts"),
      "export type PrivateValue = string;\n",
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-relative-private-fixture",
        version: "1.0.0",
        engines: { bb: ">=0.0" },
        bb: {
          name: "Relative private import fixture",
          description: "Invalid relative host dependency.",
          branding: { icon: "Cpu" },
          server: "./server.ts",
          host: "./host.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(dir, "host.ts"),
      'import type { PrivateValue } from "../private-package/index.js";\nconst value: PrivateValue = "nope";\nexport default value;\n',
    );

    await expect(
      buildPluginHost(dir, "0.9.0-test", await testToolchain()),
    ).rejects.toThrow(/@bb\/private-fixture/u);
  });

  it("allows private package names in comments and diagnostic strings", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".host-build-prose-test-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-host-prose-fixture",
        version: "1.0.0",
        engines: { bb: ">=0.0" },
        bb: {
          name: "Prose fixture",
          description: "Valid host source.",
          branding: { icon: "Cpu" },
          server: "./server.ts",
          host: "./host.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(dir, "host.ts"),
      '// Do not import from "@bb/domain".\nexport default "import type X from \'@bb/domain\'";\n',
    );

    await expect(
      buildPluginHost(dir, "0.9.0-test", await testToolchain()),
    ).resolves.toMatchObject({ artifactDigest: expect.any(String) });
  });
});
