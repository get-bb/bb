import {
  Component,
  createContext,
  lazy,
  Suspense,
  useContext,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

export type SplitPreloadPolicy = "render" | "intent" | "idle" | "startup";

type SplitPreview = {
  state: "loading" | "error";
  onRetry: () => void;
};

const SplitPreviewContext = createContext<ReadonlyMap<string, SplitPreview>>(
  new Map(),
);

export function SplitPreviewProvider({
  id,
  state,
  onRetry,
  children,
}: SplitPreview & { id: string; children: ReactNode }) {
  const parent = useContext(SplitPreviewContext);
  return (
    <SplitPreviewContext.Provider
      value={new Map(parent).set(id, { state, onRetry })}
    >
      {children}
    </SplitPreviewContext.Provider>
  );
}

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

export interface PreloadableSplit {
  id: string;
  preloadPolicy: SplitPreloadPolicy;
  preload: () => Promise<void>;
}

export function defineSplit<P extends object>({
  id,
  load,
  loading: Loading,
  error: ErrorView = SplitLoadFailure,
  preload,
}: {
  id: string;
  load: () => Promise<ComponentType<P>>;
  loading: ComponentType<P>;
  error?: ComponentType<P & FailureProps>;
  preload: SplitPreloadPolicy;
}) {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const loadModule = () => {
    pending ??= Promise.resolve()
      .then(load)
      .then((component) => ({ default: component }))
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
  const warm = async () => {
    await loadModule().catch(() => undefined);
  };
  const onIntent = () => {
    if (preload === "intent") void warm();
  };

  function SplitComponent(props: P) {
    const preview = useContext(SplitPreviewContext).get(id);
    const [attempt, setAttempt] = useState(() => ({
      number: 0,
      View: lazy(loadModule),
    }));
    const retry = () => {
      setAttempt((previous) => ({
        number: previous.number + 1,
        View: lazy(loadModule),
      }));
    };
    if (preview?.state === "loading") return <Loading {...props} />;
    if (preview?.state === "error") {
      return <ErrorView {...props} retry={preview.onRetry} />;
    }
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

  return Object.assign(SplitComponent, {
    displayName: `Split(${id})`,
    id,
    preloadPolicy: preload,
    preload: warm,
    intentProps: {
      onPointerEnter: onIntent,
      onFocus: onIntent,
      onPointerDown: onIntent,
    },
  });
}

export function scheduleSplitPreloads(splits: readonly PreloadableSplit[]) {
  const idleSplits = splits.filter((split) => split.preloadPolicy === "idle");
  for (const split of splits) {
    if (split.preloadPolicy === "startup") void split.preload();
  }
  if (idleSplits.length === 0) return () => {};

  let cancelled = false;
  let idle: number | null = null;
  let timeout: number | null = null;
  let frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(() => {
      const warm = () => {
        if (!cancelled) {
          for (const split of idleSplits) void split.preload();
        }
      };
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(warm, { timeout: 1000 });
      } else {
        timeout = window.setTimeout(warm, 1000);
      }
    });
  });
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    if (idle !== null) window.cancelIdleCallback(idle);
    if (timeout !== null) window.clearTimeout(timeout);
  };
}
