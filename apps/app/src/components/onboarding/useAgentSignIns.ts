import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnboardingFailureDetail,
  SystemProviderState,
  TerminalSession,
} from "@bb/server-contract";
import {
  operationFailureReason,
  resolveSignInCommand,
  type AgentSignInView,
  type OperationFailureReason,
} from "./onboarding-model";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

const SIGN_IN_POLL_INTERVAL_MS = 3_000;

export type SignInMethod = "local" | "remote";

interface SignInSession {
  providerId: string;
  session: TerminalSession;
  method: SignInMethod;
  hasAlternateMethod: boolean;
}

type SignInOutcome = "ready" | "exited" | "failed" | "cancelled";

type SignInFailureReason =
  | OperationFailureReason
  | "no_host"
  | "command_failed"
  | "unsupported";

interface SignInExit {
  exitCode: number | null;
  at: number;
  rowOpen: boolean;
}

export type RefetchProviderStates = (options: {
  cancelRefetch: boolean;
}) => void;

interface SignInFailureDetail {
  detail: OnboardingFailureDetail;
  exitCode?: number;
}

function signInExitFailure({ exitCode }: SignInExit): SignInFailureDetail {
  if (exitCode === null) return { detail: "signal" };
  const detail =
    exitCode === 127
      ? "not_found"
      : exitCode === 126
        ? "permission"
        : "exit_nonzero";
  return { detail, exitCode };
}

function exitOutcome(exit: SignInExit, ready: boolean): SignInOutcome {
  if (ready) return "ready";
  return exit.exitCode === 0 ? "exited" : "failed";
}

function agentReady(
  states: readonly SystemProviderState[] | undefined,
  providerId: string,
): boolean {
  return (
    states?.some(
      (state) => state.providerId === providerId && state.status === "ready",
    ) ?? false
  );
}

export interface AgentSignInTerminals {
  closeAbandoned: (args: { hostId: string; title: string }) => Promise<void>;
  create: (args: {
    hostId: string;
    title: string;
    command: string;
  }) => Promise<TerminalSession>;
  close: (terminalId: string) => void;
}

function withKey<T>(set: ReadonlySet<T>, key: T): ReadonlySet<T> {
  return set.has(key) ? set : new Set(set).add(key);
}

function withoutKey<T>(set: ReadonlySet<T>, key: T): ReadonlySet<T> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}

function withoutEntry<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

export function useAgentSignIns({
  redesign,
  entry,
  hostId,
  states,
  statesSettledAt,
  isLocalHost,
  terminals,
  refetchStates,
}: {
  redesign: boolean;
  entry: OnboardingEntry;
  hostId: string | null;
  states: readonly SystemProviderState[] | undefined;
  statesSettledAt: number;
  isLocalHost: (hostId: string) => boolean;
  terminals: AgentSignInTerminals;
  refetchStates: RefetchProviderStates;
}) {
  const [signIns, setSignIns] = useState<ReadonlyMap<string, SignInSession>>(
    () => new Map(),
  );
  const signInsRef = useRef<Map<string, SignInSession>>(new Map());
  const [views, setViews] = useState<ReadonlyMap<string, AgentSignInView>>(
    () => new Map(),
  );
  const [startingProviderIds, setStartingProviderIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [failedProviderIds, setFailedProviderIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const requestsRef = useRef<Map<string, number>>(new Map());
  const [exits, setExits] = useState<ReadonlyMap<string, SignInExit>>(
    () => new Map(),
  );
  const exitsRef = useRef<Map<string, SignInExit>>(new Map());
  const statesRef = useRef(states);
  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const record = useCallback(
    (
      providerId: string,
      outcome: SignInOutcome | "started",
      failureReason?: SignInFailureReason,
      failure?: SignInFailureDetail,
    ) =>
      recordTelemetryEvent({
        name: "onboarding_sign_in",
        properties: {
          entry,
          outcome,
          resource_id: providerId,
          ...(failureReason === undefined
            ? {}
            : { failure_reason: failureReason }),
          ...(failure === undefined ? {} : { failure_detail: failure.detail }),
          ...(failure?.exitCode === undefined
            ? {}
            : { exit_code: failure.exitCode }),
        },
      }),
    [entry],
  );

  const recordOutcome = useCallback(
    (
      providerId: string,
      outcome: SignInOutcome,
      failure?: SignInFailureDetail,
    ) =>
      outcome === "failed"
        ? record(providerId, outcome, "command_failed", failure)
        : record(providerId, outcome),
    [record],
  );

  const bumpRequest = (providerId: string): number => {
    const next = (requestsRef.current.get(providerId) ?? 0) + 1;
    requestsRef.current.set(providerId, next);
    return next;
  };

  const closeRow = useCallback(
    (
      providerId: string,
      outcome: SignInOutcome | null,
      refetch: boolean,
      failure?: SignInFailureDetail,
    ) => {
      const current = signInsRef.current.get(providerId);
      if (current === undefined) return;
      signInsRef.current.delete(providerId);
      if (outcome !== null) recordOutcome(providerId, outcome, failure);
      setSignIns(new Map(signInsRef.current));
      setViews((previous) => withoutEntry(previous, providerId));
      terminals.close(current.session.id);
      if (refetch) refetchStates({ cancelRefetch: true });
    },
    [recordOutcome, refetchStates, terminals],
  );

  const takeExit = useCallback((providerId: string) => {
    const exit = exitsRef.current.get(providerId);
    if (exit === undefined) return undefined;
    exitsRef.current.delete(providerId);
    setExits(new Map(exitsRef.current));
    return exit;
  }, []);

  const resolveExit = useCallback(
    (providerId: string, ready: boolean) => {
      const exit = takeExit(providerId);
      if (exit === undefined) return;
      const outcome = exitOutcome(exit, ready);
      if (!exit.rowOpen) {
        recordOutcome(providerId, outcome, signInExitFailure(exit));
        return;
      }
      if (!ready) setFailedProviderIds((ids) => withKey(ids, providerId));
      closeRow(providerId, outcome, false, signInExitFailure(exit));
    },
    [closeRow, recordOutcome, takeExit],
  );

  const end = useCallback(
    (
      providerId: string,
      outcome: SignInOutcome = "cancelled",
      failure?: SignInFailureDetail,
    ) => {
      if (!signInsRef.current.has(providerId)) {
        const request = requestsRef.current.get(providerId);
        if (request !== undefined) {
          requestsRef.current.set(providerId, request + 1);
          setStartingProviderIds((ids) => withoutKey(ids, providerId));
        }
        return;
      }
      takeExit(providerId);
      closeRow(providerId, outcome, true, failure);
    },
    [closeRow, takeExit],
  );

  const endRef = useRef(end);
  const resolveExitRef = useRef(resolveExit);
  useEffect(() => {
    endRef.current = end;
    resolveExitRef.current = resolveExit;
  }, [end, resolveExit]);
  useEffect(
    () => () => {
      for (const providerId of requestsRef.current.keys()) {
        requestsRef.current.set(
          providerId,
          (requestsRef.current.get(providerId) ?? 0) + 1,
        );
      }
      for (const providerId of [...exitsRef.current.keys()]) {
        resolveExitRef.current(
          providerId,
          agentReady(statesRef.current, providerId),
        );
      }
      for (const providerId of [...signInsRef.current.keys()]) {
        endRef.current(providerId);
      }
    },
    [],
  );

  const fail = useCallback(
    (providerId: string) => {
      if (!signInsRef.current.has(providerId)) return;
      setFailedProviderIds((ids) => withKey(ids, providerId));
      end(providerId, "failed", { detail: "login_failed" });
    },
    [end],
  );

  const handleExit = useCallback(
    (providerId: string, exitCode: number | null) => {
      if (
        !signInsRef.current.has(providerId) ||
        exitsRef.current.has(providerId)
      ) {
        return;
      }
      exitsRef.current.set(providerId, {
        exitCode,
        at: Date.now(),
        rowOpen: redesign,
      });
      setExits(new Map(exitsRef.current));
      if (!redesign) {
        if (exitCode !== 0) {
          setFailedProviderIds((ids) => withKey(ids, providerId));
        }
        closeRow(providerId, null, false);
      }
      refetchStates({ cancelRefetch: true });
    },
    [closeRow, redesign, refetchStates],
  );

  useEffect(() => {
    for (const [providerId, exit] of exits) {
      if (statesSettledAt <= exit.at) continue;
      resolveExit(providerId, agentReady(states, providerId));
    }
  }, [exits, resolveExit, states, statesSettledAt]);

  const setView = useCallback((providerId: string, view: AgentSignInView) => {
    setViews((previous) =>
      previous.get(providerId) === view
        ? previous
        : new Map(previous).set(providerId, view),
    );
  }, []);

  const activeCount = signIns.size;
  useEffect(() => {
    if (activeCount === 0) return;
    const interval = window.setInterval(
      () => refetchStates({ cancelRefetch: !redesign }),
      SIGN_IN_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [activeCount, redesign, refetchStates]);

  useEffect(() => {
    for (const providerId of signIns.keys()) {
      const status = states?.find(
        (state) => state.providerId === providerId,
      )?.status;
      if (status === "ready") end(providerId, "ready");
    }
  }, [end, signIns, states]);

  const start = async (providerId: string, requestedMethod?: SignInMethod) => {
    const state = states?.find((entry) => entry.providerId === providerId);
    if (hostId === null || state === undefined) {
      record(providerId, "failed", hostId === null ? "no_host" : "not_found");
      return;
    }
    const method =
      requestedMethod ?? (isLocalHost(hostId) ? "local" : "remote");
    const command = resolveSignInCommand(state, method === "local");
    if (command === null) {
      record(providerId, "failed", "unsupported");
      return;
    }
    if (exitsRef.current.get(providerId)?.rowOpen === false) {
      resolveExit(providerId, agentReady(states, providerId));
    }
    if (redesign) {
      end(providerId);
    } else {
      for (const other of [...signInsRef.current.keys()]) end(other);
      for (const other of requestsRef.current.keys()) {
        if (other !== providerId) bumpRequest(other);
      }
      setStartingProviderIds(new Set());
      setFailedProviderIds(new Set());
    }
    setFailedProviderIds((ids) => withoutKey(ids, providerId));
    const request = bumpRequest(providerId);
    setStartingProviderIds((ids) => withKey(ids, providerId));
    record(providerId, "started");
    const title = `Sign in to ${state.displayName}`;
    await terminals.closeAbandoned({ hostId, title });
    let session: TerminalSession;
    try {
      session = await terminals.create({ hostId, title, command });
    } catch (error) {
      if (requestsRef.current.get(providerId) === request) {
        setStartingProviderIds((ids) => withoutKey(ids, providerId));
      }
      record(providerId, "failed", operationFailureReason(error));
      return;
    }
    if (requestsRef.current.get(providerId) !== request) {
      record(providerId, "cancelled");
      terminals.close(session.id);
      return;
    }
    signInsRef.current.set(providerId, {
      providerId,
      session,
      method,
      hasAlternateMethod:
        state.localLoginCommand !== null &&
        state.loginCommand !== null &&
        state.localLoginCommand !== state.loginCommand,
    });
    setViews((previous) => withoutEntry(previous, providerId));
    setStartingProviderIds((ids) => withoutKey(ids, providerId));
    setSignIns(new Map(signInsRef.current));
  };

  return {
    signIns,
    views,
    startingProviderIds,
    failedProviderIds,
    start,
    end,
    fail,
    handleExit,
    setView,
  };
}
