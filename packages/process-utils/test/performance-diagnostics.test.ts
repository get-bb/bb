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
import { describe, expect, it, vi } from "vitest";
import { console as inspectorConsole } from "node:inspector";
import { setTimeout as delay } from "node:timers/promises";
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

  it("rotates continuous bounded windows and ignores unrelated console captures", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-rotation-"));
    const savedPaths: string[] = [];
    const warnings: unknown[] = [];
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const monitor = await startPerformanceDiagnostics({
      dataDir,
      logger: {
        info: (fields, message) => {
          if (
            message === "Server CPU profile saved" &&
            "path" in fields &&
            typeof fields.path === "string"
          )
            savedPaths.push(fields.path);
        },
        warn: (fields) => {
          warnings.push(fields);
        },
      },
    });
    try {
      for (let window = 1; window <= 2; window++) {
        inspectorConsole.profile("unrelated-user-capture");
        const until = performance.now() + 40;
        while (performance.now() < until) Math.sqrt(performance.now());
        inspectorConsole.profileEnd("unrelated-user-capture");
        await vi.advanceTimersByTimeAsync(30_000);
        const deadline = Date.now() + 5_000;
        while (savedPaths.length < window && Date.now() < deadline)
          await delay(10);
        expect(savedPaths).toHaveLength(window);
      }
      await Promise.all([monitor.stop(), monitor.stop()]);
      expect(savedPaths).toHaveLength(3);
      const profiles = await Promise.all(
        savedPaths.map(async (path) =>
          JSON.parse(await readFile(path, "utf8")),
        ),
      );
      for (const profile of profiles) {
        expect(profile.nodes.length).toBeGreaterThan(0);
        expect(profile.endTime).toBeGreaterThan(profile.startTime);
      }
      expect(profiles[0].samples.length).toBeGreaterThan(0);
      expect(profiles[1].samples.length).toBeGreaterThan(0);
      expect(profiles[1].startTime).toBeLessThanOrEqual(profiles[0].endTime);
      expect(profiles[2].startTime).toBeLessThanOrEqual(profiles[1].endTime);
      expect(profiles[1].startTime).toBeGreaterThan(profiles[0].startTime);
      expect(profiles[2].startTime).toBeGreaterThan(profiles[1].startTime);
      expect(warnings).toEqual([]);
    } finally {
      await monitor.stop();
      vi.useRealTimers();
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
