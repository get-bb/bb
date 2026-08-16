import { experimental_defineHostRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const keepAwakeHostContract = experimental_defineHostRpcContract({
  methods: {
    setEnabled: {
      target: { kind: "host" },
      input: z.object({ enabled: z.boolean() }).strict(),
      output: z
        .object({ enabled: z.boolean(), supported: z.boolean() })
        .strict(),
    },
    status: {
      target: { kind: "host" },
      input: z.object({}).strict(),
      output: z
        .object({ enabled: z.boolean(), supported: z.boolean() })
        .strict(),
    },
  },
  signals: {
    stateChanged: {
      target: "host",
      payload: z
        .object({ enabled: z.boolean(), supported: z.boolean() })
        .strict(),
    },
  },
});
