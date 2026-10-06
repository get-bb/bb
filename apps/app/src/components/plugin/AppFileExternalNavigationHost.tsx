import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import { defineSplit } from "@/lib/define-split";

const MAX_PENDING_EXTERNAL_FILE_INTENTS = 32;

function SettleOnLoadFailure({ onSettled }: { onSettled: () => void }) {
  useEffect(() => onSettled(), [onSettled]);
  return null;
}

const LazyAppFileExternalNavigationDispatcher = defineSplit<{
  intent: ExperimentalFileOpenOptions;
  onSettled: () => void;
}>({
  id: "app-file-external-navigation-dispatcher",
  load: () =>
    import("./AppFileExternalNavigationDispatcher").then(
      (module) => module.AppFileExternalNavigationDispatcher,
    ),
  loading: () => null,
  error: SettleOnLoadFailure,
  tier: "intent",
});

interface ExternalFileIntentRequest {
  id: number;
  intent: ExperimentalFileOpenOptions;
}

export function AppFileExternalNavigationHost({
  children,
}: {
  children: ReactNode;
}) {
  const [queue, setQueue] = useState<ExternalFileIntentRequest[]>([]);
  const queueRef = useRef(queue);
  const nextRequestIdRef = useRef(0);
  const replaceQueue = useCallback((next: ExternalFileIntentRequest[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);
  const openFileExternally = useCallback(
    (intent: ExperimentalFileOpenOptions): boolean => {
      if (queueRef.current.length >= MAX_PENDING_EXTERNAL_FILE_INTENTS) {
        return false;
      }
      const request = { id: nextRequestIdRef.current, intent };
      nextRequestIdRef.current += 1;
      replaceQueue([...queueRef.current, request]);
      return true;
    },
    [replaceQueue],
  );
  const current = queue[0] ?? null;
  const settleCurrent = useCallback(() => {
    replaceQueue(queueRef.current.slice(1));
  }, [replaceQueue]);

  const capabilities = useMemo(
    () => ({ openFileExternally }),
    [openFileExternally],
  );
  return (
    <AppNavigationHostProvider capabilities={capabilities}>
      {children}
      {current === null ? null : (
        <LazyAppFileExternalNavigationDispatcher
          key={current.id}
          intent={current.intent}
          onSettled={settleCurrent}
        />
      )}
    </AppNavigationHostProvider>
  );
}
