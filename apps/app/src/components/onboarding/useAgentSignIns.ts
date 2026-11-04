import { useCallback, useEffect, useRef, useState } from "react";
import type { SystemProviderState, TerminalSession } from "@bb/server-contract";
import type { AgentSignInView } from "./OnboardingViews";
import { resolveSignInCommand } from "./onboarding-model";
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
  entry,
  hostId,
  states,
  isLocalHost,
  terminals,
  refetchStates,
}: {
  concurrent: boolean;
  entry: OnboardingEntry;
  hostId: string | null;
  states: readonly SystemProviderState[] | undefined;
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

  const bumpRequest = (providerId: string): number => {
    const next = (requestsRef.current.get(providerId) ?? 0) + 1;
    requestsRef.current.set(providerId, next);
    return next;
  };

  const end = useCallback(
    (providerId: string, outcome: SignInOutcome = "cancelled") => {
      const current = signInsRef.current.get(providerId);
      if (current === undefined) return;
      signInsRef.current.delete(providerId);
      recordTelemetryEvent({
        name: "onboarding_sign_in",
        properties: { entry, outcome },
      });
      setSignIns(new Map(signInsRef.current));
      setViews((previous) => withoutEntry(previous, providerId));
      terminals.close(current.session.id);
      refetchStates();
    },
    [entry, refetchStates, terminals],
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
    (providerId: string) => {
      if (!signInsRef.current.has(providerId)) return;
      setFailedProviderIds((ids) => withKey(ids, providerId));
      end(providerId, "failed");
    },
    [end],
  );

  const handleExit = useCallback(
    (providerId: string, exitCode: number | null) => {
      if (exitCode !== 0) {
        fail(providerId);
        return;
      }
      end(providerId, "exited");
    },
    [end, fail],
  );

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
    if (hostId === null || state === undefined) return;
    const method =
      requestedMethod ?? (isLocalHost(hostId) ? "local" : "remote");
    const command = resolveSignInCommand(state, method === "local");
    if (command === null) return;
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
    recordTelemetryEvent({
      name: "onboarding_sign_in",
      properties: { entry, outcome: "started" },
    });
    const title = `Sign in to ${state.displayName}`;
    await terminals.closeAbandoned({ hostId, title });
    let session: TerminalSession;
    try {
      session = await terminals.create({ hostId, title, command });
    } catch {
      if (requestsRef.current.get(providerId) === request) {
        setStartingProviderIds((ids) => withoutKey(ids, providerId));
      }
      recordTelemetryEvent({
        name: "onboarding_sign_in",
        properties: { entry, outcome: "failed" },
      });
      return;
    }
    if (requestsRef.current.get(providerId) !== request) {
      recordTelemetryEvent({
        name: "onboarding_sign_in",
        properties: { entry, outcome: "cancelled" },
      });
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
