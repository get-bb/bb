import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
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
import { takeOverPanelResizeCursor } from "./lib/resizeCursor";
import { applyCachedAppThemeCss } from "./lib/themes";
import "./app.css";

// Before anything renders: a content script that moves a React-owned node out
// from under React turns the next unmount into a blank page. See the module
// doc for why this is a wrapper rather than a fix in our own components.
installForeignDomMutationGuard();

// V8 keeps 10 frames by default, which a React commit-phase throw fills
// entirely with reconciler internals — a crash report then names no bb
// component at all. Deep enough to reach our own frames, cheap because it only
// costs anything when an Error is actually constructed.
Error.stackTraceLimit = 50;

const queryClient = createAppQueryClient();
installAppQueryClientBrowserEvents(queryClient);
// The provider CLI install store outlives every component, so it takes the
// client here rather than reading it from context when an install finishes.
registerProviderCliInstallQueryClient(queryClient);

initializePreferredTheme();
// Apply the palette cached from the last load before React renders, so a
// non-default theme doesn't flash the default. useAppTheme reconciles it with
// the server's authoritative appearance once /system/config loads.
applyCachedAppThemeCss();
initializeFavicon();
takeOverPanelResizeCursor();

createRoot(document.getElementById("root")!, {
  // An uncaught render/commit error unmounts the whole root. React's default
  // handler reports only the error, so the report never says which subtree
  // died; the component stack is the one piece that makes it actionable.
  onUncaughtError: (error, errorInfo) => {
    console.error(
      "[bb] uncaught render error — the app root was torn down",
      error,
      errorInfo.componentStack,
    );
  },
}).render(
  <StrictMode>
    {/* Outside the providers: a crash in the query client or the router has to
        land here too, or it still takes the window white. */}
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
