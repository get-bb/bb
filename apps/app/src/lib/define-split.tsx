import {
  isModuleDownloadFailure,
  isModuleImportFailure,
  recoverFromVisibleModuleImportFailure,
  reloadAfterModuleImportFailure,
} from "./stale-chunk-recovery";
import {
  prepareSplitImport,
  queueSplitPreload,
  trackCriticalLoad,
} from "./split-prefetch";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

export type SplitTier = "preload" | "intent";

type FailureProps = { retry: () => void };

export function SplitLoadFailure({ retry }: FailureProps) {
  return (
    <p role="alert" className="p-3 text-sm text-destructive">
      Could not load.{" "}
      <button type="button" className="underline" onClick={retry}>
        Try again
      </button>
    </p>
  );
}

function RetryWhenOnline({
  error,
  retry,
  children,
}: {
  error: unknown;
  retry: () => void;
  children: ReactNode;
}) {
  const retryWhenOnline = isModuleDownloadFailure(error);
  useEffect(() => {
    if (!retryWhenOnline) return;
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [retryWhenOnline, retry]);
  return children;
}

class SplitErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: unknown) => ReactNode },
  { failure: { error: unknown } | null }
> {
  override state: { failure: { error: unknown } | null } = { failure: null };

  static getDerivedStateFromError(error: unknown) {
    return { failure: { error } };
  }

  override componentDidCatch(error: unknown) {
    if (isModuleImportFailure(error)) recoverFromVisibleModuleImportFailure();
  }

  override render() {
    const { failure } = this.state;
    return failure === null
      ? this.props.children
      : this.props.fallback(failure.error);
  }
}

const DOWNLOAD_RETRY_DELAYS = [500, 1500];

async function loadWithDownloadRetries<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      const delay = DOWNLOAD_RETRY_DELAYS[attempt];
      if (delay === undefined || !isModuleDownloadFailure(error)) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function defineSplit<P extends object>({
  id,
  load,
  loading: Loading,
  error: ErrorView = SplitLoadFailure,
  tier,
  mountWhen,
  keepMounted = false,
  unmounted: Unmounted,
}: {
  id: string;
  load: () => Promise<ComponentType<P>>;
  loading: ComponentType<P>;
  error?: ComponentType<P & FailureProps>;
  tier: SplitTier;
  mountWhen?: (props: P) => boolean;
  keepMounted?: boolean;
  unmounted?: ComponentType<P>;
}) {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  let loaded: ComponentType<P> | null = null;
  const loadModule = () => {
    pending ??= prepareSplitImport(id)
      .then(() => loadWithDownloadRetries(load))
      .then((component) => {
        loaded = component;
        return { default: component };
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
  const renderModule = () => trackCriticalLoad(loadModule());
  const warm = async () => {
    await loadModule().catch(() => undefined);
  };
  const onIntent = () => {
    void warm();
  };
  if (tier === "preload") queueSplitPreload(warm);

  function SplitContent(props: P) {
    const [attempt, setAttempt] = useState(() => ({
      number: 0,
      View: loaded ?? lazy(renderModule),
    }));
    const retryInPlace = () => {
      setAttempt((previous) => ({
        number: previous.number + 1,
        View: loaded ?? lazy(renderModule),
      }));
    };
    const retry = (error: unknown) => {
      if (isModuleImportFailure(error) && reloadAfterModuleImportFailure()) {
        return;
      }
      retryInPlace();
    };
    const View = attempt.View;
    return (
      <SplitErrorBoundary
        key={attempt.number}
        fallback={(error) => (
          <RetryWhenOnline error={error} retry={retryInPlace}>
            <ErrorView {...props} retry={() => retry(error)} />
          </RetryWhenOnline>
        )}
      >
        <Suspense fallback={<Loading {...props} />}>
          <View {...props} />
        </Suspense>
      </SplitErrorBoundary>
    );
  }

  function SplitComponent(props: P) {
    const wanted = mountWhen?.(props) ?? true;
    const [mountedBefore, setMountedBefore] = useState(wanted);
    if (wanted && !mountedBefore) setMountedBefore(true);
    if (wanted || (keepMounted && mountedBefore && loaded !== null)) {
      return <SplitContent {...props} />;
    }
    return Unmounted ? <Unmounted {...props} /> : null;
  }

  return Object.assign(SplitComponent, {
    displayName: `Split(${id})`,
    id,
    tier,
    preload: warm,
    isLoaded: () => loaded !== null,
    intentProps: {
      onPointerEnter: onIntent,
      onFocus: onIntent,
      onPointerDown: onIntent,
    },
  });
}
