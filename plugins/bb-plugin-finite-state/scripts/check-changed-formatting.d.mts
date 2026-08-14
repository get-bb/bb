interface ChangedFormattingOptions {
  repositoryRoot: string;
  baseRef: string;
}

interface CheckChangedFormattingOptions extends ChangedFormattingOptions {
  prettierCommand?: string;
  prettierArguments?: string[];
  stdio?: "inherit" | "pipe";
}

interface ChangedFormattingResult {
  files: string[];
  status: number;
}

export function changedFiniteStateFiles(
  options: ChangedFormattingOptions,
): Promise<string[]>;

export function checkChangedFiniteStateFormatting(
  options: CheckChangedFormattingOptions,
): Promise<ChangedFormattingResult>;
