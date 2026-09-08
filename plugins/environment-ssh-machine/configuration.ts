import { z } from "zod";

export function isSafeSshDestination(value: string): boolean {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 255 ||
    trimmed.startsWith("-") ||
    /[\x00-\x20\x7f;&|$`'"\\(){}<>!?#~]/u.test(trimmed)
  ) {
    return false;
  }
  const parts = trimmed.split("@");
  if (parts.length > 2) return false;
  const host = parts.at(-1) ?? "";
  const user = parts.length === 2 ? parts[0] : null;
  if (user !== null && !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/u.test(user)) {
    return false;
  }
  return (
    /^[A-Za-z0-9][A-Za-z0-9._:+%=-]*$/u.test(host) ||
    /^\[[0-9A-Fa-f:.]+\]$/u.test(host)
  );
}

export const sshDestinationSchema = z
  .string()
  .trim()
  .refine(
    isSafeSshDestination,
    "Enter an SSH host alias or user@host without spaces or shell metacharacters.",
  );

export const sshMachineInputsSchema = z
  .object({ target: sshDestinationSchema })
  .strict();
export type SshMachineInputs = z.infer<typeof sshMachineInputsSchema>;
