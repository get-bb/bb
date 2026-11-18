import { z } from "zod";

const grokForkResultSchema = z
  .object({
    newSessionId: z.string().min(1),
    chatMessagesCopied: z.number().int().nonnegative(),
    updatesCopied: z.number().int().nonnegative(),
    planStateCopied: z.boolean().optional(),
    newCwd: z.string().min(1),
    parentSessionId: z.string().min(1),
  })
  .passthrough();

export type GrokForkResult = z.infer<typeof grokForkResultSchema>;

export interface GrokForkParams {
  sourceSessionId: string;
  sourceCwd: string;
  newCwd: string;
  mcpServers: readonly unknown[];
}

export class GrokForkIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokForkIdentityError";
  }
}

export function buildGrokForkParams(params: GrokForkParams): GrokForkParams {
  return {
    sourceSessionId: params.sourceSessionId,
    sourceCwd: params.sourceCwd,
    newCwd: params.newCwd,
    mcpServers: params.mcpServers,
  };
}

export function decodeGrokForkResult(value: unknown): GrokForkResult {
  return grokForkResultSchema.parse(value);
}

export function assertGrokForkIdentity(
  result: GrokForkResult,
  sourceSessionId: string,
  activeSessionIds: readonly string[],
): void {
  if (result.newSessionId === sourceSessionId) {
    throw new GrokForkIdentityError(
      "Grok fork returned the source session ID as the child identity.",
    );
  }
  if (result.parentSessionId !== sourceSessionId) {
    throw new GrokForkIdentityError(
      "Grok fork returned a parentSessionId that does not match the source session.",
    );
  }
  if (activeSessionIds.includes(result.newSessionId)) {
    throw new GrokForkIdentityError(
      `Grok fork child session ID is already active: ${result.newSessionId}`,
    );
  }
}
