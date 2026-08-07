import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppToaster } from "./components/AppToaster";
import { registerProviderCliInstallQueryClient } from "./components/provider-cli/provider-cli-install-store";
import { initializePreferredTheme } from "./hooks/useTheme";
import { initializeFavicon } from "./lib/favicon-color-preference";
import { initializeFontPreferences } from "./lib/font-preference";
import {
  createAppQueryClient,
  installAppQueryClientBrowserEvents,
} from "./lib/query-client";
import { takeOverPanelResizeCursor } from "./lib/resizeCursor";
import { applyCachedAppThemeCss } from "./lib/themes";
import "./app.css";

const queryClient = createAppQueryClient();
installAppQueryClientBrowserEvents(queryClient);
// The provider CLI install store outlives every component, so it takes the
// client here rather than reading it from context when an install finishes.
registerProviderCliInstallQueryClient(queryClient);

initializePreferredTheme();
initializeFontPreferences();
// Apply the palette cached from the last load before React renders, so a
// non-default theme doesn't flash the default. useAppTheme reconciles it with
// the server's authoritative appearance once /system/config loads.
applyCachedAppThemeCss();
initializeFavicon();
takeOverPanelResizeCursor();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <AppToaster position="bottom-right" />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
