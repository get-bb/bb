// bb-fork(windows): resolves the shell the Start terminal action will use.
import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import {
  AUTOMATIC_TERMINAL_SHELL_ID,
  defaultTerminalShellOption,
  findTerminalShellOption,
  isAutomaticTerminalShellId,
  type TerminalShellOption,
} from "@bb/domain";
import { useTerminalShells } from "@/hooks/queries/terminal-shell-queries";
import { terminalShellIdAtom } from "./terminalShellPreference";

export interface TerminalShellSelection {
  defaultShell: TerminalShellOption | null;
  selectedShellId: string;
  shellIdForLaunch: string | null;
}

export function resolveTerminalShellSelection(args: {
  preferredShellId: string;
  shells: readonly TerminalShellOption[];
}): TerminalShellSelection {
  const requestedShell = isAutomaticTerminalShellId(args.preferredShellId)
    ? null
    : findTerminalShellOption(args.shells, args.preferredShellId);
  return {
    defaultShell: defaultTerminalShellOption(args.shells),
    selectedShellId: requestedShell?.id ?? AUTOMATIC_TERMINAL_SHELL_ID,
    shellIdForLaunch: requestedShell?.id ?? null,
  };
}

export interface TerminalShellChoice extends TerminalShellSelection {
  isLoading: boolean;
  shells: readonly TerminalShellOption[];
  setSelectedShellId: (shellId: string) => void;
}

export function useTerminalShellChoice(
  hostId: string | null,
): TerminalShellChoice {
  const { data, isLoading } = useTerminalShells(hostId);
  const [preferredShellId, setPreferredShellId] = useAtom(terminalShellIdAtom);
  const shells = useMemo(() => data ?? [], [data]);

  const setSelectedShellId = useCallback(
    (shellId: string) => {
      setPreferredShellId(shellId);
    },
    [setPreferredShellId],
  );

  const selection = useMemo(
    () =>
      resolveTerminalShellSelection({
        preferredShellId,
        shells,
      }),
    [preferredShellId, shells],
  );

  return useMemo(
    () => ({
      ...selection,
      isLoading,
      shells,
      setSelectedShellId,
    }),
    [isLoading, selection, setSelectedShellId, shells],
  );
}
