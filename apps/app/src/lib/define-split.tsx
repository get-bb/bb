import {
  prepareSplitImport,
  queueSplitPreload,
  trackCriticalLoad,
} from "./split-prefetch";
import {
  Component,
  lazy,
  Suspense,
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

class SplitErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const DOWNLOAD_RETRY_DELAYS = [500, 1500];

function isChunkDownloadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^(Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed)/i.test(
      error.message,
    )
  );
}

async function loadWithDownloadRetries<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      const delay = DOWNLOAD_RETRY_DELAYS[attempt];
      if (delay === undefined || !isChunkDownloadError(error)) throw error;
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
    const retry = () => {
      setAttempt((previous) => ({
        number: previous.number + 1,
        View: loaded ?? lazy(renderModule),
      }));
    };
    const View = attempt.View;
    return (
      <SplitErrorBoundary
        key={attempt.number}
        fallback={<ErrorView {...props} retry={retry} />}
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
    if (wanted || (keepMounted && mountedBefore)) {
      return <SplitContent {...props} />;
    }
    return Unmounted ? <Unmounted {...props} /> : null;
  }

  return Object.assign(SplitComponent, {
    displayName: `Split(${id})`,
    id,
    tier,
    preload: warm,
    intentProps: {
      onPointerEnter: onIntent,
      onFocus: onIntent,
      onPointerDown: onIntent,
    },
  });
}
