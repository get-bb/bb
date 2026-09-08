import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const sshMachineRpcContract = defineRpcContract({
  listTargets: {
    input: z.null(),
    output: z.array(z.string().min(1)),
  },
});
