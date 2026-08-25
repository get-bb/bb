import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * One method: read this machine's current load.
 *
 * Host load telemetry is deliberately outside core — no daemon protocol field,
 * no host RPC command — so a plugin that wants it samples for itself. The
 * sample is taken when the call arrives rather than on a timer inside the
 * worker: the worker is lazily started and idle-evicted after five minutes
 * with no activity, so a self-timing worker would either need a retained
 * lease (a process kept alive on every machine forever, to compute two numbers
 * a minute) or would be evicted between polls anyway. The server polls once a
 * minute; that *is* the sampling interval.
 */
export const concurrencyLimitHostContract = defineRpcContract({
  sampleLoad: {
    input: z.null(),
    output: z
      .object({
        /** 0–100. Derived from 1-minute load average over core count. */
        cpuPercent: z.number().min(0).max(100),
        /** 0–100, from total/free memory. */
        memoryPercent: z.number().min(0).max(100),
        /** Epoch ms on the host when the reading was taken. */
        sampledAt: z.number().int().nonnegative(),
        /**
         * False when the platform reports no load average (Windows always
         * reports zero), so the server can ignore a CPU reading that would
         * otherwise look like a permanently idle machine.
         */
        cpuSupported: z.boolean(),
      })
      .strict(),
  },
});
