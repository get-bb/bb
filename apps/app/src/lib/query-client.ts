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

interface CreateAppQueryClientOptions {
  defaultOptions?: QueryClientConfig["defaultOptions"];
  showMutationErrorToasts?: boolean;
  shouldRefetchOnWindowFocus?: () => boolean;
}

interface AppQueryClientBrowserEventCleanup {
  cleanup: () => void;
}

let appFocusEventsInstalled = false;

function installAppFocusEvents(): void {
  if (appFocusEventsInstalled) {
    return;
  }
  appFocusEventsInstalled = true;

  focusManager.setEventListener((handleFocus) => {
    const browserWindow = globalThis.window;
    if (
      browserWindow === undefined ||
      browserWindow.addEventListener === undefined
    ) {
      return;
    }

    const listener = () => handleFocus();
    browserWindow.addEventListener("visibilitychange", listener, false);
    browserWindow.addEventListener("pageshow", listener, false);

    return () => {
      browserWindow.removeEventListener("visibilitychange", listener);
      browserWindow.removeEventListener("pageshow", listener);
    };
  });
}

export function installAppQueryClientBrowserEvents(
  queryClient: QueryClient,
): AppQueryClientBrowserEventCleanup {
  installAppFocusEvents();

  const browserWindow = globalThis.window;
  const browserDocument = globalThis.document;
  if (browserWindow === undefined || browserDocument === undefined) {
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

  browserWindow.addEventListener("pagehide", handlePageHide, false);
  browserWindow.addEventListener("pageshow", handlePageShow, false);
  browserWindow.addEventListener("focus", handleWindowFocus, false);
  browserDocument.addEventListener(
    "visibilitychange",
    handleVisibilityChange,
    false,
  );

  return {
    cleanup: () => {
      browserWindow.removeEventListener("pagehide", handlePageHide);
      browserWindow.removeEventListener("pageshow", handlePageShow);
      browserWindow.removeEventListener("focus", handleWindowFocus);
      browserDocument.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    },
  };
}

export function createAppQueryClient(
  options: CreateAppQueryClientOptions = {},
): QueryClient {
  installAppFocusEvents();

  const defaultOptions = options.defaultOptions;
  const showMutationErrorToasts = options.showMutationErrorToasts ?? true;
  const shouldRefetchOnWindowFocus = options.shouldRefetchOnWindowFocus;

  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!showMutationErrorToasts) {
          return;
        }

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
        refetchOnWindowFocus:
          shouldRefetchOnWindowFocus === undefined
            ? true
            : () => shouldRefetchOnWindowFocus(),
        refetchOnReconnect:
          shouldRefetchOnWindowFocus === undefined
            ? true
            : () => shouldRefetchOnWindowFocus(),
        retry: shouldRetryTransientReadQuery,
        retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
        ...defaultOptions?.queries,
      },
    },
  });
}
