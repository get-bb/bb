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

export function createRpcKeyedProvider(warmMethods: readonly string[]) {
  const providers = new Map<string, () => Readonly<Record<string, unknown>>>();
  return {
    provideKeyed(
      method: string,
      values: () => Readonly<Record<string, unknown>>,
    ) {
      if (!warmMethods.includes(method)) providers.set(method, values);
    },
    entries() {
      return [...providers].map(
        ([method, values]) => [method, values()] as const,
      );
    },
  };
}
