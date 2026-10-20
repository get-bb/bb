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

export interface TerminalStarts {
  discard: (terminalId: string) => TerminalStart | null;
  start: (request: TerminalStartRequest) => string;
}

const terminalStartsAtom = atom<ReadonlyMap<string, TerminalStart>>(new Map());
const startingTerminalIdsAtom = atom<ReadonlySet<string>>(
  (get) => new Set(get(terminalStartsAtom).keys()),
);

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

export function useStartingTerminalIds(): ReadonlySet<string> {
  return useAtomValue(startingTerminalIdsAtom);
}

export function useTerminalStart(terminalId: string): TerminalStart | null {
  return useAtomValue(terminalStartsAtom).get(terminalId) ?? null;
}

export function useTerminalStarts(): TerminalStarts {
  const queryClient = useQueryClient();
  const store = useStore();
  const { mutateAsync: closeTerminal } = useCloseTerminal();

  const setStart = useCallback(
    (terminalId: string, start: TerminalStart | null) => {
      const next = new Map(store.get(terminalStartsAtom));
      if (start === null) {
        next.delete(terminalId);
      } else {
        next.set(terminalId, start);
      }
      store.set(terminalStartsAtom, next);
    },
    [store],
  );

  const run = useCallback(
    async (
      terminalId: string,
      { target, ...request }: TerminalStartRequest,
    ) => {
      const isWanted = () => store.get(terminalStartsAtom).has(terminalId);
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

  const discard = useCallback(
    (terminalId: string) => {
      const current = store.get(terminalStartsAtom).get(terminalId) ?? null;
      if (current !== null) setStart(terminalId, null);
      return current;
    },
    [setStart, store],
  );

  return { discard, start };
}
