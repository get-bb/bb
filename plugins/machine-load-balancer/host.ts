import { availableParallelism, loadavg, totalmem } from "node:os";
import { stat } from "node:fs/promises";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  machineMeasurementHostContract,
} from "./contract.js";

export default experimental_defineHostEntry({
  contract: machineMeasurementHostContract,
  handlers: {
    measure: () => ({
      capacity: {
        availableParallelism: availableParallelism(),
        totalMemoryBytes: totalmem(),
      },
      oneMinuteLoad:
        process.platform === "win32"
          ? { kind: "unsupported" as const }
          : { kind: "measured" as const, value: loadavg()[0] },
    }),
    async checkSource({ path }) {
      try {
        return (await stat(path)).isDirectory()
          ? { kind: "available" as const }
          : { kind: "missing" as const };
      } catch (error) {
        if (error instanceof Error && "code" in error &&
          (error.code === "ENOENT" || error.code === "ENOTDIR")) {
          return { kind: "missing" as const };
        }
        return {
          kind: "failed" as const,
          reason: `Source check failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
});
