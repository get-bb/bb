import { z } from "zod";
import { CodexAppServerRpcError } from "./app-server-connection.js";

const mismatchSchema = z.object({
  type: z.literal("modelProviderMismatch"),
  modelProvider: z.enum(["openai", "bb-account-pool"]),
  currentModelProvider: z.enum(["openai", "bb-account-pool"]),
});

const missingPoolSchema = z.object({
  type: z.literal("modelProviderNotConfigured"),
  modelProvider: z.literal("bb-account-pool"),
});

export async function resumeWithProviderMigration<P, R>({
  method,
  params,
  request,
  currentProvider,
}: {
  method: string;
  params: P;
  request: (method: string, params: P) => Promise<R>;
  currentProvider: () => Promise<string>;
}): Promise<R> {
  try {
    return await request(method, params);
  } catch (error) {
    if (
      method !== "thread/resume" ||
      !(error instanceof CodexAppServerRpcError)
    ) {
      throw error;
    }
    const mismatch = mismatchSchema.safeParse(error.data);
    let target: string;
    if (mismatch.success) {
      if (mismatch.data.modelProvider === mismatch.data.currentModelProvider)
        throw error;
      target = mismatch.data.currentModelProvider;
    } else if (missingPoolSchema.safeParse(error.data).success) {
      target = await currentProvider();
      if (target !== "openai") throw error;
    } else {
      throw error;
    }
    return await request("thread/fork", {
      ...params,
      modelProvider: target,
      deferGoalContinuation: true,
    });
  }
}
