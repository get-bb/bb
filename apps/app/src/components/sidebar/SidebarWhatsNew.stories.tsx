import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsStoryFixtures,
  SettingsUpdatesStory,
} from "../../../.ladle/settings-story-fixtures";
import { SettingsStoryChrome } from "../../../.ladle/story-settings-chrome";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { notifyWhatsNewSeenVersionChanged } from "@/components/settings/whats-new-seen";
import { AppSidebar } from "./AppSidebar";

export default { title: "sidebar/What's new" };

const SEEN_KEY = "bb.settings.updates.whats-new-seen-version";

function resetSeenVersion() {
  window.localStorage.removeItem(SEEN_KEY);
  notifyWhatsNewSeenVersionChanged();
}

export function AboveTheFooter() {
  useState(resetSeenVersion);
  const { pathname } = useLocation();
  return (
    <SettingsStoryFixtures>
      {pathname.startsWith("/settings") ? (
        <SettingsStoryChrome activeSection="updates">
          <SettingsUpdatesStory />
        </SettingsStoryChrome>
      ) : (
        <SidebarProvider className="h-screen bg-background">
          <AppSidebar
            isResizing={false}
            onResizeMouseDown={() => {}}
            settingsRoutePath="/settings/updates"
          />
          <SidebarInset>
            <main className="space-y-4 p-6">
              <SidebarTrigger />
              <h1 className="text-lg font-semibold">What&rsquo;s new</h1>
              <p className="max-w-lg text-sm text-muted-foreground">
                The card sits above the sidebar footer until this client sees
                the installed release. Dismiss it or open it, then reset to show
                it again. Collapse the sidebar to hide it.
              </p>
              <Button variant="outline" onClick={resetSeenVersion}>
                Reset seen release
              </Button>
            </main>
          </SidebarInset>
        </SidebarProvider>
      )}
    </SettingsStoryFixtures>
  );
}
