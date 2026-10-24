import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import type { ProviderCliInstallAction } from "@bb/host-daemon-contract";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
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
import {
  CHANGELOG_ENTRIES,
  changelogEntriesQueryOptions,
  type ChangelogEntry,
} from "@/components/settings/changelog-preview";
import {
  systemAppUpdateQueryKey,
  systemVersionQueryKey,
} from "@/hooks/queries/query-keys";
import { SettingsStoryChrome } from "../../../.ladle/story-settings-chrome";
import { AppLayoutSidebar } from "@/components/layout/AppLayoutSidebar";
import { sdk } from "@/lib/sdk";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { dismissedReleaseVersionAtom } from "./release-widget-preferences";

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
          <AppLayoutSidebar
            routeSidebar={null}
            isSettingsActive={false}
            isResizing={false}
            onResizeMouseDown={() => {}}
            settingsRoutePath="/settings/machines"
            backToAppRoutePath={null}
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

const RELEASE_WIDGET_APP_UPDATE: SystemAppUpdateStatus = {
  activity: { phase: "idle" },
  available: {
    channel: "latest",
    commit: null,
    commitCount: null,
    subjects: [],
    version: "0.46.0",
  },
  blocked: null,
  current: { commit: null, version: "0.45.0" },
  lastResult: null,
  runningThreadCount: 0,
  support: { kind: "supported", mode: "npm" },
};

const RELEASE_WIDGET_SYSTEM_VERSION = {
  currentVersion: "0.45.0",
  latestVersion: "0.46.0",
  currentCommit: null,
  installKind: "npm",
  source: "npm",
  updateAvailable: true,
  isDevelopment: false,
  upgradeCommand: "npx bb-app@latest",
} satisfies SystemVersionResponse;

const RELEASE_WIDGET_ENTRIES_WITHOUT_IMAGES: ChangelogEntry[] =
  CHANGELOG_ENTRIES.map((entry) => ({
    ...entry,
    sections: entry.sections.map((section) => ({
      ...section,
      blocks: section.blocks.filter(
        (block) => block.kind !== "paragraph" || !block.text.startsWith("!["),
      ),
    })),
  }));

const releaseWidgetStorySdk: Pick<
  typeof sdk.system,
  "appUpdate" | "experimental_recordTelemetryEvent" | "version"
> = {
  appUpdate: async () => RELEASE_WIDGET_APP_UPDATE,
  experimental_recordTelemetryEvent: async (event) => {
    console.info("Telemetry event", event);
    return { ok: true };
  },
  version: async () => RELEASE_WIDGET_SYSTEM_VERSION,
};

function SeedReleaseWidgetQueries({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [originalSdk] = useState(() => {
    const original = {
      appUpdate: sdk.system.appUpdate,
      experimental_recordTelemetryEvent:
        sdk.system.experimental_recordTelemetryEvent,
      version: sdk.system.version,
    };
    Object.assign(sdk.system, releaseWidgetStorySdk);
    queryClient.setQueryData(
      systemVersionQueryKey(),
      RELEASE_WIDGET_SYSTEM_VERSION,
    );
    queryClient.setQueryData(
      systemAppUpdateQueryKey(),
      RELEASE_WIDGET_APP_UPDATE,
    );
    queryClient.setQueryData(
      changelogEntriesQueryOptions().queryKey,
      CHANGELOG_ENTRIES,
    );
    return original;
  });
  useEffect(
    () => () => {
      if (
        originalSdk.appUpdate !== releaseWidgetStorySdk.appUpdate &&
        originalSdk.version !== releaseWidgetStorySdk.version
      ) {
        Object.assign(sdk.system, originalSdk);
      }
    },
    [originalSdk],
  );
  return children;
}

function ReleaseImageControls() {
  const queryClient = useQueryClient();
  const setDismissedVersion = useSetAtom(dismissedReleaseVersionAtom);
  const [withImage, setWithImage] = useState(true);
  const choose = (next: boolean) => {
    setWithImage(next);
    queryClient.setQueryData(
      changelogEntriesQueryOptions().queryKey,
      next ? CHANGELOG_ENTRIES : RELEASE_WIDGET_ENTRIES_WITHOUT_IMAGES,
    );
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={withImage ? "default" : "outline"}
        onClick={() => choose(true)}
      >
        Release image
      </Button>
      <Button
        variant={withImage ? "outline" : "default"}
        onClick={() => choose(false)}
      >
        No image
      </Button>
      <Button variant="ghost" onClick={() => setDismissedVersion(null)}>
        Show the widget again
      </Button>
    </div>
  );
}

export function ReleaseWidget() {
  return (
    <SettingsStoryFixtures>
      <SeedReleaseWidgetQueries>
        <SidebarProvider className="h-screen bg-background">
          <AppLayoutSidebar
            routeSidebar={null}
            isSettingsActive={false}
            isResizing={false}
            onResizeMouseDown={() => {}}
            settingsRoutePath="/settings/updates"
            backToAppRoutePath={null}
          />
          <SidebarInset>
            <main className="space-y-6 p-6">
              <SidebarTrigger />
              <h1 className="text-lg font-semibold">Release widget</h1>
              <p className="max-w-lg text-sm text-muted-foreground">
                bb 0.46.0 is available, so the footer shows the release widget
                above the bb update chip, led by the release's image. Choose No
                image to see the bb logo fallback. Read the release notes opens
                getbb.app/changelog in the browser and dismisses the widget, as
                ✕ does; the chip stays as the way to update.
              </p>
              <ReleaseImageControls />
            </main>
          </SidebarInset>
        </SidebarProvider>
      </SeedReleaseWidgetQueries>
    </SettingsStoryFixtures>
  );
}
