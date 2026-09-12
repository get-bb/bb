import { readFileSync } from "node:fs";
import { CdpConnection } from "../browser/cdp.js";
import { cpuProfileSchema, type CpuProfile } from "../browser/driver.js";
import { waitUntil } from "./api.js";

const INSPECTOR_URL_PATTERN =
  /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+)/u;

export interface NodeProfiler {
  close(): void;
  start(): Promise<void>;
  stop(): Promise<CpuProfile>;
}

export async function connectNodeProfiler(
  stdioLogPath: string,
): Promise<NodeProfiler> {
  const url = await waitUntil(
    async () => {
      const match = INSPECTOR_URL_PATTERN.exec(
        readFileSync(stdioLogPath, "utf8"),
      );
      return match?.[1] ?? null;
    },
    `inspector URL in ${stdioLogPath}`,
    30_000,
  );
  const connection = await CdpConnection.connect(url, {
    commandTimeoutMs: 120_000,
    timeoutMs: 10_000,
  });
  await connection.send("Profiler.enable");
  return {
    close: () => connection.close(),
    async start() {
      await connection.send("Profiler.setSamplingInterval", { interval: 500 });
      await connection.send("Profiler.start");
    },
    async stop() {
      const result = await connection.send("Profiler.stop");
      if (
        typeof result !== "object" ||
        result === null ||
        !("profile" in result)
      ) {
        throw new Error("Profiler.stop returned no profile");
      }
      return cpuProfileSchema.parse(result.profile);
    },
  };
}
