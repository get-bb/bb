import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { disableGlobalCursorStyles } from "react-resizable-panels";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppToaster } from "./components/AppToaster";
import { registerProviderCliInstallQueryClient } from "./components/provider-cli/provider-cli-install-store";
import { initializePreferredTheme } from "./hooks/useTheme";
import { initializeFavicon } from "./lib/favicon-color-preference";
import { installForeignDomMutationGuard } from "./lib/foreign-dom-mutation-guard";
import {
  createAppQueryClient,
  installAppQueryClientBrowserEvents,
} from "./lib/query-client";
import { applyCachedAppThemeCss } from "./lib/themes";
import { wsManager } from "./lib/ws";
import "./app.css";

installForeignDomMutationGuard();

Error.stackTraceLimit = 50;

const queryClient = createAppQueryClient({
  shouldRefetchOnWindowFocus: () =>
    wsManager.getConnectionState() !== "connected",
});
installAppQueryClientBrowserEvents(queryClient);
registerProviderCliInstallQueryClient(queryClient);

initializePreferredTheme();
applyCachedAppThemeCss();
initializeFavicon();
disableGlobalCursorStyles();

createRoot(document.getElementById("root")!, {
  onUncaughtError: (error, errorInfo) => {
    console.error(
      "[bb] uncaught render error — the app root was torn down",
      error,
      errorInfo.componentStack,
    );
  },
}).render(
  <StrictMode>
    {}
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <AppToaster position="bottom-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
