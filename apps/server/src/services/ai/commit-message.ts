import { renderTemplate } from "@bb/templates";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { Type } from "@earendil-works/pi-ai";
import {
  INFERENCE_POLICY,
  inferenceCompleteWithFallback,
} from "./inference.js";

const commitMessageSchema = Type.Object({
  message: Type.String({ minLength: 1 }),
});

interface GenerateCommitMessageArgs {
  diffDescription: string;
  shortstat: string;
  files: string;
  patch: string;
}

export async function generateCommitMessage(
  deps: LoggedWorkSessionDeps,
  args: GenerateCommitMessageArgs,
): Promise<string | null> {
  const prompt = renderTemplate("generateCommitMessage", {
    diffDescription: args.diffDescription,
    shortstat: args.shortstat,
    files: args.files,
    patch: args.patch,
  });

  try {
    const result = await inferenceCompleteWithFallback(deps, {
      ...INFERENCE_POLICY.commitMessage,
      label: "Commit message inference",
      prompt,
      schema: commitMessageSchema,
    });
    return result?.message ?? null;
  } catch {
    return null;
  }
}
