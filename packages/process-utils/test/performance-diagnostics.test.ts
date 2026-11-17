import assert from "node:assert/strict";
import { threadCpuUsage } from "node:process";
import { createContext, Script } from "node:vm";
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

const blockerSource = "bb-performance-blocker.fixture.js";
const heartbeatSource = "bb-performance-heartbeat.fixture.js";

function createBlocker(cpuMs: number) {
  const context = createContext({ performance, threadCpuUsage, cpuMs });
  const script = new Script(
    `const started = threadCpuUsage();
    let consumed;
    do {
      const until = performance.now() + 1;
      while (performance.now() < until) Math.sqrt(performance.now());
      consumed = threadCpuUsage(started);
    } while (consumed.user + consumed.system < cpuMs * 1_000);`,
    { filename: blockerSource },
  );
  const heartbeat = new Script("1", { filename: heartbeatSource });
  return {
    run: () => script.runInContext(context),
    heartbeat: () => heartbeat.runInContext(context),
  };
}

function expectSampledBlocker(profile: unknown) {
  assert(profile && typeof profile === "object");
  assert("nodes" in profile && Array.isArray(profile.nodes));
  assert("samples" in profile && Array.isArray(profile.samples));
  const children = new Map<number, number[]>();
  const blockerNodes: number[] = [];
  for (const node of profile.nodes) {
    assert(node && typeof node === "object");
    assert(typeof node.id === "number");
    assert(node.callFrame && typeof node.callFrame === "object");
    if (node.callFrame.url === blockerSource) blockerNodes.push(node.id);
    const ids: unknown = node.children ?? [];
    assert(Array.isArray(ids));
    assert(ids.every((id): id is number => typeof id === "number"));
    children.set(node.id, ids);
  }
  const descendants = new Set<number>();
  for (const id of blockerNodes) {
    if (descendants.has(id)) continue;
    descendants.add(id);
    blockerNodes.push(...(children.get(id) ?? []));
  }
  expect(
    profile.samples.some(
      (id: unknown) => typeof id === "number" && descendants.has(id),
    ),
  ).toBe(true);
}

function readCalibration(record: object) {
  assert("clockCalibration" in record);
  const calibration = record.clockCalibration;
  assert(calibration && typeof calibration === "object");
  assert(
    "minimumOffsetMs" in calibration &&
      typeof calibration.minimumOffsetMs === "number",
  );
  assert(
    "maximumOffsetMs" in calibration &&
      typeof calibration.maximumOffsetMs === "number",
  );
  assert("status" in calibration);
  assert("offsetUs" in calibration);
  return {
    minimumOffsetMs: calibration.minimumOffsetMs,
    maximumOffsetMs: calibration.maximumOffsetMs,
    status: calibration.status,
    offsetUs: calibration.offsetUs,
  };
}

describe("performance diagnostics", () => {
  it("saves an actual CPU profile on shutdown and stops idempotently", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-test-"));
    const warnings: unknown[] = [];
    const blocker = createBlocker(80);
    const monitor = await startPerformanceDiagnostics({
      codeOwners: () => [],
      dataDir,
      logger: {
        info: () => {},
        warn: (fields: unknown) => {
          warnings.push(fields);
        },
      },
    });
    try {
      blocker.run();
      await Promise.all([monitor.stop(), monitor.stop()]);
      const directory = join(dataDir, "logs", "performance");
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^profile-\d+-[0-9a-f-]+\.cpuprofile$/);
      const path = join(directory, files[0]!);
      const profile = JSON.parse(await readFile(path, "utf8"));
      expectSampledBlocker(profile);
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

  it.each([
    { offsetMs: 0, clockJumpMs: 0 },
    { offsetMs: 172_800_000, clockJumpMs: 0 },
    { offsetMs: -172_800_000, clockJumpMs: 0 },
    { offsetMs: 172_800_000, clockJumpMs: 1_000 },
  ])(
    "logs the sampled blocker without attributing an adjacent short callback with clock $offsetMs ms and jump $clockJumpMs ms",
    async ({ offsetMs, clockJumpMs }) => {
      const dataDir = await mkdtemp(join(tmpdir(), "bb-stall-attribution-"));
      const records: object[] = [];
      const warnings: object[] = [];
      const blocker = createBlocker(200);
      const realNow = process.hrtime.bigint;
      const clock = vi
        .spyOn(process.hrtime, "bigint")
        .mockImplementation(() => realNow() + BigInt(offsetMs) * 1_000_000n);
      const monitor = await startPerformanceDiagnostics({
        codeOwners: () => [
          {
            location: blockerSource,
            owner: "plugin:probe",
          },
          { location: heartbeatSource, owner: "plugin:heartbeat" },
        ],
        dataDir,
        logger: {
          info: (fields, message) => {
            if (message === "Event loop stall attribution")
              records.push(fields);
          },
          warn: (fields) => {
            warnings.push(fields);
          },
        },
      });
      try {
        await delay(40);
        blocker.run();
        blocker.heartbeat();
        await delay(40);
        clock.mockImplementation(
          () => realNow() + BigInt(offsetMs + clockJumpMs) * 1_000_000n,
        );
        await monitor.stop();
        expect(records.length).toBeGreaterThan(0);
        const calibration = readCalibration(records[0]!);
        const { minimumOffsetMs, maximumOffsetMs } = calibration;
        const rejected =
          minimumOffsetMs > maximumOffsetMs ||
          maximumOffsetMs - minimumOffsetMs > 10;
        if (clockJumpMs !== 0)
          expect(minimumOffsetMs).toBeGreaterThan(maximumOffsetMs);
        for (const record of records)
          expect(readCalibration(record)).toEqual(calibration);
        if (rejected) {
          expect(calibration).toMatchObject({
            status:
              minimumOffsetMs > maximumOffsetMs ? "disjoint" : "uncertain",
            offsetUs: null,
          });
          for (const record of records)
            expect(record).toMatchObject({
              stallAttribution: "unattributed",
              sampledMs: 0,
              owners: [],
              stacks: [],
            });
        } else {
          expect(calibration).toMatchObject({
            status: "calibrated",
            offsetUs: ((minimumOffsetMs + maximumOffsetMs) / 2) * 1_000,
          });
          expect(records).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                stallAttribution: "sampled",
                owners: expect.arrayContaining([
                  { owner: "plugin:probe", sampledMs: expect.any(Number) },
                ]),
                stacks: expect.arrayContaining([
                  expect.objectContaining({
                    owner: "plugin:probe",
                    frames: expect.arrayContaining([
                      expect.objectContaining({ url: blockerSource }),
                    ]),
                  }),
                ]),
              }),
            ]),
          );
        }
        const files = await readdir(join(dataDir, "logs", "performance"));
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/\.cpuprofile$/);
        expectSampledBlocker(
          JSON.parse(
            await readFile(
              join(dataDir, "logs", "performance", files[0]!),
              "utf8",
            ),
          ),
        );
        expect(warnings).toEqual([]);
        expect(JSON.stringify(records)).not.toContain(heartbeatSource);
        expect(JSON.stringify(records)).not.toContain("plugin:heartbeat");
      } finally {
        try {
          await monitor.stop();
          await rm(dataDir, { recursive: true, force: true });
        } finally {
          clock.mockRestore();
        }
      }
    },
  );

  it("rotates bounded main-thread windows and ignores unrelated console captures", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-rotation-"));
    const savedPaths: string[] = [];
    const warnings: unknown[] = [];
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const monitor = await startPerformanceDiagnostics({
      codeOwners: () => [],
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
      codeOwners: () => [],
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

  it("stops cleanly when saving a capture fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-save-failure-"));
    const warnings: unknown[] = [];
    const monitor = await startPerformanceDiagnostics({
      codeOwners: () => [],
      dataDir,
      logger: {
        info: () => {},
        warn: (fields) => {
          warnings.push(fields);
        },
      },
    });
    try {
      await rm(join(dataDir, "logs", "performance"), {
        recursive: true,
        force: true,
      });
      await Promise.all([monitor.stop(), monitor.stop()]);
      expect(warnings).toHaveLength(1);
    } finally {
      await monitor.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps startup and shutdown usable when the profile directory cannot be created", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-unwritable-"));
    const warnings: unknown[] = [];
    try {
      await writeFile(join(dataDir, "logs"), "not a directory");
      const monitor = await startPerformanceDiagnostics({
        codeOwners: () => [],
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
