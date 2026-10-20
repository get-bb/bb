import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { atom, useAtomValue, useStore } from "jotai";
import { customAlphabet } from "nanoid";
import { GENERATED_ID_ALPHABET, GENERATED_ID_SUFFIX_LENGTH } from "@bb/domain";
import type {
  CreateTerminalRequest,
  TerminalSession,
} from "@bb/server-contract";
import { applyTerminalSessionUpsert } from "@/hooks/cache-owners/terminal-cache-owner";
import { useCloseTerminal } from "@/hooks/queries/thread-terminal-queries";
import { asHttpError } from "@/lib/http-error";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { sdk } from "@/lib/sdk";
import { isVisibleTerminalSession } from "@/lib/terminal-session-visibility";

export type TerminalStartRequest = Omit<CreateTerminalRequest, "id">;

export interface TerminalStart {
  error: string | null;
  request: TerminalStartRequest;
}

export interface PendingTerminalIds {
  closing: ReadonlySet<string>;
  starting: ReadonlySet<string>;
}

export interface PendingTerminals {
  close: (terminalId: string, restoreTab: () => void) => void;
  discard: (terminalId: string) => TerminalStart | null;
  start: (request: TerminalStartRequest) => string;
}

const pendingTerminalsAtom = atom<ReadonlyMap<string, TerminalStart>>(
  new Map(),
);
const closingTerminalIdsAtom = atom<ReadonlySet<string>>(new Set<string>());
const pendingTerminalIdsAtom = atom<PendingTerminalIds>((get) => ({
  closing: get(closingTerminalIdsAtom),
  starting: new Set(get(pendingTerminalsAtom).keys()),
}));

const createTerminalIdSuffix = customAlphabet(
  GENERATED_ID_ALPHABET,
  GENERATED_ID_SUFFIX_LENGTH,
);

async function findCreatedTerminal(
  terminalId: string,
  error: unknown,
): Promise<TerminalSession | null> {
  if (asHttpError(error) !== null) return null;
  const session = await sdk.terminals.get({ terminalId }).catch(() => null);
  return session !== null && isVisibleTerminalSession(session) ? session : null;
}

export function usePendingTerminalIds(): PendingTerminalIds {
  return useAtomValue(pendingTerminalIdsAtom);
}

export function useTerminalStart(terminalId: string): TerminalStart | null {
  return useAtomValue(pendingTerminalsAtom).get(terminalId) ?? null;
}

export function usePendingTerminals(): PendingTerminals {
  const queryClient = useQueryClient();
  const store = useStore();
  const { mutateAsync: closeTerminal } = useCloseTerminal();

  const setStart = useCallback(
    (terminalId: string, start: TerminalStart | null) => {
      const next = new Map(store.get(pendingTerminalsAtom));
      if (start === null) {
        next.delete(terminalId);
      } else {
        next.set(terminalId, start);
      }
      store.set(pendingTerminalsAtom, next);
    },
    [store],
  );

  const run = useCallback(
    async (
      terminalId: string,
      { target, ...request }: TerminalStartRequest,
    ) => {
      const isWanted = () => store.get(pendingTerminalsAtom).has(terminalId);
      let session: TerminalSession;
      try {
        session = await sdk.terminals.create({
          ...request,
          id: terminalId,
          scope: target,
        });
      } catch (error) {
        const created = await findCreatedTerminal(terminalId, error);
        if (created === null) {
          if (!isWanted()) return;
          setStart(terminalId, {
            error: getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to start terminal.",
              lifecycleOperation: "open_terminal",
            }),
            request: { ...request, target },
          });
          return;
        }
        session = created;
      }
      if (!isWanted()) {
        await closeTerminal({ mode: "force", terminalId }).catch(
          () => undefined,
        );
        return;
      }
      applyTerminalSessionUpsert({ queryClient, session });
      setStart(terminalId, null);
    },
    [closeTerminal, queryClient, setStart, store],
  );

  const start = useCallback(
    (request: TerminalStartRequest) => {
      const terminalId = `term_${createTerminalIdSuffix()}`;
      setStart(terminalId, { error: null, request });
      void run(terminalId, request);
      return terminalId;
    },
    [run, setStart],
  );

  const setClosing = useCallback(
    (terminalId: string, closing: boolean) => {
      const next = new Set(store.get(closingTerminalIdsAtom));
      if (closing) {
        next.add(terminalId);
      } else {
        next.delete(terminalId);
      }
      store.set(closingTerminalIdsAtom, next);
    },
    [store],
  );

  const close = useCallback(
    (terminalId: string, restoreTab: () => void) => {
      setClosing(terminalId, true);
      void closeTerminal({ mode: "force", terminalId }).then(
        () => setClosing(terminalId, false),
        () => {
          restoreTab();
          setClosing(terminalId, false);
        },
      );
    },
    [closeTerminal, setClosing],
  );

  const discard = useCallback(
    (terminalId: string) => {
      const current = store.get(pendingTerminalsAtom).get(terminalId) ?? null;
      if (current !== null) setStart(terminalId, null);
      return current;
    },
    [setStart, store],
  );

  return { close, discard, start };
}
