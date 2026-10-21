import {
  pluginRpcEnvelopeSchema,
  type ContractChangeDeclarations,
  type ReadDependency,
} from "@bb/domain";

const dependenciesSchema = pluginRpcEnvelopeSchema.shape.dependencies.unwrap();
const changesSchema = pluginRpcEnvelopeSchema.shape.changes.unwrap();

export function rpcResponseChanges<Input, Output>(
  declarations: ContractChangeDeclarations<Input, Output>,
  input: Input,
  output: Output,
) {
  const dependencies = dependenciesSchema.parse(
    declarations.experimental_dependencies?.(input, output) ?? [],
  );
  const keyDependencies: Record<string, ReadDependency[]> = {};
  if (
    declarations.experimental_keyDependencies &&
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output)
  ) {
    for (const [key, value] of Object.entries(output))
      keyDependencies[key] = dependenciesSchema.parse(
        declarations.experimental_keyDependencies(key, value),
      );
  }
  const changes = changesSchema.parse(
    declarations.experimental_changes?.(input, output) ?? [],
  );
  return { dependencies, keyDependencies, changes };
}
