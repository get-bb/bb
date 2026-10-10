import type { AcpAuthMethod } from "./client/capabilities.js";

const SHELL_SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const WINDOWS_SAFE_WORD = /^[A-Za-z0-9_@%+=:,./\\-]+$/u;
const MAX_LISTED_METHODS = 4;

function shellWord(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return WINDOWS_SAFE_WORD.test(value)
      ? value
      : `"${value.replaceAll('"', '\\"')}"`;
  }
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

export function acpTerminalSignInCommand(args: {
  command: string;
  args: readonly string[];
  method: Pick<AcpAuthMethod, "args" | "env">;
  platform?: NodeJS.Platform;
}): string {
  const platform = args.platform ?? process.platform;
  const word = (value: string) => shellWord(value, platform);
  const command = [
    word(args.command),
    ...args.args.map(word),
    ...args.method.args.map(word),
  ].join(" ");
  const env = Object.entries(args.method.env);
  if (platform === "win32") {
    return [
      ...env.map(
        ([name, value]) => `$env:${name}="${value.replaceAll('"', '`"')}";`,
      ),
      command,
    ].join(" ");
  }
  return [
    ...env.map(([name, value]) => `${name}=${word(value)}`),
    command,
  ].join(" ");
}

export function describeAcpSignIn(args: {
  command: string;
  args: readonly string[];
  authMethods: readonly AcpAuthMethod[];
  platform?: NodeJS.Platform;
}): string | null {
  const terminal = args.authMethods.find(
    (method) => method.type === "terminal",
  );
  if (terminal !== undefined) {
    return `To sign in, run this in a terminal on the machine that hosts the thread, then try again: ${acpTerminalSignInCommand(
      {
        command: args.command,
        args: args.args,
        method: terminal,
        ...(args.platform === undefined ? {} : { platform: args.platform }),
      },
    )}`;
  }
  const names = [
    ...new Set(
      args.authMethods
        .map((method) => method.name.trim())
        .filter((name) => name !== ""),
    ),
  ];
  if (names.length === 0) {
    return null;
  }
  const listed = names.slice(0, MAX_LISTED_METHODS).join(", ");
  const more =
    names.length > MAX_LISTED_METHODS
      ? ` and ${names.length - MAX_LISTED_METHODS} more`
      : "";
  return `The agent offers these ways to sign in: ${listed}${more}. Sign in with the agent's own command on the machine that hosts the thread, then try again.`;
}
