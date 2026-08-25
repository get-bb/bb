import { cpus, freemem, loadavg, platform, totalmem } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { concurrencyLimitHostContract } from "./contract.js";

/** Everything the sampler touches, injected so the arithmetic is testable. */
export interface LoadSamplerDependencies {
  readonly platform: () => NodeJS.Platform;
  readonly totalmem: () => number;
  readonly freemem: () => number;
  readonly loadavg: () => number[];
  readonly cpuCount: () => number;
  readonly now: () => number;
}

export interface LoadSample {
  cpuPercent: number;
  memoryPercent: number;
  sampledAt: number;
  cpuSupported: boolean;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Turn the OS numbers into two percentages.
 *
 * CPU comes from the 1-minute load average divided by core count. That is a
 * queue-length measure, not a utilization measure, so it can legitimately
 * exceed 100% on a saturated machine — clamping it to 100 is fine here because
 * the only question asked of it is "are we past the threshold". It is also
 * meaningless on Windows, where `os.loadavg()` is documented to return zeroes;
 * `cpuSupported` reports that rather than letting a Windows host look
 * permanently idle to a CPU threshold.
 */
export function computeLoadSample(deps: LoadSamplerDependencies): LoadSample {
  const total = deps.totalmem();
  const free = deps.freemem();
  const memoryPercent =
    total > 0 ? clampPercent(((total - free) / total) * 100) : 0;

  const cores = Math.max(1, deps.cpuCount());
  const [oneMinute = 0] = deps.loadavg();
  const cpuSupported = deps.platform() !== "win32";

  return {
    cpuPercent: cpuSupported ? clampPercent((oneMinute / cores) * 100) : 0,
    memoryPercent,
    sampledAt: deps.now(),
    cpuSupported,
  };
}

export function createConcurrencyLimitHostEntry(
  deps: LoadSamplerDependencies,
) {
  return experimental_defineHostEntry({
    contract: concurrencyLimitHostContract,
    handlers: {
      sampleLoad() {
        return computeLoadSample(deps);
      },
    },
  });
}

export default createConcurrencyLimitHostEntry({
  platform: () => platform(),
  totalmem: () => totalmem(),
  freemem: () => freemem(),
  loadavg: () => loadavg(),
  cpuCount: () => cpus().length,
  now: () => Date.now(),
});
