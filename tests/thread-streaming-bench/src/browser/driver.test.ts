import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchBenchBrowser } from "./driver.js";

describe("launchBenchBrowser", () => {
  it("rejects missing or non-executable Chrome binaries before touching the profile", async () => {
    const base = await mkdtemp(join(tmpdir(), "bench-driver-test-"));
    try {
      const userDataDir = join(base, "profile");
      const missing = join(base, "missing-chrome");
      await expect(
        launchBenchBrowser({ chromePath: missing, userDataDir }),
      ).rejects.toThrow(
        `Chrome binary is missing or not executable: ${missing}`,
      );
      const notExecutable = join(base, "not-executable-chrome");
      await writeFile(notExecutable, "", { mode: 0o644 });
      await expect(
        launchBenchBrowser({ chromePath: notExecutable, userDataDir }),
      ).rejects.toThrow("CHROME_PATH");
      expect(await readdir(base)).toEqual(["not-executable-chrome"]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
