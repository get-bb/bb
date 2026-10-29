import { z } from "zod";

export interface ContractTagDeclarations<Input, Output> {
  tags?(input: Input, output: Output): readonly string[];
  keyTags?(
    key: string,
    value: Output extends Readonly<Record<string, infer Value>>
      ? Value
      : unknown,
  ): readonly string[];
  invalidates?(input: Input, output: Output): readonly string[];
}

const rpcTagList = z.array(z.string().min(1));
export const rpcInvalidationTags = rpcTagList.min(1);
export function rpcResponseTags<Input, Output>(
  declarations: ContractTagDeclarations<Input, Output>,
  input: Input,
  output: Output,
) {
  const tags = rpcTagList.parse(declarations.tags?.(input, output) ?? []);
  const keyTags: Record<string, string[]> = {};
  if (
    declarations.keyTags &&
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output)
  ) {
    for (const [key, value] of Object.entries(output)) {
      keyTags[key] = rpcTagList.parse(declarations.keyTags(key, value));
    }
  }
  const invalidated = rpcTagList.parse(
    declarations.invalidates?.(input, output) ?? [],
  );
  return { tags, keyTags, invalidated };
}
