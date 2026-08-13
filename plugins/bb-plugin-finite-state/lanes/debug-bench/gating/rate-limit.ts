import type { HardwareIoThrottle } from "../gdb/session.js";
import type { GatingDeps } from "./mode.js";

export interface TokenBucketPolicy {
  capacity: number;
  refillPerSecond: number;
}

export interface HardwareRateLimitPolicy {
  device: TokenBucketPolicy;
  session: TokenBucketPolicy;
}

export const DEFAULT_HARDWARE_RATE_LIMIT_POLICY: HardwareRateLimitPolicy = {
  device: { capacity: 20, refillPerSecond: 10 },
  session: { capacity: 50, refillPerSecond: 25 },
};

export interface RateLimitDeps extends GatingDeps {
  rateLimitPolicy?: HardwareRateLimitPolicy;
}

export class HardwareRateLimitError extends Error {
  readonly code = "RATE_LIMITED" as const;

  constructor(
    readonly retryAfterMs: number,
    readonly retryAt: string,
  ) {
    super(`RATE_LIMITED: Hardware I/O is rate limited; retry in ${retryAfterMs} ms.`);
    this.name = "HardwareRateLimitError";
  }
}

interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

interface SessionBuckets {
  policy: HardwareRateLimitPolicy;
  session: BucketState;
  devices: Map<string, BucketState>;
}

const bucketsByDatabase = new WeakMap<GatingDeps["db"], Map<string, SessionBuckets>>();

function assertPolicy(policy: HardwareRateLimitPolicy): void {
  for (const bucket of [policy.device, policy.session]) {
    if (
      !Number.isFinite(bucket.capacity) || bucket.capacity <= 0 ||
      !Number.isFinite(bucket.refillPerSecond) || bucket.refillPerSecond <= 0
    ) {
      throw new Error("INVALID_HARDWARE_RATE_LIMIT_POLICY");
    }
  }
}

function stateFor(deps: RateLimitDeps, at: number): SessionBuckets {
  const policy = deps.rateLimitPolicy ?? DEFAULT_HARDWARE_RATE_LIMIT_POLICY;
  assertPolicy(policy);
  let sessions = bucketsByDatabase.get(deps.db);
  if (!sessions) {
    sessions = new Map();
    bucketsByDatabase.set(deps.db, sessions);
  }
  let state = sessions.get(deps.sessionId);
  if (!state) {
    state = {
      policy,
      session: { tokens: policy.session.capacity, updatedAtMs: at },
      devices: new Map(),
    };
    sessions.set(deps.sessionId, state);
  } else if (
    state.policy.device.capacity !== policy.device.capacity ||
    state.policy.device.refillPerSecond !== policy.device.refillPerSecond ||
    state.policy.session.capacity !== policy.session.capacity ||
    state.policy.session.refillPerSecond !== policy.session.refillPerSecond
  ) {
    throw new Error("HARDWARE_RATE_LIMIT_POLICY_CHANGED_WITHIN_SESSION");
  }
  return state;
}

function refill(bucket: BucketState, policy: TokenBucketPolicy, at: number): number {
  const elapsed = Math.max(0, at - bucket.updatedAtMs);
  bucket.tokens = Math.min(
    policy.capacity,
    bucket.tokens + elapsed * policy.refillPerSecond / 1_000,
  );
  bucket.updatedAtMs = at;
  return bucket.tokens;
}

function retryFor(bucket: BucketState, policy: TokenBucketPolicy): number {
  return Math.ceil(Math.max(0, 1 - bucket.tokens) / policy.refillPerSecond * 1_000);
}

export function rateLimit(deps: RateLimitDeps, deviceId: string): HardwareIoThrottle {
  if (deviceId.trim().length === 0) throw new Error("INVALID_RATE_LIMIT_DEVICE");
  return {
    async acquire(signal) {
      signal.throwIfAborted();
      const date = deps.now?.() ?? new Date();
      const at = date.getTime();
      const state = stateFor(deps, at);
      let device = state.devices.get(deviceId);
      if (!device) {
        device = { tokens: state.policy.device.capacity, updatedAtMs: at };
        state.devices.set(deviceId, device);
      }
      refill(state.session, state.policy.session, at);
      refill(device, state.policy.device, at);
      if (state.session.tokens < 1 || device.tokens < 1) {
        const retryAfterMs = Math.max(
          retryFor(state.session, state.policy.session),
          retryFor(device, state.policy.device),
        );
        throw new HardwareRateLimitError(
          retryAfterMs,
          new Date(at + retryAfterMs).toISOString(),
        );
      }
      state.session.tokens -= 1;
      device.tokens -= 1;
    },
  };
}

export const acquireHardwareRateLimit = rateLimit;
