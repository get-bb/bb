export interface CliUsageErrorArgs {
  code: string;
  hint: string | null;
  message: string;
}

export class CliUsageError extends Error {
  readonly code: string;
  readonly hint: string | null;
  constructor(args: CliUsageErrorArgs) {
    super(args.message);
    this.name = "CliUsageError";
    this.code = args.code;
    this.hint = args.hint;
  }
}
