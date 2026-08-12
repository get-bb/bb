import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_NODE_MODULES_ABI,
  REQUIRED_NODE_RANGE,
  checkNodeRuntime,
} from "../../../scripts/check-node-version.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");
const scriptPath = resolve(repoRoot, "scripts/check-node-version.mjs");

describe("check-node-version", () => {
  it("accepts Node 22.19 patch releases with the expected ABI", () => {
    expect(
      checkNodeRuntime({ nodeVersion: "22.19.0", modulesAbi: "127" }),
    ).toEqual({ ok: true });
    expect(
      checkNodeRuntime({ nodeVersion: "22.19.9", modulesAbi: "127" }),
    ).toEqual({ ok: true });
  });

  it("rejects Node 25 and reports expected and actual runtime details", () => {
    const result = checkNodeRuntime({
      nodeVersion: "25.4.0",
      modulesAbi: "141",
    });

    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(
        /Expected Node 22\.19\.x .*127.*found Node 25\.4\.0 .*141/u,
      ),
    });
  });

  it("rejects the wrong ABI even when the Node version matches", () => {
    const result = checkNodeRuntime({
      nodeVersion: "22.19.0",
      modulesAbi: "141",
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("NODE_MODULE_VERSION 141"),
    });
  });

  it("keeps the root pins and lifecycle guard aligned", async () => {
    const [nodeVersion, nvmrc, packageJson] = await Promise.all([
      readFile(resolve(repoRoot, ".node-version"), "utf8"),
      readFile(resolve(repoRoot, ".nvmrc"), "utf8"),
      readFile(resolve(repoRoot, "package.json"), "utf8").then(JSON.parse),
    ]);

    expect(nodeVersion.trim()).toBe("22.19.0");
    expect(nvmrc.trim()).toBe("22.19.0");
    expect(packageJson.engines.node).toBe(REQUIRED_NODE_RANGE);
    expect(packageJson.scripts["pnpm:devPreinstall"]).toBe(
      "node scripts/check-node-version.mjs",
    );
    expect(packageJson.scripts.preinstall).toBe(
      "node scripts/check-node-version.mjs",
    );
    expect(REQUIRED_NODE_MODULES_ABI).toBe("127");
  });

  it("accepts the process running the repository test gate", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });
});
