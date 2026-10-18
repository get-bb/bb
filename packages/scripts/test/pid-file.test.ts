import fs from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRunningPid, writePidFile } from "../src/lib/pid-file.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pid-file helpers", () => {
  it("writes pid files with parent directory creation", async () => {
    const tempDir = await makeTempDir("bb-pid-file-");
    const pidPath = path.join(tempDir, "supervisors", "server.pid");

    await writePidFile({
      pid: 12345,
      pidPath,
    });

    await expect(fs.readFile(pidPath, "utf8")).resolves.toBe("12345\n");
  });

  it("rejects invalid pid files and removes them", async () => {
    const tempDir = await makeTempDir("bb-pid-file-");
    const pidPath = path.join(tempDir, "server.pid");
    await fs.writeFile(pidPath, "not-a-pid\n", "utf8");

    await expect(
      readRunningPid({
        pidPath,
        serviceName: "server",
      }),
    ).rejects.toThrow(`Invalid PID file for server: ${pidPath}`);
    await expect(fs.access(pidPath)).rejects.toThrow();
  });
});
