import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerTailscaleCli } from "./cli.js";
import { createRpcHandlers, tailscaleRpcContract } from "./rpc.js";
import { systemTailscale, type LocateTailscale } from "./tailscale-cli.js";
import {
  Tailscale,
  type OwnershipStore,
  type TailscaleTiming,
} from "./tailscale.js";
import { TAILSCALE_REALTIME_CHANNEL } from "./types.js";

export const TAILSCALE_PROVIDER_ID = "tailscale";
export const OWNED_MAPPING_KEY = "owned-serve-mapping";
const POLL_INTERVAL_MS = 30_000;

const ownedMappingSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    target: z.string().url(),
  })
  .strict();

export interface TailscalePluginOptions {
  locate?: LocateTailscale;
  fetch?: typeof fetch;
  now?: () => number;
  timing?: Partial<TailscaleTiming>;
  pollIntervalMs?: number;
  listening?: (address: string, port: number) => Promise<boolean>;
}

function kvOwnership(bb: BbPluginApi): OwnershipStore {
  return {
    async get() {
      const raw = await bb.storage.kv.get<unknown>(OWNED_MAPPING_KEY);
      if (raw === undefined) return null;
      const parsed = ownedMappingSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    set: (mapping) => bb.storage.kv.set(OWNED_MAPPING_KEY, mapping),
    clear: () => bb.storage.kv.delete(OWNED_MAPPING_KEY),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export function createTailscalePlugin(options: TailscalePluginOptions = {}) {
  return async function plugin(bb: BbPluginApi): Promise<void> {
    const tailscale = new Tailscale({
      locate: options.locate ?? systemTailscale(),
      target: () => bb.server.loopbackBaseUrl,
      ownership: kvOwnership(bb),
      fetch: options.fetch ?? fetch,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.timing === undefined ? {} : { timing: options.timing }),
      ...(options.listening === undefined
        ? {}
        : { listening: options.listening }),
      onChange: (status, availabilityChanged) => {
        bb.realtime.publish(TAILSCALE_REALTIME_CHANNEL, status);
        if (availabilityChanged) bb.experimental_serverAccess.recheck();
      },
    });

    bb.experimental_serverAccess.register({
      id: TAILSCALE_PROVIDER_ID,
      displayName: "Tailscale",
      routeKind: "private-overlay",
      description:
        "Use this server's private tailnet address (Tailscale Serve). Machines must be on the same tailnet.",
      availability: () => tailscale.availability(),
      async acquire({ hostId, signal }) {
        signal.throwIfAborted();
        const availability = await tailscale.availability();
        if (availability.status !== "available") {
          return { status: "failed", message: availability.message };
        }
        return { id: hostId, serverUrl: availability.serverUrl };
      },
      async release() {},
    });

    const controls = {
      status: () => tailscale.status({ maxAgeMs: 0 }),
      setup: () => tailscale.setup(),
      teardown: () => tailscale.teardown(),
    };
    bb.rpc.register(tailscaleRpcContract, createRpcHandlers(controls));
    registerTailscaleCli(bb, controls);

    bb.background.service("monitor", {
      async start(signal) {
        while (!signal.aborted) {
          await tailscale.refresh().catch((error: unknown) => {
            bb.log.warn(`Couldn't read Tailscale status: ${errorText(error)}`);
          });
          await sleep(options.pollIntervalMs ?? POLL_INTERVAL_MS, signal);
        }
      },
    });
  };
}
