import { jsonValueSchema, type JsonValue } from "@bb/domain";
import type {
  PluginEnvironmentProviderV1CreateContext,
  PluginEnvironmentProviderV1Declaration,
  PluginEnvironmentProviderV1RestoreContext,
} from "@get-bb/plugin-sdk/internal/host-policy";
import type { ProviderReadyEnvironmentInput } from "@bb/server-contract";

type TestReadyEnvironment =
  | Exclude<ProviderReadyEnvironmentInput, { type: "host" }>
  | (Omit<
      Extract<ProviderReadyEnvironmentInput, { type: "host" }>,
      "mergeBaseBranch"
    > & { mergeBaseBranch?: string | null });

export type TestProviderDecision =
  | {
      action: "ready";
      environment: TestReadyEnvironment;
      log?: string;
    }
  | { action: "wait"; reason: string; log?: string }
  | { action: "reject"; message: string };

export type TestEnvironmentProviderContext = Pick<
  PluginEnvironmentProviderV1CreateContext,
  "thread" | "project" | "host" | "projectCheckout" | "gitRemote"
> & {
  machine: import("@bb/domain").EnvironmentMachineSelection;
  inputs: JsonValue | null;
  environment:
    | PluginEnvironmentProviderV1RestoreContext["previous"]["environment"]
    | null;
};

export function providerOperations(
  decide: (
    context: TestEnvironmentProviderContext,
  ) => TestProviderDecision | Promise<TestProviderDecision>,
): Pick<
  PluginEnvironmentProviderV1Declaration,
  "create" | "restore" | "remove"
> {
  async function run(
    context: TestEnvironmentProviderContext,
    report: PluginEnvironmentProviderV1CreateContext["report"],
    signal: AbortSignal,
  ): Promise<
    Awaited<ReturnType<PluginEnvironmentProviderV1Declaration["create"]>>
  > {
    while (!signal.aborted) {
      const decision = await decide(context);
      if (decision.action === "reject")
        return {
          status: "failed",

          message: decision.message,
        };
      if (decision.log !== undefined) report.log(decision.log);
      if (decision.action === "wait") {
        report.step(decision.reason);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        continue;
      }
      if (decision.environment.type !== "host")
        return {
          status: "failed",

          message: "Providers return directories, not reuse decisions",
        };
      return {
        status: "created",
        path: decision.environment.path,
        ownsPath: decision.environment.ownsPath ?? true,
        ...(decision.environment.mergeBaseBranch === undefined
          ? {}
          : { mergeBaseBranch: decision.environment.mergeBaseBranch }),
      };
    }
    throw new Error("Environment creation aborted");
  }
  return {
    create: async (context) => {
      const facts = {
        ...context,
        machine: { type: "existing" as const, hostId: context.host.id },
        inputs: jsonValueSchema.parse(context.inputs),
        environment: null,
      };
      return run(facts, context.report, context.signal);
    },
    restore: async (context) => {
      const facts = {
        ...context,
        machine: { type: "existing" as const, hostId: context.host.id },
        inputs: jsonValueSchema.parse(context.inputs),
        environment: context.previous.environment,
      };
      return run(facts, context.report, context.signal);
    },
    remove: async () => ({ status: "removed" }),
  };
}
