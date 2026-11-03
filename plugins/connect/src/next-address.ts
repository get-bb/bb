import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CONNECT_NEXT_PLUGIN_ID } from "./server-shares.js";

const NEXT_STATUS_TIMEOUT_MS = 2_000;
const NEXT_STATUS_FRESH_MS = 5_000;

const nextStatusSchema = z.object({
  enabled: z.boolean(),
  url: z.string().url().nullable(),
});

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
  private origin: string | null = null;
  private checkedAt = 0;
  private inFlight: Promise<string | null> | null = null;

  constructor(
    private readonly getSdk: () => BbPluginApi["sdk"],
    private readonly now: () => number = Date.now,
  ) {}

  current(): string | null {
    if (this.now() - this.checkedAt >= NEXT_STATUS_FRESH_MS) {
      void this.refresh();
    }
    return this.origin;
  }

  refresh(): Promise<string | null> {
    this.inFlight ??= this.read().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async read(): Promise<string | null> {
    let origin: string | null = null;
    try {
      const status = await this.getSdk().plugins.callRpc({
        pluginId: CONNECT_NEXT_PLUGIN_ID,
        method: "status",
        input: null,
        outputSchema: nextStatusSchema,
        signal: AbortSignal.timeout(NEXT_STATUS_TIMEOUT_MS),
      });
      origin = status.enabled ? status.url : null;
    } catch {
      origin = null;
    }
    this.origin = origin;
    this.checkedAt = this.now();
    return origin;
  }
}
