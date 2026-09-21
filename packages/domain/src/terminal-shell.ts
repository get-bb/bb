// bb-fork(windows): terminal shell selection is a fork feature (docs/windows.md).
import { z } from "zod";

const TERMINAL_SHELL_LIST_MAX = 16;
const TERMINAL_SHELL_ID_MAX_LENGTH = 64;
const TERMINAL_SHELL_LABEL_MAX_LENGTH = 80;

export const AUTOMATIC_TERMINAL_SHELL_ID = "__automatic__";

export const terminalShellIdSchema = z
  .string()
  .min(1)
  .max(TERMINAL_SHELL_ID_MAX_LENGTH);

const terminalShellOptionSchema = z
  .object({
    id: terminalShellIdSchema,
    isDefault: z.boolean(),
    label: z.string().min(1).max(TERMINAL_SHELL_LABEL_MAX_LENGTH),
    path: z.string().min(1).max(4096),
  })
  .strict();
export type TerminalShellOption = z.infer<typeof terminalShellOptionSchema>;

export const terminalShellOptionsSchema = z
  .array(terminalShellOptionSchema)
  .max(TERMINAL_SHELL_LIST_MAX);

export function isAutomaticTerminalShellId(shellId: string): boolean {
  return shellId === AUTOMATIC_TERMINAL_SHELL_ID;
}

export function findTerminalShellOption(
  shells: readonly TerminalShellOption[],
  shellId: string,
): TerminalShellOption | null {
  return shells.find((shell) => shell.id === shellId) ?? null;
}

export function defaultTerminalShellOption(
  shells: readonly TerminalShellOption[],
): TerminalShellOption | null {
  return shells.find((shell) => shell.isDefault) ?? shells[0] ?? null;
}
