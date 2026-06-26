import type {
  BuildMacRemoteSshOpenArgs,
  BuildMacTerminalOpenArgs,
} from "./types.js";

interface TerminalShellScriptArgs {
  columnNumber: number | null;
  lineNumber: number | null;
  path: string;
}

function quoteShellArg(value: string): string {
  if (value === "") {
    return "''";
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildTerminalShellScript(args: TerminalShellScriptArgs): string {
  const line = args.lineNumber === null ? "" : String(args.lineNumber);
  const column = args.columnNumber === null ? "" : String(args.columnNumber);
  const editorScript = [
    "editor=''",
    'if [ -n "${VISUAL:-}" ]; then editor=$VISUAL; elif [ -n "${EDITOR:-}" ]; then editor=$EDITOR; elif command -v nvim >/dev/null 2>&1; then editor=nvim; elif command -v vim >/dev/null 2>&1; then editor=vim; elif command -v vi >/dev/null 2>&1; then editor=vi; elif command -v nano >/dev/null 2>&1; then editor=nano; elif command -v less >/dev/null 2>&1; then editor=less; fi',
    'if [ -n "$editor" ]; then editor_name=$(basename "$editor"); case "$editor_name" in nvim|vim|vi) if [ -n "$line" ] && [ -n "$column" ]; then "$editor" "+call cursor($line,$column)" "$file"; elif [ -n "$line" ]; then "$editor" "+$line" "$file"; else "$editor" "$file"; fi ;; nano) if [ -n "$line" ] && [ -n "$column" ]; then "$editor" "+$line,$column" "$file"; elif [ -n "$line" ]; then "$editor" "+$line" "$file"; else "$editor" "$file"; fi ;; less) if [ -n "$line" ]; then "$editor" "+${line}g" "$file"; else "$editor" "$file"; fi ;; *) "$editor" "$file" ;; esac; else printf "%s\\n" "No terminal editor found for $target"; fi',
  ].join("; ");

  return [
    `target=${quoteShellArg(args.path)}`,
    `line=${quoteShellArg(line)}`,
    `column=${quoteShellArg(column)}`,
    'if [ -d "$target" ]; then cd "$target" || exit; exec "${SHELL:-/bin/sh}"; fi',
    'if [ -f "$target" ]; then dir=$(dirname "$target") || exit; file=$(basename "$target") || exit; cd "$dir" || exit',
    editorScript,
    'exec "${SHELL:-/bin/sh}"',
    "fi",
    'printf "%s\\n" "Path is not a file or directory: $target"',
    'exec "${SHELL:-/bin/sh}"',
  ].join("; ");
}

function buildTerminalDirectoryCommand(path: string): string {
  return `cd ${quoteShellArg(path)}`;
}

export function buildLocalTerminalShellArgs(
  args: BuildMacTerminalOpenArgs,
): string[] {
  return ["/bin/sh", "-lc", buildTerminalShellScript(args)];
}

export function buildRemoteTerminalSshArgs(
  args: BuildMacRemoteSshOpenArgs,
): string[] {
  return ["ssh", "-t", "--", args.sshAuthority, buildTerminalShellScript(args)];
}

function buildShellCommand(args: string[]): string {
  return args.map(quoteShellArg).join(" ");
}

export function buildMacTerminalLocalOpenArgs(
  args: BuildMacTerminalOpenArgs & { appName: "Terminal" | "iTerm" },
): string[] {
  const command = escapeAppleScriptString(
    args.pathType === "directory"
      ? buildTerminalDirectoryCommand(args.path)
      : buildShellCommand(buildLocalTerminalShellArgs(args)),
  );

  if (args.appName === "Terminal") {
    return [
      "-e",
      `tell application "Terminal" to do script "${command}"`,
      "-e",
      'tell application "Terminal" to activate',
    ];
  }

  return [
    "-e",
    'tell application "iTerm" to create window with default profile',
    "-e",
    `tell application "iTerm" to tell current session of current window to write text "${command}"`,
    "-e",
    'tell application "iTerm" to activate',
  ];
}

export function buildMacTerminalRemoteSshOpenArgs(
  args: BuildMacRemoteSshOpenArgs & { appName: "Terminal" | "iTerm" },
): string[] {
  const command = escapeAppleScriptString(
    buildShellCommand(buildRemoteTerminalSshArgs(args)),
  );

  if (args.appName === "Terminal") {
    return [
      "-e",
      `tell application "Terminal" to do script "${command}"`,
      "-e",
      'tell application "Terminal" to activate',
    ];
  }

  return [
    "-e",
    'tell application "iTerm" to create window with default profile',
    "-e",
    `tell application "iTerm" to tell current session of current window to write text "${command}"`,
    "-e",
    'tell application "iTerm" to activate',
  ];
}

export function buildMacGhosttyLocalOpenArgs(
  args: BuildMacTerminalOpenArgs,
): string[] {
  return [
    "-na",
    "Ghostty",
    "--args",
    "-e",
    ...buildLocalTerminalShellArgs(args),
  ];
}

export function buildMacGhosttyRemoteSshOpenArgs(
  args: BuildMacRemoteSshOpenArgs,
): string[] {
  return [
    "-na",
    "Ghostty",
    "--args",
    "-e",
    ...buildRemoteTerminalSshArgs(args),
  ];
}
