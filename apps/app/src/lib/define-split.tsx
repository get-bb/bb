import { prepareSplitImport } from "./split-prefetch";
import {
  Component,
  lazy,
  Suspense,
  useState,
  useEffect,
  type ComponentType,
  type ReactNode,
} from "react";

export type SplitPreloadPolicy = "render" | "intent" | "startup" | "idle";

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
  preload,
}: {
  id: string;
  load: () => Promise<ComponentType<P>>;
  loading: ComponentType<P>;
  error?: ComponentType<P & FailureProps>;
  preload: SplitPreloadPolicy;
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
  const warm = async () => {
    await loadModule().catch(() => undefined);
  };
  const onIntent = () => {
    if (preload !== "render") void warm();
  };

  function SplitComponent(props: P) {
    const [attempt, setAttempt] = useState(() => ({
      number: 0,
      View: loaded ?? lazy(loadModule),
    }));
    const retry = () => {
      setAttempt((previous) => ({
        number: previous.number + 1,
        View: loaded ?? lazy(loadModule),
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

export function useSplitPreload(split: {
  preloadPolicy: SplitPreloadPolicy;
  preload: () => Promise<void>;
}) {
  useEffect(() => {
    if (split.preloadPolicy === "startup") {
      void split.preload();
      return;
    }
    if (split.preloadPolicy !== "idle") return;
    let idle: number | undefined;
    let timeout: number | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (typeof window.requestIdleCallback === "function") {
          idle = window.requestIdleCallback(() => void split.preload(), {
            timeout: 1000,
          });
        } else {
          timeout = window.setTimeout(() => void split.preload(), 1000);
        }
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [split]);
}
