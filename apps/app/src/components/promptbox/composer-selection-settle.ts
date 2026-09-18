import { useEffect, useRef, useState } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { ExperimentalComposerSelection } from "@get-bb/plugin-sdk";

export const COMPOSER_SELECTION_SETTLE_TIMEOUT_MS = 15_000;

let settleTimeoutOverrideMs: number | null = null;

export function setComposerSelectionSettleTimeoutForTest(
  timeoutMs: number | null,
): void {
  settleTimeoutOverrideMs = timeoutMs;
}

export function resolveComposerSelectionDeadline(now = Date.now()): number {
  return (
    now + (settleTimeoutOverrideMs ?? COMPOSER_SELECTION_SETTLE_TIMEOUT_MS)
  );
}

export interface CommittedComposerState {
  version: number;
  isSettled: boolean;
}

interface Waiter<T> {
  predicate: (state: T) => boolean;
  resolve: (state: T) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CommittedStateObserver<T> {
  publish(state: T): void;
  current(): T | null;
  waitUntil(predicate: (state: T) => boolean, deadline: number): Promise<T>;
}

export function createCommittedStateObserver<T>(): CommittedStateObserver<T> {
  let current: T | null = null;
  const waiters = new Set<Waiter<T>>();
  const settle = (waiter: Waiter<T>, state: T) => {
    clearTimeout(waiter.timer);
    waiters.delete(waiter);
    waiter.resolve(state);
  };
  return {
    publish(state) {
      current = state;
      for (const waiter of [...waiters]) {
        if (waiter.predicate(state)) settle(waiter, state);
      }
    },
    current: () => current,
    waitUntil(predicate, deadline) {
      return new Promise<T>((resolve, reject) => {
        if (current !== null && predicate(current)) {
          resolve(current);
          return;
        }
        const waiter: Waiter<T> = {
          predicate,
          resolve,
          timer: setTimeout(
            () => {
              waiters.delete(waiter);
              if (current === null) {
                reject(new Error("This composer is not ready yet."));
                return;
              }
              resolve(current);
            },
            Math.max(0, deadline - Date.now()),
          ),
        };
        waiters.add(waiter);
      });
    },
  };
}

export interface CommittedComposerStateController<
  T extends CommittedComposerState,
> {
  observer: CommittedStateObserver<T>;
  version: number;
  commit(): number;
}

export function useCommittedComposerState<T extends CommittedComposerState>(
  buildState: (version: number) => T,
): CommittedComposerStateController<T> {
  const [version, setVersion] = useState(0);
  const versionRef = useRef(0);
  const [observer] = useState(() => createCommittedStateObserver<T>());
  const [controller] = useState<CommittedComposerStateController<T>>(() => ({
    observer,
    version: 0,
    commit: () => {
      versionRef.current += 1;
      setVersion(versionRef.current);
      return versionRef.current;
    },
  }));
  controller.version = version;
  const state = buildState(version);
  useEffect(() => {
    observer.publish(state);
  });
  return controller;
}

export function waitForSettledComposerState<T extends CommittedComposerState>(
  controller: CommittedComposerStateController<T>,
  deadline: number,
  requireSettled: boolean,
): Promise<T> {
  const version = controller.commit();
  return controller.observer.waitUntil(
    (state) => state.version >= version && (!requireSettled || state.isSettled),
    deadline,
  );
}

export function waitUntilComposerStateSettled<T extends CommittedComposerState>(
  controller: CommittedComposerStateController<T>,
  deadline: number,
): Promise<T> {
  return controller.observer.waitUntil((state) => state.isSettled, deadline);
}

export interface ExecutionSelectionState {
  selectedProviderId: string;
  selectedThreadModel: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  supportsServiceTier: boolean;
  permissionMode: PermissionMode;
}

export function readExecutionSelection(
  state: ExecutionSelectionState,
): ExperimentalComposerSelection {
  return {
    ...(state.selectedProviderId
      ? { providerId: state.selectedProviderId }
      : {}),
    ...(state.selectedThreadModel ? { model: state.selectedThreadModel } : {}),
    reasoningLevel: state.reasoningLevel,
    ...(state.supportsServiceTier && state.serviceTier !== undefined
      ? { serviceTier: state.serviceTier }
      : {}),
    permissionMode: state.permissionMode,
  };
}
