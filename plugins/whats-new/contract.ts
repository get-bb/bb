import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const whatsNewRpcContract = defineRpcContract({
  setEnabled: {
    input: z.object({ enabled: z.boolean() }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});
