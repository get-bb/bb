import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CONNECT_NEXT_PLUGIN_ID } from "./server-shares.js";

const NEXT_STATUS_TIMEOUT_MS = 2_000;

const nextStatusSchema = z.object({
  state: z.string(),
  url: z.string().url().nullable(),
});

const NEXT_UNSERVED_STATES: ReadonlySet<string> = new Set(["off", "waiting"]);

export function nextSharePublicUrl(
  nextOrigin: string,
  port: number | string,
): string {
  const url = new URL(nextOrigin);
  const dot = url.host.indexOf(".");
  const label = url.host.slice(0, dot);
  return `${url.protocol}//${label}--${port}${url.host.slice(dot)}`;
}

export function nextMachineSharePublicUrl(
  nextOrigin: string,
  machineLabel: string,
  port: number | string,
): string {
  const url = new URL(nextOrigin);
  const dot = url.host.indexOf(".");
  return `${url.protocol}//${machineLabel}--${port}${url.host.slice(dot)}`;
}

export class NextAddress {
  private inFlight: Promise<string | null> | null = null;

  constructor(private readonly getSdk: () => BbPluginApi["sdk"]) {}

  refresh(): Promise<string | null> {
    this.inFlight ??= this.read().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async read(): Promise<string | null> {
    try {
      const status = await this.getSdk().plugins.callRpc({
        pluginId: CONNECT_NEXT_PLUGIN_ID,
        method: "status",
        input: null,
        outputSchema: nextStatusSchema,
        signal: AbortSignal.timeout(NEXT_STATUS_TIMEOUT_MS),
      });
      return NEXT_UNSERVED_STATES.has(status.state) ? null : status.url;
    } catch {
      return null;
    }
  }
}
