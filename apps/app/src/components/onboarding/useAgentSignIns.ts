import { useCallback, useEffect, useRef, useState } from "react";
import type { SystemProviderState, TerminalSession } from "@bb/server-contract";
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
  concurrent,
  failUnreadyExits,
  entry,
  hostId,
  states,
  statesSettledAt,
  isLocalHost,
  terminals,
  refetchStates,
}: {
  concurrent: boolean;
  failUnreadyExits: boolean;
  entry: OnboardingEntry;
  hostId: string | null;
  states: readonly SystemProviderState[] | undefined;
  statesSettledAt: number;
  isLocalHost: (hostId: string) => boolean;
  terminals: AgentSignInTerminals;
  refetchStates: () => void;
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

  const record = useCallback(
    (
      providerId: string,
      outcome: SignInOutcome | "started",
      failureReason?: SignInFailureReason,
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
        },
      }),
    [entry],
  );

  const bumpRequest = (providerId: string): number => {
    const next = (requestsRef.current.get(providerId) ?? 0) + 1;
    requestsRef.current.set(providerId, next);
    return next;
  };

  const end = useCallback(
    (
      providerId: string,
      outcome: SignInOutcome = "cancelled",
      failureReason?: SignInFailureReason,
    ) => {
      const current = signInsRef.current.get(providerId);
      if (current === undefined) {
        const request = requestsRef.current.get(providerId);
        if (request !== undefined) {
          requestsRef.current.set(providerId, request + 1);
          setStartingProviderIds((ids) => withoutKey(ids, providerId));
        }
        return;
      }
      signInsRef.current.delete(providerId);
      if (exitsRef.current.delete(providerId)) {
        setExits(new Map(exitsRef.current));
      }
      record(providerId, outcome, failureReason);
      setSignIns(new Map(signInsRef.current));
      setViews((previous) => withoutEntry(previous, providerId));
      terminals.close(current.session.id);
      refetchStates();
    },
    [record, refetchStates, terminals],
  );

  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  }, [end]);
  useEffect(
    () => () => {
      for (const providerId of requestsRef.current.keys()) {
        requestsRef.current.set(
          providerId,
          (requestsRef.current.get(providerId) ?? 0) + 1,
        );
      }
      for (const providerId of [...signInsRef.current.keys()]) {
        endRef.current(providerId);
      }
    },
    [],
  );

  const fail = useCallback(
    (providerId: string, outcome: "exited" | "failed" = "failed") => {
      if (!signInsRef.current.has(providerId)) return;
      setFailedProviderIds((ids) => withKey(ids, providerId));
      end(
        providerId,
        outcome,
        outcome === "failed" ? "command_failed" : undefined,
      );
    },
    [end],
  );

  const handleExit = useCallback(
    (providerId: string, exitCode: number | null) => {
      if (!failUnreadyExits) {
        if (exitCode !== 0) {
          fail(providerId);
          return;
        }
        end(providerId, "exited");
        return;
      }
      if (
        !signInsRef.current.has(providerId) ||
        exitsRef.current.has(providerId)
      ) {
        return;
      }
      exitsRef.current.set(providerId, { exitCode, at: Date.now() });
      setExits(new Map(exitsRef.current));
      refetchStates();
    },
    [end, fail, failUnreadyExits, refetchStates],
  );

  useEffect(() => {
    for (const [providerId, exit] of exits) {
      if (statesSettledAt <= exit.at) continue;
      const ready = states?.some(
        (state) => state.providerId === providerId && state.status === "ready",
      );
      if (ready === true) {
        end(providerId, "ready");
      } else {
        fail(providerId, exit.exitCode === 0 ? "exited" : "failed");
      }
    }
  }, [end, exits, fail, states, statesSettledAt]);

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
      refetchStates,
      SIGN_IN_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [activeCount, refetchStates]);

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
    if (concurrent) {
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
