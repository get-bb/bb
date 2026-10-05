import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProviderCliInstallAction } from "@bb/host-daemon-contract";
import { SettingsStoryFixtures } from "../../../.ladle/settings-story-fixtures";
import {
  HOST_IDS,
  makeHost,
  makeProviderCliStatus,
} from "../../../.ladle/story-fixtures";
import type { ProviderCliActionableIssue } from "@/components/provider-cli/provider-cli-install";
import { startProviderCliInstall } from "@/components/provider-cli/provider-cli-install-store";
import {
  SidebarInset,
  SidebarMenu,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useLocation } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { MachinesSettingsSection } from "@/components/settings/MachinesSettingsSection";
import { SettingsStoryChrome } from "../../../.ladle/story-settings-chrome";
import { AppSidebar } from "./AppSidebar";
import { sdk } from "@/lib/sdk";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";

export default { title: "sidebar/Updates badge" };

const action: ProviderCliInstallAction = {
  kind: "update",
  label: "Update",
  command: "codex update",
};
const status = makeProviderCliStatus("codex", {
  currentVersion: "0.150.0",
  latestVersion: "0.151.0",
  needsUpdate: true,
  installAction: action,
});
const issue: ProviderCliActionableIssue = {
  provider: "codex",
  status,
  action,
  title: "Codex update available",
  description: "0.150.0 -> 0.151.0",
  fingerprint: "codex:story",
};

function BadgeStage({ children }: { children?: ReactNode }) {
  return (
    <SettingsStoryFixtures>
      <div className="flex min-h-32 w-80 flex-col rounded-md border border-sidebar-border bg-sidebar p-4 text-sidebar-foreground">
        {children}
        <SidebarMenu className="mt-auto">
          <SidebarUpdatesBadge />
        </SidebarMenu>
      </div>
    </SettingsStoryFixtures>
  );
}

function ActiveProviderUpdate() {
  useEffect(() => {
    const originalInstallProviderCli = sdk.hosts.installProviderCli;
    let finishInstall: (() => void) | null = null;
    const startTimer = window.setTimeout(() => {
      sdk.hosts.installProviderCli = () =>
        new Promise((resolve) => {
          finishInstall = () => {
            resolve([
              {
                type: "completed",
                provider: "codex",
                exitCode: 0,
                signal: null,
                success: true,
              },
            ]);
          };
        });
      startProviderCliInstall({ hostId: HOST_IDS.local, issue });
    }, 0);

    return () => {
      window.clearTimeout(startTimer);
      sdk.hosts.installProviderCli = originalInstallProviderCli;
      finishInstall?.();
    };
  }, []);

  return <BadgeStage />;
}

export function ProviderUpdateAvailable() {
  return <BadgeStage />;
}

export function ProviderUpdateDownloading() {
  return <ActiveProviderUpdate />;
}

export function MachineNotices() {
  const [offlineCount, setOfflineCount] = useState(2);
  const [lastSeenAt, setLastSeenAt] = useState(Date.now);
  const { pathname } = useLocation();
  const hosts = useMemo(
    () =>
      ["Work laptop", "Studio desktop"].map((name, index) =>
        makeHost({
          id: index === 0 ? HOST_IDS.local : HOST_IDS.remote,
          name,
          status: offlineCount > index ? "disconnected" : "connected",
          lastSeenAt,
          lastRejectedProtocolVersion:
            index === 0 && offlineCount > 0 ? 1 : null,
        }),
      ),
    [offlineCount, lastSeenAt],
  );

  return (
    <SettingsStoryFixtures hosts={hosts}>
      {pathname === "/settings/machines" ? (
        <SettingsStoryChrome activeSection="machines">
          <MachinesSettingsSection />
        </SettingsStoryChrome>
      ) : (
        <SidebarProvider className="h-screen bg-background">
          <AppSidebar
            isResizing={false}
            onResizeMouseDown={() => {}}
            settingsRoutePath="/settings/machines"
          />
          <SidebarInset>
            <main className="space-y-6 p-6">
              <SidebarTrigger />
              <h1 className="text-lg font-semibold">Machine notices</h1>
              <p className="max-w-lg text-sm text-muted-foreground">
                Hover the footer warning, then open it to see the machines.
                Return to the app: the same outage stays acknowledged.
              </p>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2].map((count) => (
                  <Button
                    key={count}
                    variant={offlineCount === count ? "default" : "outline"}
                    onClick={() => setOfflineCount(count)}
                  >
                    {count === 0
                      ? "All online"
                      : count === 1
                        ? "One offline"
                        : "Two offline"}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  onClick={() => setLastSeenAt(Date.now())}
                >
                  New outage
                </Button>
              </div>
            </main>
          </SidebarInset>
        </SidebarProvider>
      )}
    </SettingsStoryFixtures>
  );
}
