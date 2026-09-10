import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPreparedRuntime,
  clearRuntimeOutputs,
  runtimeOutputRoots,
  runtimeSourceFingerprint,
  sealPreparedRuntime,
  validatePreparedRuntime,
} from "../../../scripts/prepared-runtime.mjs";

const roots = [];
function write(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bb-prepared-runtime-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  write(
    root,
    ".gitignore",
    "node_modules\ndist\ngenerated\nbuiltin-plugins\nbundled-types\n",
  );
  write(root, "plugin.ts", "export const value = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root });
  write(root, "node_modules/.modules.yaml", "installed\n");
  write(root, "node_modules/.pnpm/lock.yaml", "lock\n");
  for (const path of runtimeOutputRoots)
    write(root, `${path}/artifact`, "prepared\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("prepared runtime", () => {
  it("requires a valid receipt and detects artifact deletion, corruption, and unexpected files", async () => {
    const root = fixture();
    await expect(validatePreparedRuntime(root)).rejects.toThrow(
      "pnpm prepare:worktree",
    );
    await sealPreparedRuntime(root, runtimeSourceFingerprint(root));
    await expect(validatePreparedRuntime(root)).resolves.toBeUndefined();
    const artifact = `${runtimeOutputRoots[0]}/artifact`;
    rmSync(join(root, artifact));
    await expect(validatePreparedRuntime(root)).rejects.toThrow(
      "pnpm prepare:worktree",
    );
    write(root, artifact, "corrupt");
    await expect(validatePreparedRuntime(root)).rejects.toThrow(
      "Prepared artifacts changed",
    );
    write(root, artifact, "prepared\n");
    write(root, `${runtimeOutputRoots[0]}/stale`, "old output");
    await expect(validatePreparedRuntime(root)).rejects.toThrow(
      "Prepared artifacts changed",
    );
    await clearRuntimeOutputs(root);
    await expect(validatePreparedRuntime(root)).rejects.toThrow(
      "pnpm prepare:worktree",
    );
  });

  it.each([
    ["plugin.ts", "export const value = 2;\n"],
    ["new-asset.svg", "<svg/>"],
    [".env.local", "VITE_VALUE=changed"],
    ["apps/app/.env.production", "VITE_VALUE=changed"],
    ["node_modules/.modules.yaml", "reinstalled"],
    ["node_modules/.pnpm/lock.yaml", "new dependencies"],
  ])("rejects changes to %s without running a build", async (path, value) => {
    const root = fixture();
    await sealPreparedRuntime(root, runtimeSourceFingerprint(root));
    write(root, path, value);
    await expect(validatePreparedRuntime(root)).rejects.toThrow(
      "Prepared sources",
    );
  });

  it("handles tracked deletions and refuses to seal a build edited during preparation", async () => {
    const root = fixture();
    const before = runtimeSourceFingerprint(root);
    rmSync(join(root, "plugin.ts"));
    expect(runtimeSourceFingerprint(root)).not.toBe(before);
    await expect(sealPreparedRuntime(root, before)).rejects.toThrow(
      "Sources changed during preparation",
    );
    await sealPreparedRuntime(root, runtimeSourceFingerprint(root));
    await expect(validatePreparedRuntime(root)).resolves.toBeUndefined();
    await clearPreparedRuntime(root);
    await expect(validatePreparedRuntime(root)).rejects.toThrow(
      "pnpm prepare:worktree",
    );
  });

  it("clears stale per-plugin staging without touching individual plugin builds", async () => {
    const root = fixture();
    write(root, "plugins/example/.bundled-runtime/example/obsolete", "stale");
    write(root, "plugins/example/dist/server.js", "owned by plugin build");
    await clearRuntimeOutputs(root);
    expect(() =>
      readFileSync(
        join(root, "plugins/example/.bundled-runtime/example/obsolete"),
      ),
    ).toThrow();
    expect(
      readFileSync(join(root, "plugins/example/dist/server.js"), "utf8"),
    ).toBe("owned by plugin build");
  });

  it("rejects malformed or incompatible receipts", async () => {
    const root = fixture();
    for (const receipt of [
      "{",
      "null",
      '{"version":2}',
      '{"version":1,"sourceFingerprint":42}',
    ]) {
      write(root, "node_modules/.bb-prepared-runtime.json", receipt);
      await expect(validatePreparedRuntime(root)).rejects.toThrow(
        "pnpm prepare:worktree",
      );
    }
  });

  it("binds preparation to the checkout and build environment", async () => {
    const root = fixture();
    const other = fixture();
    expect(runtimeSourceFingerprint(root, { NODE_ENV: "production" })).not.toBe(
      runtimeSourceFingerprint(root, { NODE_ENV: "development" }),
    );
    expect(runtimeSourceFingerprint(root, { VITE_KEY: "a" })).not.toBe(
      runtimeSourceFingerprint(root, { VITE_KEY: "b" }),
    );
    await sealPreparedRuntime(root, runtimeSourceFingerprint(root));
    write(
      other,
      "node_modules/.bb-prepared-runtime.json",
      readFileSync(join(root, "node_modules/.bb-prepared-runtime.json")),
    );
    await expect(validatePreparedRuntime(other)).rejects.toThrow(
      "Prepared sources",
    );
  });
});
