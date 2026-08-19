import {
  focusManager,
  MutationCache,
  QueryClient,
  type QueryClientConfig,
} from "@tanstack/react-query";
import {
  getMutationErrorMeta,
  showMutationErrorToast,
} from "./mutation-errors";
import { createBrowserLifecycleFetchController } from "@/hooks/cache-owners/browser-lifecycle-cache-owner";
import {
  shouldRetryTransientReadQuery,
  TRANSIENT_READ_RETRY_DELAY_MS,
} from "@/hooks/queries/query-helpers";

export interface CreateAppQueryClientOptions {
  defaultOptions?: QueryClientConfig["defaultOptions"];
  showMutationErrorToasts?: boolean;
}

export interface AppQueryClientBrowserEventCleanup {
  cleanup: () => void;
}

let appFocusEventsInstalled = false;

function installAppFocusEvents(): void {
  if (appFocusEventsInstalled) {
    return;
  }
  appFocusEventsInstalled = true;

  focusManager.setEventListener((handleFocus) => {
    if (typeof window === "undefined" || !window.addEventListener) {
      return;
    }

    const listener = () => handleFocus();
    window.addEventListener("visibilitychange", listener, false);
    window.addEventListener("pageshow", listener, false);

    return () => {
      window.removeEventListener("visibilitychange", listener);
      window.removeEventListener("pageshow", listener);
    };
  });
}

/**
 * Suspend cancels in-flight fetches; resume restarts only those. Catch-up
 * after a resume is otherwise owned by the realtime layer: `WebSocketManager`
 * probes or reconnects the socket when the document becomes visible or the
 * network returns, the reconnect wave refetches every realtime query whose
 * data predates the disconnect watermark, and change events merged while
 * hidden flush as one wave on visible. A separate resume invalidation of the
 * active thread bundle used to run here as well; it duplicated that wave on
 * every phone app switch and is gone.
 */
export function installAppQueryClientBrowserEvents(
  queryClient: QueryClient,
): AppQueryClientBrowserEventCleanup {
  installAppFocusEvents();

  if (typeof window === "undefined" || typeof document === "undefined") {
    return { cleanup: () => {} };
  }

  const fetchController = createBrowserLifecycleFetchController(queryClient);
  const handlePageHide = () => {
    fetchController.suspend();
  };
  const handlePageShow = () => {
    fetchController.resume();
  };
  const handleWindowFocus = () => {
    fetchController.resume();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      fetchController.suspend();
      return;
    }
    if (document.visibilityState === "visible") {
      fetchController.resume();
    }
  };

  window.addEventListener("pagehide", handlePageHide, false);
  window.addEventListener("pageshow", handlePageShow, false);
  window.addEventListener("focus", handleWindowFocus, false);
  document.addEventListener("visibilitychange", handleVisibilityChange, false);

  return {
    cleanup: () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}

export function createAppQueryClient(
  options: CreateAppQueryClientOptions = {},
): QueryClient {
  installAppFocusEvents();

  const defaultOptions = options.defaultOptions;
  const showMutationErrorToasts = options.showMutationErrorToasts ?? true;

  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!showMutationErrorToasts) {
          return;
        }

        // Set `showErrorToast: false` when the call site handles mutation errors itself.
        const meta = getMutationErrorMeta(mutation.meta);
        if (meta.showErrorToast === false) {
          return;
        }

        showMutationErrorToast({
          error,
          fallbackMessage: meta.errorMessage ?? "Request failed.",
          lifecycleOperation: meta.lifecycleOperation,
        });
      },
    }),
    defaultOptions: {
      ...defaultOptions,
      queries: {
        staleTime: 2000,
        refetchOnWindowFocus: true,
        retry: shouldRetryTransientReadQuery,
        retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
        ...defaultOptions?.queries,
      },
    },
  });
}
