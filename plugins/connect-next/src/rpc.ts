import { z } from "zod";
import { defineRpcContract, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { connectNextStatusSchema, type ConnectNextStatus } from "./types.js";

export const connectNextRpcContract = defineRpcContract({
  status: { input: z.null(), output: connectNextStatusSchema },
  setEnabled: {
    input: z.object({ enabled: z.boolean() }).strict(),
    output: connectNextStatusSchema,
  },
});

export interface ConnectNextControls {
  status(): ConnectNextStatus;
  setEnabled(enabled: boolean): Promise<ConnectNextStatus>;
}

export function createRpcHandlers(
  controls: ConnectNextControls,
): PluginRpcHandlers<typeof connectNextRpcContract> {
  return {
    async status() {
      return controls.status();
    },
    async setEnabled(input) {
      return controls.setEnabled(input.enabled);
    },
  };
}
