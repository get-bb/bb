import type { TerminalSession } from "@bb/server-contract";
import { useCallback, useEffect, useRef } from "react";
import { normalizeTerminalTitle, useRenameTerminal } from "@/data/terminals";

const TERMINAL_TITLE_RENAME_DEBOUNCE_MS = 250;

/**
 * Rename the session after the shell's OSC title (a program name), debounced
 * and deduplicated like the web controller: path-like prompts are ignored,
 * the same title is not requested twice, and only a running session renames.
 */
export function useTerminalTitleSync(
  session: TerminalSession | undefined,
): (title: string) => void {
  const renameTerminal = useRenameTerminal();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const latestRequestRef = useRef<{ terminalId: string; title: string } | null>(
    null,
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { mutate } = renameTerminal;

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return useCallback(
    (rawTitle: string) => {
      const current = sessionRef.current;
      if (!current || current.status !== "running") return;
      const title = normalizeTerminalTitle(rawTitle);
      if (!title || title === current.title) return;
      const request = { terminalId: current.id, title };
      const latest = latestRequestRef.current;
      if (
        latest !== null &&
        latest.terminalId === request.terminalId &&
        latest.title === request.title
      ) {
        return;
      }
      latestRequestRef.current = request;
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        mutate(request, {
          onSettled: () => {
            const pending = latestRequestRef.current;
            if (
              pending !== null &&
              pending.terminalId === request.terminalId &&
              pending.title === request.title
            ) {
              latestRequestRef.current = null;
            }
          },
        });
      }, TERMINAL_TITLE_RENAME_DEBOUNCE_MS);
    },
    [mutate],
  );
}
