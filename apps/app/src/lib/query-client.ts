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
import { invalidateActiveThreadBundleQueriesAfterBrowserResume } from "@/hooks/cache-owners/active-thread-lifecycle-cache-owner";
import { cancelActiveQueryFetchesForBrowserSuspend } from "@/hooks/cache-owners/browser-lifecycle-cache-owner";
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
const BROWSER_RESUME_INVALIDATION_DEDUPE_MS = 1000;

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

export function installAppQueryClientBrowserEvents(
  queryClient: QueryClient,
): AppQueryClientBrowserEventCleanup {
  installAppFocusEvents();

  if (typeof window === "undefined" || typeof document === "undefined") {
    return { cleanup: () => {} };
  }

  let browserWasSuspended = false;
  let lastResumeInvalidationAt = -BROWSER_RESUME_INVALIDATION_DEDUPE_MS;

  const handleBrowserSuspend = () => {
    browserWasSuspended = true;
    cancelActiveQueryFetchesForBrowserSuspend(queryClient);
  };
  const handleBrowserResume = () => {
    if (!browserWasSuspended) {
      return;
    }
    browserWasSuspended = false;

    const now = Date.now();
    if (now - lastResumeInvalidationAt < BROWSER_RESUME_INVALIDATION_DEDUPE_MS) {
      return;
    }
    lastResumeInvalidationAt = now;
    invalidateActiveThreadBundleQueriesAfterBrowserResume({ queryClient });
  };
  const handlePageHide = () => {
    handleBrowserSuspend();
  };
  const handlePageShow = () => {
    handleBrowserResume();
  };
  const handleWindowFocus = () => {
    handleBrowserResume();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      handleBrowserSuspend();
      return;
    }
    if (document.visibilityState === "visible") {
      handleBrowserResume();
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
