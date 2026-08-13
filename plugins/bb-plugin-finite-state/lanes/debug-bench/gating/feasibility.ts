import type { BbPluginApi, PluginAgentToolContext } from "@bb/plugin-sdk";

type AssertTrue<Value extends true> = Value;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

export type PluginAgentToolContextKeyset = AssertTrue<
  Equal<keyof PluginAgentToolContext, "projectId" | "signal" | "threadId">
>;
export type InteractionResponseIsSdkCallable = AssertTrue<
  "respond" extends keyof BbPluginApi["sdk"]["threads"]["interactions"]
    ? true
    : false
>;

export const DEBUG_MODE_FEASIBILITY = {
  refusalGate: "plugin-handler-precondition",
  conditionalTools: "next-session-resolution",
  hotSessionMutation: false,
  bbCoreChangeRequired: false,
  destructiveTurnEvidence: "unavailable",
  requestInputActorEvidence: "unavailable",
  destructiveEvidenceUnblock: "https://github.com/get-bb/bb/issues/1564",
} as const;

export interface DebugModeFeasibilityAssertion {
  refusalGate: boolean;
  conditionalToolsAtSessionStart: boolean;
  hotSessionMutationAttempted: boolean;
  bbCoreSourceUsed: boolean;
  interactionResponseSdkCallable: boolean;
}
export function assertDebugModeFeasibility(
  assertion: DebugModeFeasibilityAssertion,
): void {
  if (!assertion.refusalGate) {
    throw new Error("DEBUG_MODE_FEASIBILITY_FAILED: handler refusal is required");
  }
  if (!assertion.conditionalToolsAtSessionStart) {
    throw new Error("DEBUG_MODE_FEASIBILITY_FAILED: next-session tool selection is unavailable");
  }
  if (assertion.hotSessionMutationAttempted) {
    throw new Error("DEBUG_MODE_FEASIBILITY_FAILED: hot session mutation is unsupported");
  }
  if (assertion.bbCoreSourceUsed) {
    throw new Error("DEBUG_MODE_FEASIBILITY_FAILED: plugin-only implementation required");
  }
  if (!assertion.interactionResponseSdkCallable) {
    throw new Error(
      "DEBUG_MODE_FEASIBILITY_FAILED: SDK interaction response reachability must remain explicit",
    );
  }
}
