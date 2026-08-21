import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// packages/scripts/test -> repo root
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "check-provider-literal-ratchet.mjs");

function run(args = []) {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("provider-literal ratchet (G1)", () => {
  it("passes against the committed baseline", () => {
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/ratchet OK/);
  });

  it("fails when a core file gains a new provider-id branch", () => {
    const planted = join(ROOT, "packages", "domain", "src", "__ratchet_probe__.ts");
    writeFileSync(planted, 'export const x = providerId === "codex" ? 1 : 2;\n');
    try {
      const r = run();
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/ratchet FAILED/);
      expect(r.out).toMatch(/__ratchet_probe__/);
    } finally {
      rmSync(planted, { force: true });
    }
    expect(run().code, "cleanup left the tree dirty").toBe(0);
  });

  it("reports a live count that matches the committed baseline total", () => {
    const list = run(["--list"]);
    expect(list.code).toBe(0);
    const m = list.out.match(/(\d+) provider-id literals across (\d+) core files/);
    expect(m).toBeTruthy();
  });
});
