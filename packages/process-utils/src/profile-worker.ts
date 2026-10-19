import { summarizeStallWindows } from "./stall-attribution.js";
import {
  parseStallWindowBatch,
  type StallWindowBatch,
} from "./stall-windows.js";
import { parentPort, workerData } from "node:worker_threads";
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
  let startedAt = "";
  let title = "";
  let finishedProfile: Profiler.Profile | undefined;
  session.on("Profiler.consoleProfileFinished", (event) => {
    if (event.params.title === title) finishedProfile = event.params.profile;
  });
  const begin = async (name: string) => {
    await session.post("Runtime.evaluate", {
      expression: `process.getBuiltinModule("node:inspector").console.profile(${JSON.stringify(name)})`,
    });
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
    await session.post("Profiler.setSamplingInterval", { interval: 1_000 });
    title = `bb-performance-${randomUUID()}`;
    await begin(title);
    startedAt = new Date().toISOString();
    respond(
      {
        directory,
        profileIntervalMs: 30_000,
        profileRetentionMs: retentionMs,
        maxRetainedProfileBytes: maxBytes,
        maxProfileBytes,
        pid: process.pid,
      },
      "Server performance diagnostics enabled",
    );
  };
  const capture = async (restart: boolean, stalls: StallWindowBatch) => {
    const beginning = startedAt;
    const nextTitle = `bb-performance-${randomUUID()}`;
    if (restart) {
      await begin(nextTitle);
      startedAt = new Date().toISOString();
    }
    finishedProfile = undefined;
    await session.post("Runtime.evaluate", {
      expression: `process.getBuiltinModule("node:inspector").console.profileEnd(${JSON.stringify(title)})`,
    });
    const profile = finishedProfile;
    finishedProfile = undefined;
    if (!profile) throw new Error("CPU profile completion was not received");
    title = nextTitle;
    const endedAt = new Date().toISOString();
    for (const fields of summarizeStallWindows(profile, stalls)) {
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
    );
  };
  port.on("message", async (command: unknown) => {
    try {
      if (command === "start") await start();
      else if (
        typeof command === "object" &&
        command !== null &&
        "command" in command &&
        (command.command === "capture" || command.command === "stop") &&
        "stalls" in command
      ) {
        await capture(
          command.command === "capture",
          parseStallWindowBatch(command.stalls),
        );
        if (command.command === "stop") session.disconnect();
      } else throw new Error("Invalid profiling command");
    } catch (error) {
      session.disconnect();
      await rm(pendingPath, { force: true }).catch(() => {});
      throw error;
    }
  });
}

void runProfileWorker();
