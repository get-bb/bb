import { useState, type ReactNode } from "react";
import {
  defaultAppTheme,
  defaultExperiments,
  type AppTheme,
  type Experiments,
  type Host,
} from "@bb/domain";
import type {
  ProviderUsage,
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { UsageLimitsSettingsSectionContent } from "@/components/settings/UsageLimitsSettingsSection";
import { VoiceInputSettingsSectionContent } from "@/components/settings/VoiceInputSettingsSection";
import { PageShell } from "@/components/ui/page-shell";
import type { ThemePreference } from "@/hooks/useTheme";
import type { AudioInputDeviceOption } from "@/hooks/useAudioInputDevices";
import type { PreferredAudioInputDeviceId } from "@/lib/audio-input-device-preference";
import {
  AppearanceSettingsSection,
  DebugSettingsSection,
  ExperimentsSettingsSection,
  GeneralSettingsSection,
  LocalOpenTargetSettingsSection,
  type LocalOpenTargetSettingsSectionProps,
} from "./SettingsView";

export default {
  title: "settings/Settings Page",
};

type StoredTargetId = LocalOpenTargetSettingsSectionProps["directoryTargetId"];

const audioInputDevices: AudioInputDeviceOption[] = [
  { deviceId: "macbook-mic", label: "MacBook Pro Microphone" },
  { deviceId: "studio-mic", label: "Studio Display Microphone" },
];

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  label: "VS Code",
};

const finderTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "finder",
  label: "Finder",
};

const terminalTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "terminal",
  label: "Terminal",
};

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: false,
  },
  id: "default-app",
  label: "Default App",
};

const connectedTargets: WorkspaceOpenTarget[] = [
  vscodeTarget,
  finderTarget,
  terminalTarget,
  defaultAppTarget,
];

function futureIso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

const usageFixture: {
  codex: ProviderUsage;
  claudeCode: ProviderUsage;
  cursor: ProviderUsage;
} = {
  codex: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Pro",
    windows: [
      {
        label: "Current session",
        resetsAt: futureIso(136),
        usedPercent: 35,
      },
      {
        label: "Weekly limit",
        resetsAt: futureIso(48),
        usedPercent: 74,
      },
    ],
  },
  claudeCode: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Max (20x)",
    windows: [
      {
        label: "Current session",
        resetsAt: futureIso(179),
        usedPercent: 3,
      },
      {
        label: "Weekly limit",
        resetsAt: futureIso(4 * 24 * 60),
        usedPercent: 26,
      },
    ],
  },
  cursor: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Pro",
    windows: [
      {
        label: "Plan usage",
        resetsAt: futureIso(14 * 24 * 60),
        usedPercent: 72,
      },
      {
        label: "On-demand spend",
        resetsAt: futureIso(14 * 24 * 60),
        usedPercent: 25,
        cost: { usedUsdCents: 1_250, limitUsdCents: 5_000 },
      },
    ],
  },
};

const usageHosts: Host[] = [
  {
    id: "host-macbook",
    name: "MacBook Pro",
    type: "persistent",
    status: "connected",
    lastSeenAt: Date.now(),
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "host-studio",
    name: "Mac Studio",
    type: "persistent",
    status: "connected",
    lastSeenAt: Date.now(),
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  },
];

function useSettingsStoryState() {
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("system");
  const [appearance, setAppearance] = useState<AppTheme>({
    ...defaultAppTheme,
    faviconColor: "red",
  });
  const [navigateToThreadAfterCreate, setNavigateToThreadAfterCreate] =
    useState(false);
  const [openLinksInAppBrowser, setOpenLinksInAppBrowser] = useState(false);
  const [rewriteLocalhostLinks, setRewriteLocalhostLinks] = useState(true);
  const [richTextEditing, setRichTextEditing] = useState(false);
  const [steerActiveThreadOnEnter, setSteerActiveThreadOnEnter] =
    useState(false);
  const [showUnhandledProviderEvents, setShowUnhandledProviderEvents] =
    useState(false);
  const [preferredAudioInputDeviceId, setPreferredAudioInputDeviceId] =
    useState<PreferredAudioInputDeviceId>("studio-mic");
  const [directoryTargetId, setDirectoryTargetId] =
    useState<StoredTargetId>("finder");
  const [fileTargetId, setFileTargetId] =
    useState<StoredTargetId>("default-app");
  const [experiments, setExperiments] =
    useState<Experiments>(defaultExperiments);

  return {
    appearance,
    directoryTargetId,
    experiments,
    fileTargetId,
    navigateToThreadAfterCreate,
    openLinksInAppBrowser,
    preferredAudioInputDeviceId,
    rewriteLocalhostLinks,
    richTextEditing,
    steerActiveThreadOnEnter,
    showUnhandledProviderEvents,
    setAppearance,
    setDirectoryTargetId,
    setExperiments,
    setFileTargetId,
    setNavigateToThreadAfterCreate,
    setOpenLinksInAppBrowser,
    setPreferredAudioInputDeviceId,
    setRewriteLocalhostLinks,
    setRichTextEditing,
    setSteerActiveThreadOnEnter,
    setShowUnhandledProviderEvents,
    setThemePreference,
    themePreference,
  };
}

function VoiceInputStory() {
  const state = useSettingsStoryState();

  return (
    <VoiceInputSettingsSectionContent
      devices={audioInputDevices}
      errorMessage={null}
      isLoading={false}
      isSupported={true}
      onDeviceChange={state.setPreferredAudioInputDeviceId}
      onRefresh={() => undefined}
      preferredDeviceId={state.preferredAudioInputDeviceId}
    />
  );
}

function GeneralSettingsStory({
  desktopBrowserAvailable = false,
}: {
  desktopBrowserAvailable?: boolean;
}) {
  const state = useSettingsStoryState();

  return (
    <>
      <GeneralSettingsSection
        desktopBrowserAvailable={desktopBrowserAvailable}
        navigateToThreadAfterCreate={state.navigateToThreadAfterCreate}
        onNavigateToThreadAfterCreateChange={
          state.setNavigateToThreadAfterCreate
        }
        onOpenLinksInAppBrowserChange={state.setOpenLinksInAppBrowser}
        onReplayOnboarding={() => {}}
        onRewriteLocalhostLinksChange={state.setRewriteLocalhostLinks}
        onRichTextEditingChange={state.setRichTextEditing}
        onSteerActiveThreadOnEnterChange={state.setSteerActiveThreadOnEnter}
        openLinksInAppBrowser={state.openLinksInAppBrowser}
        rewriteLocalhostLinks={state.rewriteLocalhostLinks}
        richTextEditing={state.richTextEditing}
        replayOnboardingAvailable={state.experiments.newOnboarding}
        steerActiveThreadOnEnter={state.steerActiveThreadOnEnter}
        steerActiveThreadOnEnterDisabled={false}
      />
      <DebugSettingsSection
        disabled={false}
        enabled={state.showUnhandledProviderEvents}
        onEnabledChange={state.setShowUnhandledProviderEvents}
      />
    </>
  );
}

function AppearanceSettingsStory() {
  const state = useSettingsStoryState();

  return (
    <AppearanceSettingsSection
      appearance={state.appearance}
      appearanceDisabled={false}
      customThemes={["Monochrome Lab", "Low Contrast"]}
      pluginThemes={[]}
      faviconColor={state.appearance.faviconColor}
      onAppearanceThemeChange={(themeId) =>
        state.setAppearance((current) => ({ ...current, themeId }))
      }
      onCreatePalette={() => undefined}
      onFaviconColorChange={(faviconColor) =>
        state.setAppearance((current) => ({ ...current, faviconColor }))
      }
      onThemePreferenceChange={state.setThemePreference}
      themePreference={state.themePreference}
    />
  );
}

function FilePreferencesStory() {
  const state = useSettingsStoryState();

  function handleDirectoryTargetChange(targetId: WorkspaceOpenTargetId): void {
    state.setDirectoryTargetId(targetId);
  }

  function handleFileTargetChange(targetId: WorkspaceOpenTargetId): void {
    state.setFileTargetId(targetId);
  }

  return (
    <LocalOpenTargetSettingsSection
      accessState="available"
      directoryTargetId={state.directoryTargetId}
      fileTargetId={state.fileTargetId}
      hasDaemon={true}
      onDirectoryTargetChange={handleDirectoryTargetChange}
      onFileTargetChange={handleFileTargetChange}
      onRequestAccess={async () => true}
      targets={connectedTargets}
    />
  );
}

function ExperimentsStory() {
  const state = useSettingsStoryState();

  return (
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={
        state.experiments.claudeCodeMockCliTraffic
      }
      disabled={false}
      editMessagesEnabled={state.experiments.editMessages}
      newOnboardingEnabled={state.experiments.newOnboarding}
      providerSessionReapingEnabled={state.experiments.providerSessionReaping}
      onClaudeCodeMockCliTrafficEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          claudeCodeMockCliTraffic: enabled,
        }))
      }
      onEditMessagesEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          editMessages: enabled,
        }))
      }
      onNewOnboardingEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          newOnboarding: enabled,
        }))
      }
      onProviderSessionReapingEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          providerSessionReaping: enabled,
        }))
      }
    />
  );
}

function UsageLimitsStory() {
  const [isFetching, setIsFetching] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState("host-macbook");

  return (
    <UsageLimitsSettingsSectionContent
      usage={usageFixture}
      isLoading={false}
      isError={false}
      isFetching={isFetching}
      onRefresh={() => {
        setIsFetching(true);
        window.setTimeout(() => setIsFetching(false), 500);
      }}
      hosts={usageHosts}
      selectedHostId={selectedHostId}
      onSelectHost={setSelectedHostId}
    />
  );
}

function SettingsStoryFrame({
  children,
  useShell = false,
}: {
  children: ReactNode;
  useShell?: boolean;
}) {
  if (useShell) {
    return (
      <div className="h-[1120px] bg-background p-4 md:p-5">
        <PageShell contentClassName="pt-4 md:pt-5">
          <div className="mx-auto w-full max-w-3xl space-y-6">{children}</div>
        </PageShell>
      </div>
    );
  }

  return (
    <div className="bg-background p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">{children}</div>
    </div>
  );
}

export function Overview() {
  return (
    <SettingsStoryFrame useShell>
      <GeneralSettingsStory />
      <AppearanceSettingsStory />
      <UsageLimitsStory />
      <VoiceInputStory />
      <FilePreferencesStory />
      <ExperimentsStory />
    </SettingsStoryFrame>
  );
}

export function General() {
  return (
    <SettingsStoryFrame>
      <GeneralSettingsStory desktopBrowserAvailable />
      <VoiceInputStory />
    </SettingsStoryFrame>
  );
}

export function Appearance() {
  return (
    <SettingsStoryFrame>
      <AppearanceSettingsStory />
    </SettingsStoryFrame>
  );
}

export function Files() {
  return (
    <SettingsStoryFrame>
      <FilePreferencesStory />
    </SettingsStoryFrame>
  );
}

export function Experiments() {
  return (
    <SettingsStoryFrame>
      <ExperimentsStory />
    </SettingsStoryFrame>
  );
}
