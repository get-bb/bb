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
