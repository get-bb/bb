import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import {
  collectLogPayloads,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
} from "../helpers/command-output-harness.js";
import { installFakeNpm } from "../helpers/fake-npm.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const register = (program: Parameters<typeof registerPluginCommands>[0]) => {
  registerPluginCommands(program, () => "http://server");
};

setupCommandOutputTestEnvironment();

let rootDir: string;
let toolsDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "bb-cli-migrate-"));
  toolsDir = await mkdtemp(join(tmpdir(), "bb-cli-migrate-tools-"));
  await installFakeNpm(toolsDir);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
  await rm(toolsDir, { recursive: true, force: true });
});

async function writeManifest(value: Record<string, unknown>): Promise<void> {
  await writeFile(
    join(rootDir, "package.json"),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function writeVendoredPlugin(): Promise<void> {
  await writeManifest({
    name: "bb-plugin-legacy",
    version: "0.1.0",
    engines: { bbPluginSdk: ">=0.2.0" },
    bb: {
      name: "Legacy plugin",
      description: "Legacy SDK layout fixture.",
      branding: { icon: "Zap" },
      server: "./server.ts",
    },
    devDependencies: { typescript: "^5.7.0" },
  });
  await writeFile(
    join(rootDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          paths: { "@get-bb/plugin-sdk": ["./types/bb-plugin-sdk.d.ts"] },
        },
        include: ["server.ts", "types"],
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(rootDir, "types"), { recursive: true });
  await writeFile(join(rootDir, "types", "bb-plugin-sdk.d.ts"), "// old\n");
}

async function readManifest(): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(
    await readFile(join(rootDir, "package.json"), "utf8"),
  );
  return parsed as Record<string, unknown>;
}

function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
  });
}

describe("bb plugin migrate", () => {
  it("prints the plan and changes nothing without --yes on a non-TTY", async () => {
    await writeVendoredPlugin();
    setTty(false);
    const before = await readFile(join(rootDir, "package.json"), "utf8");
    const logSpy = vi.mocked(console.log);

    await expect(
      runCommand(["plugin", "migrate", rootDir], register),
    ).rejects.toThrow("process.exit:1");

    const logged = collectLogPayloads(logSpy).join("\n");
    expect(logged).toContain(
      `"@get-bb/plugin-sdk": (none) → ${PLUGIN_SDK_VERSION}`,
    );
    expect(logged).toContain("delete         types/bb-plugin-sdk.d.ts");
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(
      "Refusing to migrate without confirmation",
    );
    expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(before);
    expect(
      await stat(join(rootDir, "types", "bb-plugin-sdk.d.ts")).then(() => true),
    ).toBe(true);
  });

  it("migrates with --yes and reports the follow-up install", async () => {
    await writeVendoredPlugin();
    setTty(false);

    await runCommand(["plugin", "migrate", rootDir, "--yes"], register);

    const manifest = await readManifest();
    expect(
      (manifest.devDependencies as Record<string, string>)[
        "@get-bb/plugin-sdk"
      ],
    ).toBe(PLUGIN_SDK_VERSION);
    await expect(
      stat(join(rootDir, "types", "bb-plugin-sdk.d.ts")),
    ).rejects.toThrow();
    const logged = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(logged).toContain("Migrated to the @get-bb/plugin-sdk npm package.");
    expect(logged).toContain("Run `npm install`");
  });

  it("plans and applies the pre-rename import rewrite", async () => {
    await writeVendoredPlugin();
    await writeFile(
      join(rootDir, "server.ts"),
      'import type { BbPluginApi } from "@bb/plugin-sdk";\nimport "@bb/plugin-sdk/testing";\n',
    );
    setTty(false);

    await runCommand(["plugin", "migrate", rootDir, "--yes"], register);

    const logged = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(logged).toContain(
      'rewrite        server.ts (2 imports of "@bb/plugin-sdk" → "@get-bb/plugin-sdk")',
    );
    expect(await readFile(join(rootDir, "server.ts"), "utf8")).toBe(
      'import type { BbPluginApi } from "@get-bb/plugin-sdk";\nimport "@get-bb/plugin-sdk/testing";\n',
    );
    expect((await readManifest()).dependencies).toEqual({
      "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION,
    });
    await runCommand(["plugin", "types", rootDir, "--check"], register);
  });

  it("reports an already-migrated plugin without touching it", async () => {
    await writeManifest({
      name: "bb-plugin-modern",
      engines: { bbPluginSdk: `>=${PLUGIN_SDK_VERSION}` },
      bb: { server: "./server.ts" },
      devDependencies: { "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION },
    });
    const before = await readFile(join(rootDir, "package.json"), "utf8");

    await runCommand(["plugin", "migrate", rootDir], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "Already migrated",
    );
    expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(before);
  });

  it("pins a package-layout plugin that never got the devDependency", async () => {
    await writeManifest({
      name: "bb-plugin-pinless",
      bb: { server: "./server.ts" },
      devDependencies: { typescript: "^5.7.0" },
    });
    setTty(false);

    await runCommand(["plugin", "migrate", rootDir, "--yes"], register);

    const manifest = await readManifest();
    expect(
      (manifest.devDependencies as Record<string, string>)[
        "@get-bb/plugin-sdk"
      ],
    ).toBe(PLUGIN_SDK_VERSION);
    expect((manifest.engines as Record<string, string>).bbPluginSdk).toBe(
      `>=${PLUGIN_SDK_VERSION}`,
    );
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).not.toContain(
      "Already migrated",
    );
  });

  it.each(["declarations", "entry imports"])(
    "aborts when %s change between the plan and the confirmation",
    async (change) => {
      await writeVendoredPlugin();
      setTty(true);
      readlineMocks.question.mockImplementation(async () => {
        if (change === "declarations") {
          await writeFile(
            join(rootDir, "types", "bb-plugin-sdk-app.d.ts"),
            "// appeared mid-prompt\n",
          );
        } else {
          await writeFile(
            join(rootDir, "server.ts"),
            'import "@get-bb/plugin-sdk/process";',
          );
        }
        return "y";
      });
      const before = await readFile(join(rootDir, "package.json"), "utf8");

      await expect(
        runCommand(["plugin", "migrate", rootDir], register),
      ).rejects.toThrow("process.exit:1");

      expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(
        "changed while awaiting confirmation",
      );
      expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(
        before,
      );
      expect(
        await stat(join(rootDir, "types", "bb-plugin-sdk.d.ts")).then(
          () => true,
        ),
      ).toBe(true);
    },
  );
});

describe("bb plugin dev stale-pin warning", () => {
  function stubEmptyPluginList(): void {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ plugins: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
  }

  it("warns when an exact pin differs from this bb's SDK version", async () => {
    await writeManifest({
      name: "bb-plugin-modern",
      bb: { server: "./server.ts" },
      devDependencies: { "@get-bb/plugin-sdk": "0.2.0" },
    });
    stubEmptyPluginList();

    await expect(
      runCommand(["plugin", "dev", rootDir], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.warn).mock.calls.flat().join("\n")).toContain(
      `This plugin pins @get-bb/plugin-sdk 0.2.0; this bb's SDK is ${PLUGIN_SDK_VERSION}`,
    );
  });

  it("stays quiet for a matching pin and for a range", async () => {
    await writeManifest({
      name: "bb-plugin-modern",
      bb: { server: "./server.ts" },
      devDependencies: { "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION },
    });
    stubEmptyPluginList();
    await expect(
      runCommand(["plugin", "dev", rootDir], register),
    ).rejects.toThrow("process.exit:1");

    await writeManifest({
      name: "bb-plugin-modern",
      bb: { server: "./server.ts" },
      devDependencies: { "@get-bb/plugin-sdk": "^0.2.0" },
    });
    stubEmptyPluginList();
    await expect(
      runCommand(["plugin", "dev", rootDir], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.warn).mock.calls.flat().join("\n")).not.toContain(
      "This plugin pins @get-bb/plugin-sdk",
    );
  });
});

describe("legacy vendored SDK layout", () => {
  const message =
    "This plugin uses the legacy vendored SDK layout. Its SDK types will not be updated.\n" +
    "Please run `bb plugin migrate` to update to the latest SDK types.";

  it.each([false, true])(
    "requires migration for bb plugin types with check=%s",
    async (check) => {
      await writeVendoredPlugin();
      const declarationsPath = join(rootDir, "types", "bb-plugin-sdk.d.ts");
      const before = await readFile(declarationsPath, "utf8");

      await expect(
        runCommand(
          ["plugin", "types", rootDir, ...(check ? ["--check"] : [])],
          register,
        ),
      ).rejects.toThrow("process.exit:1");

      expect(vi.mocked(console.error)).toHaveBeenCalledWith(message);
      expect(await readFile(declarationsPath, "utf8")).toBe(before);
    },
  );

  it("warns and continues bb plugin dev", async () => {
    await writeVendoredPlugin();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ plugins: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      runCommand(["plugin", "dev", rootDir], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(message);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(
      "This directory is not installed as a plugin",
    );
  });

  it("warns and continues bb plugin build", async () => {
    await writeVendoredPlugin();
    await writeFile(join(rootDir, "server.ts"), "export default () => {};\n");

    await runCommand(["plugin", "build", rootDir], register);

    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(message);
    await expect(
      stat(join(rootDir, "dist", "server.js")),
    ).resolves.toBeDefined();
  });
});

describe("bb plugin types on a package-layout plugin", () => {
  async function writeHostPlugin(
    field: "dependencies" | "devDependencies",
    hostSource: string,
  ): Promise<void> {
    await writeManifest({
      name: "bb-plugin-provider",
      bb: { server: "./server.ts", host: "./host.ts" },
      [field]: { "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION },
    });
    await writeFile(join(rootDir, "server.ts"), "export default () => {};\n");
    await writeFile(join(rootDir, "host.ts"), hostSource);
  }

  const providerBridgeHost =
    'import { experimental_defineProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";\nexport const bridge = experimental_defineProviderBridge;\n';

  it("keeps the SDK in dependencies when the host entry imports the provider bridge", async () => {
    await writeHostPlugin("dependencies", providerBridgeHost);
    const before = await readFile(join(rootDir, "package.json"), "utf8");

    await runCommand(["plugin", "types", rootDir, "--check"], register);
    await runCommand(["plugin", "types", rootDir], register);

    expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(before);
  });

  it("--check asks to move a provider-bridge SDK pin to dependencies", async () => {
    await writeHostPlugin("devDependencies", providerBridgeHost);

    await expect(
      runCommand(["plugin", "types", rootDir, "--check"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(
      'Move "@get-bb/plugin-sdk" from devDependencies to dependencies — host.ts imports "@get-bb/plugin-sdk/provider-bridge", which the build bundles from the plugin\'s own SDK install, and Git installs omit devDependencies (`bb plugin types` does it for you).',
    );

    await runCommand(["plugin", "types", rootDir], register);

    const manifest = await readManifest();
    expect(manifest.dependencies).toEqual({
      "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION,
    });
    expect(manifest.devDependencies).toBeUndefined();
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "Moved @get-bb/plugin-sdk from devDependencies to dependencies.",
    );
  });

  const providerBridgeReason =
    'host.ts imports "@get-bb/plugin-sdk/provider-bridge", which the build bundles from the plugin\'s own SDK install, and Git installs omit devDependencies (`bb plugin types` does it for you).';

  it.each([
    {
      name: "a duplicate pin in devDependencies",
      fields: {
        dependencies: { "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION },
        devDependencies: { "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION },
      },
      check: `Remove the duplicate "@get-bb/plugin-sdk" from devDependencies; keep it in dependencies — ${providerBridgeReason}`,
      applied:
        "Removed the duplicate @get-bb/plugin-sdk from devDependencies; it stays in dependencies.",
    },
    {
      name: "a duplicate pin with a stale version",
      fields: {
        dependencies: { "@get-bb/plugin-sdk": "0.2.0" },
        devDependencies: { "@get-bb/plugin-sdk": "0.2.0" },
      },
      check: `Remove the duplicate "@get-bb/plugin-sdk" from devDependencies, set it to ${PLUGIN_SDK_VERSION} in dependencies, and re-run npm install — ${providerBridgeReason}`,
      applied:
        "Removed the duplicate @get-bb/plugin-sdk from devDependencies; it stays in dependencies.",
    },
    {
      name: "a stale pin in the wrong field",
      fields: { devDependencies: { "@get-bb/plugin-sdk": "0.2.0" } },
      check: `Move "@get-bb/plugin-sdk" from devDependencies to dependencies at ${PLUGIN_SDK_VERSION} and re-run npm install — ${providerBridgeReason}`,
      applied: "Moved @get-bb/plugin-sdk from devDependencies to dependencies.",
    },
    {
      name: "no SDK pin",
      fields: {},
      check: `Add "@get-bb/plugin-sdk" ${PLUGIN_SDK_VERSION} to dependencies and run npm install — ${providerBridgeReason}`,
      applied: `@get-bb/plugin-sdk: (not declared) → ${PLUGIN_SDK_VERSION} in dependencies.`,
    },
  ])(
    "--check names every fix for $name on a provider-bridge plugin",
    async ({ fields, check, applied }) => {
      await writeManifest({
        name: "bb-plugin-provider",
        bb: { server: "./server.ts", host: "./host.ts" },
        ...fields,
      });
      await writeFile(join(rootDir, "server.ts"), "export default () => {};\n");
      await writeFile(join(rootDir, "host.ts"), providerBridgeHost);

      await expect(
        runCommand(["plugin", "types", rootDir, "--check"], register),
      ).rejects.toThrow("process.exit:1");
      expect(vi.mocked(console.error).mock.calls.flat()).toContain(check);

      await runCommand(["plugin", "types", rootDir], register);

      const manifest = await readManifest();
      expect(manifest.dependencies).toEqual({
        "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION,
      });
      expect(manifest.devDependencies).toBeUndefined();
      expect(collectLogPayloads(vi.mocked(console.log))).toContain(applied);
      await runCommand(["plugin", "types", rootDir, "--check"], register);
    },
  );

  it("still moves a stub-only host entry's SDK pin to devDependencies", async () => {
    await writeHostPlugin(
      "dependencies",
      'import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";\nexport default experimental_defineHostEntry;\n',
    );

    await runCommand(["plugin", "types", rootDir], register);

    const manifest = await readManifest();
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toEqual({
      "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION,
    });
  });

  it("repoints an outdated pin to the running host's SDK version", async () => {
    await writeManifest({
      name: "bb-plugin-modern",
      engines: { bbPluginSdk: ">=0.2.0" },
      bb: { server: "./server.ts" },
      devDependencies: { "@get-bb/plugin-sdk": "0.2.0" },
    });

    await runCommand(["plugin", "types", rootDir], register);

    const manifest = await readManifest();
    expect(
      (manifest.devDependencies as Record<string, string>)[
        "@get-bb/plugin-sdk"
      ],
    ).toBe(PLUGIN_SDK_VERSION);
    expect((manifest.engines as Record<string, string>).bbPluginSdk).toBe(
      ">=0.2.0",
    );
    const logged = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(logged).toContain(`0.2.0 → ${PLUGIN_SDK_VERSION}`);
    expect(logged).toContain("Run `npm install`");
  });

  it("--check reports the mismatch and writes nothing", async () => {
    await writeManifest({
      name: "bb-plugin-modern",
      bb: { server: "./server.ts" },
      devDependencies: { "@get-bb/plugin-sdk": "0.2.0" },
    });
    const before = await readFile(join(rootDir, "package.json"), "utf8");

    await expect(
      runCommand(["plugin", "types", rootDir, "--check"], register),
    ).rejects.toThrow("process.exit:1");

    expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(before);
  });

  it("is a no-op when the pin already matches", async () => {
    await writeManifest({
      name: "bb-plugin-modern",
      bb: { server: "./server.ts" },
      devDependencies: { "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION },
    });
    const before = await readFile(join(rootDir, "package.json"), "utf8");

    await runCommand(["plugin", "types", rootDir], register);

    expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(before);
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      `already pinned to ${PLUGIN_SDK_VERSION}`,
    );
  });
});
