export interface ContractTagDeclarations<Input, Output> {
  tags?(input: Input, output: Output): readonly string[];
  invalidates?(input: Input, output: Output): readonly string[];
}
