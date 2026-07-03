import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import { buildPluginServer } from "@bb/plugin-build";

const FIXTURE_PACKAGE_JSON = JSON.stringify(
  {
    name: "bb-plugin-server-fixture",
    version: "0.1.0",
    type: "module",
    bb: { server: "./server.ts" },
  },
  null,
  2,
);

// A local import that must be inlined, and a type-only SDK import that must
// be fully erased (no runtime `@bb/plugin-sdk` import in the bundle).
const FIXTURE_LIB_TS = `export const greeting = "PREBUILT_LIB_MARKER";\n`;
const FIXTURE_SERVER_TS = `
import type { BbPluginApi } from "@bb/plugin-sdk";
import { greeting } from "./lib.ts";

export default function plugin(bb: BbPluginApi): void {
  bb.log.info(greeting);
}
`;

describe("buildPluginServer", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-plugin-server-build-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeFixture(): Promise<void> {
    await writeFile(join(root, "package.json"), FIXTURE_PACKAGE_JSON);
    await writeFile(join(root, "lib.ts"), FIXTURE_LIB_TS);
    await writeFile(join(root, "server.ts"), FIXTURE_SERVER_TS);
  }

  it("bundles the server entry into a self-contained ESM dist/server.js with a meta sidecar", async () => {
    await writeFixture();
    const result = await buildPluginServer(root);

    expect(result.jsPath).toBe(join(root, "dist", "server.js"));
    const js = await readFile(result.jsPath, "utf8");
    // ESM output, local deps inlined.
    expect(js).toMatch(/export\s*\{|export default/);
    expect(js).toContain("PREBUILT_LIB_MARKER");
    // The SDK import was type-only — nothing of it may survive at runtime.
    expect(js).not.toContain("@bb/plugin-sdk");
    // CJS-dep shim banner (createRequire) is present.
    expect(js).toContain("createRequire");

    const map = await readFile(result.mapPath, "utf8");
    expect(JSON.parse(map)).toMatchObject({ version: 3 });

    const meta = JSON.parse(await readFile(result.metaPath, "utf8"));
    expect(meta).toEqual({
      sdkMajor: PLUGIN_SDK_MAJOR,
      sdkVersion: PLUGIN_SDK_VERSION,
    });
  });

  it("keeps a runtime @bb/plugin-sdk import external (bare specifier survives)", async () => {
    await writeFixture();
    await writeFile(
      join(root, "server.ts"),
      `
      import { greeting } from "./lib.ts";
      import * as sdk from "@bb/plugin-sdk";

      export default function plugin(bb: { log: { info(msg: string): void } }): void {
        bb.log.info(greeting + Object.keys(sdk).length);
      }
      `,
    );
    const result = await buildPluginServer(root);
    const js = await readFile(result.jsPath, "utf8");
    expect(js).toMatch(/from\s*"@bb\/plugin-sdk"/);
  });

  it("errors clearly when package.json has no bb.server entry", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "bb-plugin-headless", version: "0.1.0" }),
    );
    await expect(buildPluginServer(root)).rejects.toThrowError(
      /no server entry/,
    );
  });

  it("preserves the previous dist/server.js when a rebuild fails", async () => {
    await writeFixture();
    const first = await buildPluginServer(root);
    const before = await readFile(first.jsPath, "utf8");
    const metaBefore = await readFile(first.metaPath, "utf8");

    // Break the entry: the failed rebuild must not clobber the previous
    // artifacts (they are staged and only renamed into place on success).
    await writeFile(join(root, "server.ts"), "export default function ( {\n");
    await expect(buildPluginServer(root)).rejects.toThrowError();

    expect(await readFile(first.jsPath, "utf8")).toBe(before);
    expect(await readFile(first.metaPath, "utf8")).toBe(metaBefore);
  });
});
