import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";

const MAX_PENDING_EXTERNAL_FILE_INTENTS = 32;
const LazyAppFileExternalNavigationDispatcher = lazy(() =>
  import("./AppFileExternalNavigationDispatcher").then(
    ({ AppFileExternalNavigationDispatcher }) => ({
      default: AppFileExternalNavigationDispatcher,
    }),
  ),
);

/** App-wide preferred-external file dispatcher; discovery starts on activation. */
export function AppFileExternalNavigationHost({
  children,
}: {
  children: ReactNode;
}) {
  const [queue, setQueue] = useState<ExperimentalFileOpenOptions[]>([]);
  const queueRef = useRef(queue);
  const replaceQueue = useCallback((next: ExperimentalFileOpenOptions[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);
  const openFileExternally = useCallback(
    (intent: ExperimentalFileOpenOptions): boolean => {
      if (queueRef.current.length >= MAX_PENDING_EXTERNAL_FILE_INTENTS) {
        return false;
      }
      // Public SDK callers are parsed by useBbNavigate before capabilities are
      // invoked; this host only queues that already-normalized internal value.
      replaceQueue([...queueRef.current, intent]);
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
        <Suspense fallback={null}>
          <LazyAppFileExternalNavigationDispatcher
            intent={current}
            onSettled={settleCurrent}
          />
        </Suspense>
      )}
    </AppNavigationHostProvider>
  );
}
