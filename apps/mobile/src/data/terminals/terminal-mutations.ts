import type { TerminalCreateScope } from "@bb/sdk/browser";
import type { TerminalSession } from "@bb/server-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  applyTerminalSessionClose,
  applyTerminalSessionUpsert,
} from "./terminal-cache";

/**
 * Terminal writes (mirror of apps/app/src/hooks/queries/thread-terminal-queries.ts
 * mutations): create in a thread, restart, close, rename. Each writes the
 * returned session into the list / session caches; the `terminals-changed`
 * realtime refetch confirms.
 */

/** Size a terminal is created with before the page reports its real fit. */
const DEFAULT_TERMINAL_COLS = 80;
const DEFAULT_TERMINAL_ROWS = 24;

export interface CreateTerminalRequest {
  scope: TerminalCreateScope;
  cols?: number;
  rows?: number;
  title?: string;
}

/** `POST /terminals` in a thread, an environment, or a host directory. */
export function useCreateTerminal() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<TerminalSession, Error, CreateTerminalRequest>({
    meta: { errorMessage: "Failed to start terminal." },
    mutationFn: ({ scope, cols, rows, title }) =>
      sdk.terminals.create({
        cols: cols ?? DEFAULT_TERMINAL_COLS,
        rows: rows ?? DEFAULT_TERMINAL_ROWS,
        scope,
        ...(title === undefined ? {} : { title }),
      }),
    onSuccess: (session) => {
      applyTerminalSessionUpsert(queryClient, session);
    },
  });
}

export interface RestartTerminalRequest {
  terminalId: string;
}

/**
 * `POST /terminals/:id/restart`: the server opens a replacement shell (new
 * id, same scope / size / title) before closing the old session, so the
 * screen navigates to the returned session.
 */
export function useRestartTerminal() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<TerminalSession, Error, RestartTerminalRequest>({
    meta: { errorMessage: "Failed to restart terminal." },
    mutationFn: ({ terminalId }) => sdk.terminals.restart({ terminalId }),
    onSuccess: (session) => {
      applyTerminalSessionUpsert(queryClient, session);
    },
  });
}

export interface CloseTerminalRequest {
  terminalId: string;
  mode: "force" | "if-clean";
}

export function useCloseTerminal() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<TerminalSession, Error, CloseTerminalRequest>({
    meta: { errorMessage: "Failed to close terminal." },
    mutationFn: ({ terminalId, mode }) =>
      sdk.terminals.close({ terminalId, mode }),
    onSuccess: (session) => {
      applyTerminalSessionClose(queryClient, session);
    },
  });
}

export interface RenameTerminalRequest {
  terminalId: string;
  title: string;
}

export function useRenameTerminal() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<TerminalSession, Error, RenameTerminalRequest>({
    meta: { errorMessage: "Failed to rename terminal." },
    mutationFn: ({ terminalId, title }) =>
      sdk.terminals.rename({ terminalId, title }),
    onSuccess: (session) => {
      applyTerminalSessionUpsert(queryClient, session);
    },
  });
}
