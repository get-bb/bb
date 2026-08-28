import { z } from "zod";

/**
 * The dispatch stages a plugin gate can intercept. The plugin-SDK contract keys
 * its per-stage context and decision types by these same strings, and the
 * server's gate registry is a `Record` over this union, so a stage added here
 * without a contract entry fails to compile.
 *
 * `dispatch` is THE admission checkpoint: one stage, run identically for a
 * thread's first message, a follow-up, a steer, a retry, and every re-attempt
 * a drain makes. It replaced the earlier `thread.create` + `turn.submit` pair,
 * whose split was an accident of where the code happened to branch rather than
 * a difference a plugin needed to see — the attempt's own `attempt` kind
 * carries what actually differs.
 *
 * `turn.failed` is post-hoc — it runs after a failure has already been applied
 * and can only ask for a retry — which is why it answers a different union.
 */
export const dispatchGateStageValues = ["dispatch", "turn.failed"] as const;
export const dispatchGateStageSchema = z.enum(dispatchGateStageValues);
export type DispatchGateStage = z.infer<typeof dispatchGateStageSchema>;
