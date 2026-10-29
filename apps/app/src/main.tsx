import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ApplicationUrlDialog } from "./components/ApplicationUrlDialog";
import { AppToaster } from "./components/AppToaster";
import { registerProviderCliInstallQueryClient } from "./components/provider-cli/provider-cli-install-store";
import { initializePreferredTheme } from "./hooks/useTheme";
import { initializeFavicon } from "./lib/favicon-color-preference";
import { installForeignDomMutationGuard } from "./lib/foreign-dom-mutation-guard";
import { installAppQueryClientBrowserEvents } from "./lib/query-client";
import { appQueryClient } from "./lib/app-query-client";
import { applyAppFrameGeometry, getBbDesktopInfo } from "./lib/bb-desktop";
import { applyCachedAppThemeCss } from "./lib/themes";
import { installStaleChunkRecovery } from "./lib/stale-chunk-recovery";
import { moveStylesheetPropertiesToRegistry } from "./lib/stylesheet-property-registry";
import "./app.css";

installStaleChunkRecovery();
installForeignDomMutationGuard();

Error.stackTraceLimit = 50;

installAppQueryClientBrowserEvents(appQueryClient);
registerProviderCliInstallQueryClient(appQueryClient);

initializePreferredTheme();
applyCachedAppThemeCss();
initializeFavicon();
applyAppFrameGeometry(document.documentElement, getBbDesktopInfo());
if (typeof CSS.registerProperty === "function") {
  moveStylesheetPropertiesToRegistry(document.styleSheets, CSS);
}

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
    <AppErrorBoundary>
      <QueryClientProvider client={appQueryClient}>
        <BrowserRouter>
          <App />
          <AppToaster />
          <ApplicationUrlDialog />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
