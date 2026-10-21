import type {
  ReadChange,
  ReadDependency,
  ReadChangeReaction,
} from "./read-change.js";

export interface ContractChangeDeclarations<Input, Output> {
  experimental_reactToChange?(
    input: Input,
    output: Output | undefined,
    change: ReadChange,
  ): ReadChangeReaction<Output>;
  experimental_dependencies?(
    input: Input,
    output: Output,
  ): readonly ReadDependency[];
  experimental_keyDependencies?(
    key: string,
    value: Output extends Readonly<Record<string, infer Value>>
      ? Value
      : unknown,
  ): readonly ReadDependency[];
  experimental_changes?(input: Input, output: Output): readonly ReadChange[];
}
