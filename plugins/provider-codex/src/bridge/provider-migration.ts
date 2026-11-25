import { z } from "zod";
import { CodexAppServerRpcError } from "./app-server-connection.js";

const managedProvider = z.enum(["openai", "bb-account-pool"]);
const mismatchSchema = z.object({
  type: z.literal("modelProviderMismatch"),
  modelProvider: managedProvider,
  currentModelProvider: managedProvider,
});

const missingPoolSchema = z.object({
  type: z.literal("modelProviderNotConfigured"),
  modelProvider: z.literal("bb-account-pool"),
});

type ThreadIdentity = {
  modelProvider?: string;
  thread: { modelProvider?: string };
};

function sessionProvider(result: ThreadIdentity) {
  return result.modelProvider ?? result.thread.modelProvider;
}

export async function resumeWithProviderMigration<P, R extends ThreadIdentity>({
  method,
  params,
  request,
  currentProvider,
  poolSelected,
}: {
  method: string;
  params: P;
  request: (method: string, params: P) => Promise<R>;
  currentProvider: () => Promise<string>;
  poolSelected: boolean;
}): Promise<R> {
  if (method !== "thread/resume") return request(method, params);

  const fork = async (target: "openai" | "bb-account-pool") => {
    const result = await request("thread/fork", {
      ...params,
      modelProvider: target,
      deferGoalContinuation: true,
    });
    if (sessionProvider(result) !== target) {
      throw new Error(
        `Codex could not switch the resumed session to ${target}`,
      );
    }
    return result;
  };

  let resumed: R;
  try {
    resumed = await request(method, params);
  } catch (error) {
    if (!(error instanceof CodexAppServerRpcError)) throw error;
    const mismatch = mismatchSchema.safeParse(error.data);
    if (
      mismatch.success &&
      mismatch.data.modelProvider !== mismatch.data.currentModelProvider
    ) {
      return fork(mismatch.data.currentModelProvider);
    }
    if (
      missingPoolSchema.safeParse(error.data).success &&
      (await currentProvider()) === "openai"
    ) {
      return fork("openai");
    }
    throw error;
  }

  const source = sessionProvider(resumed);
  if (poolSelected) {
    if (source === "openai") return fork("bb-account-pool");
    if (source !== "bb-account-pool") {
      throw new Error(
        `Codex returned an unsupported session provider for Airouter Pool: ${source ?? "unknown"}`,
      );
    }
  } else if (
    source === "bb-account-pool" &&
    (await currentProvider()) === "openai"
  ) {
    return fork("openai");
  }
  return resumed;
}
