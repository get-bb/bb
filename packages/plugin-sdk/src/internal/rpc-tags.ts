import type { ContractTagDeclarations } from "@bb/domain";
import { z } from "zod";

export const rpcInvalidationTags = z.array(z.string().min(1)).min(1);
export function rpcResponseTags<Input, Output>(
  declarations: ContractTagDeclarations<Input, Output>,
  input: Input,
  output: Output,
) {
  const tags = z
    .array(z.string().min(1))
    .parse(declarations.tags?.(input, output) ?? []);
  const keyTags: Record<string, string[]> = {};
  if (
    declarations.keyTags &&
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output)
  ) {
    for (const [key, value] of Object.entries(output)) {
      keyTags[key] = z
        .array(z.string().min(1))
        .parse(declarations.keyTags(key, value));
    }
  }
  const invalidated = z
    .array(z.string().min(1))
    .parse(declarations.invalidates?.(input, output) ?? []);
  return { tags, keyTags, invalidated };
}
