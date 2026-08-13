import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";
import type { PluginContext } from "../../../../lib/context.js";
import { rpcContract } from "../../../../shared/contract.js";
import { queryVerificationMatrix } from "./query.js";

const verificationMatrixRpcContract = {
  verificationsMatrix: rpcContract.verificationsMatrix,
} as const;

export const verificationMatrixPreferenceRpcContract = defineRpcContract({
  verificationMatrixPreferenceSet: {
    input: z.object({
      projectId: z.string().min(1),
      showManual: z.boolean(),
    }).strict(),
    output: z.object({ showManual: z.boolean() }).strict(),
  },
});

function preferenceKey(projectId: string): string {
  return `verification-matrix:show-manual:${projectId}`;
}

export function registerVerificationMatrixBackend(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  bb.rpc.register({
    ...verificationMatrixRpcContract,
    ...verificationMatrixPreferenceRpcContract,
  }, {
    async verificationsMatrix(input) {
      const showManual = (await bb.storage.kv.get<boolean>(preferenceKey(input.projectId))) ?? false;
      const page = queryVerificationMatrix(ctx.db(), input);
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          fields: { ...item.fields, preferences: { showManual } },
        })),
      };
    },
    async verificationMatrixPreferenceSet(input) {
      await bb.storage.kv.set(preferenceKey(input.projectId), input.showManual);
      return { showManual: input.showManual };
    },
  });
}
