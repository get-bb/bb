export interface ArcActionCapabilities {
  start: boolean;
  pause: boolean;
  stop: boolean;
  destroy: boolean;
}

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function createArcId(
  now = Date.now(),
  randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): string {
  let timestamp = Math.max(0, Math.floor(now));
  let encodedTime = "";
  for (let index = 0; index < 10; index += 1) {
    encodedTime = CROCKFORD_BASE32[timestamp % 32] + encodedTime;
    timestamp = Math.floor(timestamp / 32);
  }
  const encodedRandom = Array.from(randomBytes.slice(0, 16), (value) =>
    CROCKFORD_BASE32[value & 31],
  ).join("");
  return `arc_${encodedTime}${encodedRandom}`;
}

export type ArcLifecycleStatus =
  | "starting"
  | "ready"
  | "paused"
  | "stopped"
  | "error";

export function availableArcActions(
  status: ArcLifecycleStatus,
  capabilities: ArcActionCapabilities,
) {
  return {
    start:
      capabilities.start &&
      (status === "paused" || status === "stopped" || status === "error"),
    pause: capabilities.pause && status === "ready",
    stop: capabilities.stop && status === "ready",
    destroy: capabilities.destroy,
  };
}

export function httpPortalHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export interface CoalescedAsyncRunner {
  run(task: () => Promise<void>): Promise<void>;
}

export function createCoalescedAsyncRunner(): CoalescedAsyncRunner {
  let active: Promise<void> | null = null;
  let next: (() => Promise<void>) | null = null;

  return {
    run(task) {
      next = task;
      if (active !== null) {
        return active;
      }

      active = (async () => {
        while (next !== null) {
          const current = next;
          next = null;
          await current();
        }
      })().finally(() => {
        active = null;
      });
      return active;
    },
  };
}
