// M3 exit criterion (k), strengthened: the server validates workflow scripts
// purely structurally (shared meta parser + static lint); author JS only ever
// executes inside the daemon's runner child sandbox. Three structural
// invariants over apps/server/src, enforced as one canonical test:
//   1. no reference to the vm module (`grep -rn "node:vm"` stays empty);
//   2. no import of the @bb/workflow-runtime BARREL — the barrel re-exports
//      `runInSandbox` from sandbox.ts (the one vm-importing module), so a
//      barrel import would pull node:vm into the server's module graph;
//      server code must use the vm-free `@bb/workflow-runtime/validation`
//      subpath instead;
//   3. no reference to the sandbox execution surface (`runInSandbox`) — the
//      realistic regression vector a node:vm grep alone would never catch.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Concatenated so a repo-wide grep for the forbidden specifier never matches
// this test file itself.
const FORBIDDEN_VM_SPECIFIER = "node:" + "vm";
const FORBIDDEN_SANDBOX_SURFACE = "runIn" + "Sandbox";
// The bare barrel specifier in an import/export/require position. The
// vm-free subpath `@bb/workflow-runtime/validation` does not match.
const FORBIDDEN_BARREL_IMPORT = /["']@bb\/workflow-runtime["']/;

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

interface Offence {
  filePath: string;
  rule: string;
}

describe("server vm isolation (exit criterion k)", () => {
  it("apps/server/src never references node:vm, the workflow-runtime barrel, or the sandbox surface", async () => {
    const serverSrcDir = join(repoRoot, "apps/server/src");
    const offenders: Offence[] = [];

    async function scan(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // The app-scaffold template vendors a gitignored node_modules
          // install under src; the invariant covers our tracked source,
          // exactly like grep over tracked files.
          if (entry.name === "node_modules") {
            continue;
          }
          await scan(entryPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const content = await readFile(entryPath, "utf8");
        if (content.includes(FORBIDDEN_VM_SPECIFIER)) {
          offenders.push({ filePath: entryPath, rule: "references node:vm" });
        }
        if (FORBIDDEN_BARREL_IMPORT.test(content)) {
          offenders.push({
            filePath: entryPath,
            rule: "imports the @bb/workflow-runtime barrel (use the /validation subpath)",
          });
        }
        if (content.includes(FORBIDDEN_SANDBOX_SURFACE)) {
          offenders.push({
            filePath: entryPath,
            rule: "references the sandbox execution surface",
          });
        }
      }
    }

    await scan(serverSrcDir);
    expect(offenders).toEqual([]);
  });
});
