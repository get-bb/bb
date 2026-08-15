// The Agent SDK throws this when it falls back to its bundled CLI binary and
// cannot resolve the platform package. Packaged bb builds never ship that
// package (the bridge bundle inlines the SDK), so the SDK's "reinstall"
// guidance is wrong for bb users; point them at the real remedies instead.
const MISSING_NATIVE_CLI_PATTERN = /Native CLI binary for .+ not found/;
const MISSING_CLAUDE_CLI_GUIDANCE =
  "bb could not find the Claude Code CLI on this machine. Install Claude Code (https://claude.com/claude-code), or set BB_CLAUDE_CODE_EXECUTABLE to the full path of the claude binary, then restart bb.";

export function isMissingClaudeCliMessage(message: string): boolean {
  return MISSING_NATIVE_CLI_PATTERN.test(message);
}

export function missingClaudeCliGuidance(): string {
  return MISSING_CLAUDE_CLI_GUIDANCE;
}

export function translateMissingClaudeCliError(error: unknown): unknown {
  if (error instanceof Error && isMissingClaudeCliMessage(error.message)) {
    return new Error(MISSING_CLAUDE_CLI_GUIDANCE, { cause: error });
  }
  return error;
}
