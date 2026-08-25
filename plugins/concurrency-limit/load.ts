// The host load cache.
//
// The gate reads this and nothing else — never a host RPC, never the SDK. A
// host call takes as long as the machine takes to answer, gates are boxed at
// 10s and fail closed, and they run under a server-wide lock; awaiting host
// I/O inside one would let a single busy machine stall every dispatch in the
// server. So a background service polls, this cache holds the answer, and the
// gate does a map lookup.

import type { HostLoad } from "./scope.js";

/**
 * How long a sample is trusted. Polling is once a minute, so this tolerates
 * four missed polls before the reading is discarded. Discarding matters:
 * a stale "92% CPU" from a machine that has since gone quiet — or
 * disconnected — would hold work forever with no way for the user to see why.
 */
export const SAMPLE_MAX_AGE_MS = 5 * 60_000;

export interface StoredSample extends HostLoad {
  sampledAt: number;
}

export class HostLoadCache {
  private readonly samples = new Map<string, StoredSample>();

  set(hostId: string, sample: StoredSample): void {
    this.samples.set(hostId, sample);
  }

  /** The freshest reading for a host, or null when there is none or it aged out. */
  get(hostId: string, now: number): HostLoad | null {
    const sample = this.samples.get(hostId);
    if (sample === undefined) return null;
    if (now - sample.sampledAt > SAMPLE_MAX_AGE_MS) return null;
    return { cpuPercent: sample.cpuPercent, memoryPercent: sample.memoryPercent };
  }

  /** Forget a host, e.g. when it disconnects or its worker exits. */
  forget(hostId: string): void {
    this.samples.delete(hostId);
  }

  clear(): void {
    this.samples.clear();
  }
}
