import { z } from "zod";
import { defineRpcContract, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { tailscaleStatusSchema, type TailscaleStatus } from "./types.js";

export const tailscaleRpcContract = defineRpcContract({
  status: { input: z.null(), output: tailscaleStatusSchema },
  setup: { input: z.null(), output: tailscaleStatusSchema },
  teardown: { input: z.null(), output: tailscaleStatusSchema },
});

export interface TailscaleControls {
  status(): Promise<TailscaleStatus>;
  setup(): Promise<TailscaleStatus>;
  teardown(): Promise<TailscaleStatus>;
}

export function createRpcHandlers(
  controls: TailscaleControls,
): PluginRpcHandlers<typeof tailscaleRpcContract> {
  return {
    status: () => controls.status(),
    setup: () => controls.setup(),
    teardown: () => controls.teardown(),
  };
}
