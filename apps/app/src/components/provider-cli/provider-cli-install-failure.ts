import type { OnboardingFailureDetail } from "@bb/server-contract";

const CLASSIFIED_OUTPUT_TAIL_CHARS = 64 * 1024;
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/gu;

const OUTPUT_PATTERNS: readonly [OnboardingFailureDetail, RegExp][] = [
  ["disk_full", /\bENOSPC\b|no space left on device/iu],
  [
    "permission",
    /\bE(?:ACCES|PERM)\b|permission denied|operation not permitted|access is denied/iu,
  ],
  [
    "network",
    /\bE(?:NOTFOUND|AI_AGAIN|CONNREFUSED|CONNRESET|TIMEDOUT|NETUNREACH|HOSTUNREACH)\b|\bERR_SOCKET_TIMEOUT\b|\bcurl: \((?:5|6|7|28|35|52|56)\)|could not resolve host|failed to connect|network request|unable to get local issuer certificate|self[- ]signed certificate/iu,
  ],
  ["not_found", /command not found|: not found\b|is not recognized as/iu],
  ["npm_error", /^npm (?:ERR!|error)/imu],
];

export function classifyProviderCliInstallFailure(args: {
  completed: { exitCode: number | null; signal: string | null } | null;
  errorMessage: string | null;
  output: string;
}): { detail: OnboardingFailureDetail; exitCode?: number } {
  const exitCode = args.completed?.exitCode ?? undefined;
  const withExitCode = (detail: OnboardingFailureDetail) =>
    exitCode === undefined ? { detail } : { detail, exitCode };
  const errorMessage = args.errorMessage;
  if (errorMessage !== null) {
    if (/^Command not found: |\bENOENT\b/u.test(errorMessage)) {
      return withExitCode("not_found");
    }
    if (/^Provider installation already running for /u.test(errorMessage)) {
      return withExitCode("in_progress");
    }
    if (/ is no longer available on this host\.$/u.test(errorMessage)) {
      return withExitCode("unavailable");
    }
    if (/ exited successfully, but /u.test(errorMessage)) {
      return withExitCode("verification_failed");
    }
  }
  const output =
    `${args.output.slice(-CLASSIFIED_OUTPUT_TAIL_CHARS)}\n${errorMessage ?? ""}`.replace(
      ANSI_ESCAPE_PATTERN,
      "",
    );
  for (const [detail, pattern] of OUTPUT_PATTERNS) {
    if (pattern.test(output)) return withExitCode(detail);
  }
  if (exitCode === 127) return withExitCode("not_found");
  if (exitCode === 126) return withExitCode("permission");
  if (args.completed !== null && args.completed.exitCode === null) {
    return withExitCode("signal");
  }
  return withExitCode(args.completed === null ? "other" : "exit_nonzero");
}
