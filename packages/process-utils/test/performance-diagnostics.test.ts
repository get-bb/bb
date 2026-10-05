import {
  mkdtemp,
  mkdir,
  open,
  utimes,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { startPerformanceDiagnostics } from "../src/performance-diagnostics.js";

describe("performance diagnostics", () => {
  it("saves an actual CPU profile on shutdown and stops idempotently", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-test-"));
    const warnings: unknown[] = [];
    const monitor = await startPerformanceDiagnostics({
      dataDir,
      logger: {
        info: () => {},
        warn: (fields: unknown) => {
          warnings.push(fields);
        },
      },
    });
    try {
      const until = performance.now() + 40;
      while (performance.now() < until) Math.sqrt(performance.now());
      await Promise.all([monitor.stop(), monitor.stop()]);
      const directory = join(dataDir, "logs", "performance");
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^profile-\d+-[0-9a-f-]+\.cpuprofile$/);
      const path = join(directory, files[0]!);
      const profile = JSON.parse(await readFile(path, "utf8"));
      expect(profile.nodes.length).toBeGreaterThan(0);
      expect(profile.samples.length).toBeGreaterThan(0);
      expect(profile.endTime).toBeGreaterThan(profile.startTime);
      if (process.platform !== "win32")
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(warnings).toEqual([]);
    } finally {
      await monitor.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("expires old captures and reserves the byte budget without overwriting recent sessions", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-retention-"));
    const directory = join(dataDir, "logs", "performance");
    await mkdir(directory, { recursive: true });
    const now = Date.now();
    for (const [name, bytes, ageHours] of [
      ["profile-00.cpuprofile", 10, 13],
      ["profile-01.cpuprofile", 600_000_000, 11],
      ["profile-02.cpuprofile", 400_000_000, 1],
    ] as const) {
      const path = join(directory, name);
      const file = await open(path, "w");
      await file.truncate(bytes);
      await file.close();
      const at = new Date(now - ageHours * 3_600_000);
      await utimes(path, at, at);
    }
    await writeFile(join(directory, "notes.txt"), "preserve");
    await writeFile(join(directory, "profile.pending"), "interrupted write");
    const warnings: unknown[] = [];
    const options = {
      dataDir,
      logger: {
        info: () => {},
        warn: (fields: unknown) => {
          warnings.push(fields);
        },
      },
    };
    try {
      const first = await startPerformanceDiagnostics(options);
      await first.stop();
      const names = await readdir(directory);
      expect(names).not.toContain("profile-00.cpuprofile");
      expect(names).not.toContain("profile-01.cpuprofile");
      expect(names).not.toContain("profile.pending");
      expect(names).toContain("profile-02.cpuprofile");
      expect(await readFile(join(directory, "notes.txt"), "utf8")).toBe(
        "preserve",
      );
      const saved = names.filter((name) => name.endsWith(".cpuprofile"));
      expect(saved).toHaveLength(2);
      const second = await startPerformanceDiagnostics(options);
      await second.stop();
      const retained = (await readdir(directory)).filter((name) =>
        name.endsWith(".cpuprofile"),
      );
      expect(retained).toHaveLength(3);
      expect(retained).toEqual(expect.arrayContaining(saved));
      const sizes = await Promise.all(
        retained.map(async (name) => (await stat(join(directory, name))).size),
      );
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(
        1_000_000_000,
      );
      expect(warnings).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps startup and shutdown usable when the profile directory cannot be created", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-unwritable-"));
    const warnings: unknown[] = [];
    try {
      await writeFile(join(dataDir, "logs"), "not a directory");
      const monitor = await startPerformanceDiagnostics({
        dataDir,
        logger: {
          info: () => {},
          warn: (fields: unknown) => {
            warnings.push(fields);
          },
        },
      });
      await monitor.stop();
      expect(warnings).toHaveLength(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
