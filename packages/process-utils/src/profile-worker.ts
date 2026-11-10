import {
  PROFILE_SAMPLING_INTERVAL_MS,
  summarizeStallWindows,
} from "./stall-attribution.js";
import {
  parseProfileCodeOwners,
  parseStallWindowBatch,
  type ProfileCodeOwner,
  type StallWindowBatch,
} from "./stall-windows.js";
import { parentPort, workerData } from "node:worker_threads";
import { setImmediate } from "node:timers/promises";
import { Session } from "node:inspector/promises";
import type { Profiler } from "node:inspector";
import { mkdir, readdir, stat, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

async function runProfileWorker(): Promise<void> {
  if (!parentPort || typeof workerData !== "string")
    throw new Error("Invalid profiling worker context");
  const port = parentPort;
  const directory = join(workerData, "logs", "performance");
  const pendingPath = join(directory, "profile.pending");
  const retentionMs = 12 * 60 * 60 * 1_000;
  const maxBytes = 1_000_000_000;
  const maxProfileBytes = 12 * 1024 * 1024;
  const profiles: { path: string; bytes: number; savedAt: number }[] = [];
  let retainedBytes = 0;
  const prune = async (reservedBytes: number) => {
    const cutoff = Date.now() - retentionMs;
    while (profiles.length > 0) {
      const profile = profiles[0]!;
      if (profile.savedAt > cutoff && retainedBytes + reservedBytes <= maxBytes)
        break;
      await rm(profile.path, { force: true });
      retainedBytes -= profile.bytes;
      profiles.shift();
    }
  };
  const session = new Session();
  const disconnect = async () => {
    session.disconnect();
    await new Promise<void>((resolve) => {
      const onMessage = (value: unknown) => {
        if (value !== "drained") return;
        port.off("message", onMessage);
        resolve();
      };
      port.on("message", onMessage);
      port.postMessage("disconnected");
    });
    await setImmediate();
  };
  let startedAt = "";
  let title = "";
  type ClockReading = { beforeMs: number; afterMs: number };
  let profileStartClock: ClockReading | undefined;
  let finishedProfile: Profiler.Profile | undefined;
  session.on("Profiler.consoleProfileFinished", (event) => {
    if (event.params.title === title) finishedProfile = event.params.profile;
  });
  const takeFinishedProfile = (): Profiler.Profile | undefined => {
    const profile = finishedProfile;
    finishedProfile = undefined;
    return profile;
  };
  const profileCommand = async (
    method: "profile" | "profileEnd",
    name: string,
  ): Promise<ClockReading> => {
    const { result, exceptionDetails } = await session.post(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const beforeMs = Number(process.hrtime.bigint()) / 1e6;
        process.getBuiltinModule("node:inspector").console.${method}(${JSON.stringify(name)});
        return { beforeMs, afterMs: Number(process.hrtime.bigint()) / 1e6 };
      })()`,
        returnByValue: true,
      },
    );
    const reading: unknown = result.value;
    if (
      exceptionDetails ||
      typeof reading !== "object" ||
      reading === null ||
      !("beforeMs" in reading) ||
      typeof reading.beforeMs !== "number" ||
      !Number.isFinite(reading.beforeMs) ||
      !("afterMs" in reading) ||
      typeof reading.afterMs !== "number" ||
      !Number.isFinite(reading.afterMs)
    )
      throw new Error("Invalid profiling clock reading");
    return { beforeMs: reading.beforeMs, afterMs: reading.afterMs };
  };
  const respond = (
    fields: object,
    message: string,
    level = "info",
    complete = true,
  ) => {
    port.postMessage({ fields, message, level, complete });
  };
  const start = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rm(pendingPath, { force: true });
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files) {
      if (
        !file.isFile() ||
        !/^profile-\d+(?:-[0-9a-f-]{36})?\.cpuprofile$/.test(file.name)
      )
        continue;
      const path = join(directory, file.name);
      try {
        const details = await stat(path);
        profiles.push({ path, bytes: details.size, savedAt: details.mtimeMs });
        retainedBytes += details.size;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
    }
    profiles.sort(
      (a, b) => a.savedAt - b.savedAt || a.path.localeCompare(b.path),
    );
    await prune(0);
    session.connectToMainThread();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", {
      interval: PROFILE_SAMPLING_INTERVAL_MS * 1_000,
    });
    title = `bb-performance-${randomUUID()}`;
    profileStartClock = await profileCommand("profile", title);
    startedAt = new Date().toISOString();
    respond(
      {
        directory,
        profileIntervalMs: 30_000,
        profileSamplingIntervalMs: PROFILE_SAMPLING_INTERVAL_MS,
        profileRetentionMs: retentionMs,
        maxRetainedProfileBytes: maxBytes,
        maxProfileBytes,
        pid: process.pid,
      },
      "Server performance diagnostics enabled",
    );
  };
  const capture = async (
    restart: boolean,
    stalls: StallWindowBatch,
    codeOwners: ProfileCodeOwner[],
  ) => {
    const beginning = startedAt;
    const beginningClock = profileStartClock;
    if (!beginningClock) throw new Error("Missing profiling start clock");
    const nextTitle = `bb-performance-${randomUUID()}`;
    if (restart) {
      profileStartClock = await profileCommand("profile", nextTitle);
      startedAt = new Date().toISOString();
    }
    takeFinishedProfile();
    const endingClock = await profileCommand("profileEnd", title);
    const profile = takeFinishedProfile();
    if (!profile) throw new Error("CPU profile completion was not received");
    title = nextTitle;
    const endedAt = new Date().toISOString();
    const minimumOffsetMs = Math.max(
      beginningClock.beforeMs - profile.startTime / 1_000,
      endingClock.beforeMs - profile.endTime / 1_000,
    );
    const maximumOffsetMs = Math.min(
      beginningClock.afterMs - profile.startTime / 1_000,
      endingClock.afterMs - profile.endTime / 1_000,
    );
    const offsetUs = ((minimumOffsetMs + maximumOffsetMs) / 2) * 1_000;
    const attributionProfile =
      minimumOffsetMs <= maximumOffsetMs &&
      maximumOffsetMs - minimumOffsetMs <= PROFILE_SAMPLING_INTERVAL_MS
        ? {
            ...profile,
            startTime: profile.startTime + offsetUs,
            endTime: profile.endTime + offsetUs,
          }
        : { ...profile, samples: [], timeDeltas: [] };
    for (const fields of summarizeStallWindows(
      attributionProfile,
      stalls,
      codeOwners,
    )) {
      respond(fields, "Event loop stall attribution", "info", false);
    }
    const contents = JSON.stringify(profile);
    const bytes = Buffer.byteLength(contents);
    await prune(bytes > maxProfileBytes ? 0 : bytes);
    if (bytes > maxProfileBytes) {
      respond(
        { bytes, startedAt: beginning, endedAt },
        "CPU profile exceeded size limit; discarded",
        "warn",
        restart,
      );
      return;
    }
    const savedAt = Date.now();
    const path = join(
      directory,
      "profile-" + savedAt + "-" + randomUUID() + ".cpuprofile",
    );
    await writeFile(pendingPath, contents, { mode: 0o600 });
    await rename(pendingPath, path);
    profiles.push({ path, bytes, savedAt });
    retainedBytes += bytes;
    respond(
      {
        path,
        bytes,
        startedAt: beginning,
        endedAt,
        pid: process.pid,
        sampleTimeBasis: "elapsed",
        nativeFramesMayIncludeWaiting: true,
      },
      "Server CPU profile saved",
      "info",
      restart,
    );
  };
  const handleCommand = async (command: unknown) => {
    if (command === "drained") return;
    try {
      if (command === "start") await start();
      else if (
        typeof command === "object" &&
        command !== null &&
        "command" in command &&
        (command.command === "capture" || command.command === "stop") &&
        "stalls" in command &&
        "codeOwners" in command
      ) {
        await capture(
          command.command === "capture",
          parseStallWindowBatch(command.stalls),
          parseProfileCodeOwners(command.codeOwners),
        );
        if (command.command === "stop") {
          await disconnect();
          respond({}, "CPU profiling worker stopped");
          port.close();
        }
      } else throw new Error("Invalid profiling command");
    } catch (error) {
      await disconnect();
      port.close();
      await rm(pendingPath, { force: true }).catch(() => {});
      throw error;
    }
  };
  port.on("message", (command: unknown) => {
    handleCommand(command).catch((error: unknown) => {
      process.nextTick(() => {
        throw error;
      });
    });
  });
}

void runProfileWorker();
