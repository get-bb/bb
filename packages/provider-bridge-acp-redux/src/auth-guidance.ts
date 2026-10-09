import type { AcpAuthMethod } from "./client/capabilities.js";

const SHELL_SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const MAX_LISTED_METHODS = 4;

function shellWord(value: string): string {
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

export function acpTerminalSignInCommand(args: {
  command: string;
  args: readonly string[];
  method: Pick<AcpAuthMethod, "args" | "env">;
}): string {
  return [
    ...Object.entries(args.method.env).map(
      ([name, value]) => `${name}=${shellWord(value)}`,
    ),
    shellWord(args.command),
    ...args.args.map(shellWord),
    ...args.method.args.map(shellWord),
  ].join(" ");
}

export function describeAcpSignIn(args: {
  command: string;
  args: readonly string[];
  authMethods: readonly AcpAuthMethod[];
}): string | null {
  const terminal = args.authMethods.find(
    (method) => method.type === "terminal",
  );
  if (terminal !== undefined) {
    return `To sign in, run this in a terminal on the machine that hosts the thread, then send the message again: ${acpTerminalSignInCommand(
      { command: args.command, args: args.args, method: terminal },
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
  return `The agent offers these ways to sign in: ${listed}${more}. Sign in with the agent's own command on the machine that hosts the thread, then send the message again.`;
}
