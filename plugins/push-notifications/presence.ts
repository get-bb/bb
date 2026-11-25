import type { DeliveryChannel } from "./contract.js";

export const PRESENCE_ACTIVE_MS = 120_000;

export interface Presence {
  touch(channel: DeliveryChannel): void;
  activeChannels(): DeliveryChannel[];
}

export function createPresence(now: () => number = Date.now): Presence {
  const lastActiveAt = new Map<DeliveryChannel, number>();
  return {
    touch(channel) {
      lastActiveAt.set(channel, now());
    },
    activeChannels() {
      const cutoff = now() - PRESENCE_ACTIVE_MS;
      return [...lastActiveAt]
        .filter(([, at]) => at > cutoff)
        .map(([channel]) => channel);
    },
  };
}
