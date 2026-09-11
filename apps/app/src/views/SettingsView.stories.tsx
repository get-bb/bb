import { useEffect, useRef, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import {
  defaultAppTheme,
  defaultExperiments,
  type AppTheme,
  type Experiments,
  defaultAppSettings,
  type AppSettings,
} from "@bb/domain";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { VoiceInputSettingsSectionContent } from "@/components/settings/VoiceInputSettingsSection";
import { ArchivedThreadsSettingsSection } from "@/components/settings/ArchivedThreadsSettingsSection";
import { CommunitySettingsSection } from "@/components/settings/CommunitySettingsSection";
import { KeyboardSettingsSection } from "@/components/settings/KeyboardSettingsSection";
import { MarketplacesSettingsSection } from "@/components/settings/MarketplacesSettingsSection";
import { MachinesSettingsSection } from "@/components/settings/MachinesSettingsSection";
import { ProjectsSettingsSection } from "@/components/settings/ProjectsSettingsSection";
import {
  SettingsStoryChrome,
  type SettingsStoryRoute,
  useSettingsStoryRoute,
} from "../../.ladle/story-settings-chrome";
import {
  SettingsStoryFixtures,
  SettingsUpdatesStory,
} from "../../.ladle/settings-story-fixtures";
import type { ThemePreference } from "@/hooks/useTheme";
import type { AudioInputDeviceOption } from "@/hooks/useAudioInputDevices";
import type { PreferredAudioInputDeviceId } from "@/lib/audio-input-device-preference";
import {
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PROJECT_ROUTE_PATH,
} from "@/lib/route-paths";
import {
  AppearanceSettingsSection,
  DebugSettingsSection,
  ExperimentsSettingsSection,
  GeneralSettingsSection,
  LocalOpenTargetSettingsSection,
  type LocalOpenTargetSettingsSectionProps,
} from "./SettingsView";
import { MachineSettingsView } from "./MachineSettingsView";
import { ProjectDetailSettingsView } from "./ProjectDetailSettingsView";
import { ProvidersSettingsSection } from "@/components/settings/ProvidersSettingsSection";

export default {
  title: "settings/Settings",
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
  const [streamerMode, setStreamerMode] = useState(false);
  const [managedBranchPrefix, setManagedBranchPrefix] = useState(
    defaultAppSettings.managedBranchPrefix,
  );
  const [showDiagnosticEvents, setShowDiagnosticEvents] = useState(false);
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
    managedBranchPrefix,
    navigateToThreadAfterCreate,
    openLinksInAppBrowser,
    preferredAudioInputDeviceId,
    rewriteLocalhostLinks,
    richTextEditing,
    steerActiveThreadOnEnter,
    streamerMode,
    showDiagnosticEvents,
    setAppearance,
    setDirectoryTargetId,
    setExperiments,
    setFileTargetId,
    setManagedBranchPrefix,
    setNavigateToThreadAfterCreate,
    setOpenLinksInAppBrowser,
    setPreferredAudioInputDeviceId,
    setRewriteLocalhostLinks,
    setRichTextEditing,
    setSteerActiveThreadOnEnter,
    setStreamerMode,
    setShowDiagnosticEvents,
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
        managedBranchPrefix={state.managedBranchPrefix}
        managedBranchPrefixDisabled={false}
        onManagedBranchPrefixChange={state.setManagedBranchPrefix}
        navigateToThreadAfterCreate={state.navigateToThreadAfterCreate}
        onNavigateToThreadAfterCreateChange={
          state.setNavigateToThreadAfterCreate
        }
        onOpenLinksInAppBrowserChange={state.setOpenLinksInAppBrowser}
        onRewriteLocalhostLinksChange={state.setRewriteLocalhostLinks}
        onRichTextEditingChange={state.setRichTextEditing}
        onSteerActiveThreadOnEnterChange={state.setSteerActiveThreadOnEnter}
        onStreamerModeChange={state.setStreamerMode}
        openLinksInAppBrowser={state.openLinksInAppBrowser}
        rewriteLocalhostLinks={state.rewriteLocalhostLinks}
        richTextEditing={state.richTextEditing}
        steerActiveThreadOnEnter={state.steerActiveThreadOnEnter}
        steerActiveThreadOnEnterDisabled={false}
        streamerMode={state.streamerMode}
        streamerModeDisabled={false}
      />
      <DebugSettingsSection
        disabled={false}
        enabled={state.showDiagnosticEvents}
        onEnabledChange={state.setShowDiagnosticEvents}
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
      onAppearanceThemePrefetch={() => undefined}
      onAppearanceThemePreview={() => undefined}
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
      changelogPreviewEnabled={state.experiments.changelogPreview}
      disabled={false}
      mobileAppEnabled={state.experiments.mobileApp}
      sidebarProgressiveDisclosureEnabled={
        state.experiments.sidebarProgressiveDisclosure
      }
      timelineWindowingEnabled={state.experiments.timelineWindowing}
      onChangelogPreviewEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          changelogPreview: enabled,
        }))
      }
      onMobileAppEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          mobileApp: enabled,
        }))
      }
      onSidebarProgressiveDisclosureEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          sidebarProgressiveDisclosure: enabled,
        }))
      }
      onTimelineWindowingEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          timelineWindowing: enabled,
        }))
      }
    />
  );
}

function ProvidersSettingsStory() {
  const [generalSettings, setGeneralSettings] =
    useState<AppSettings>(defaultAppSettings);
  return (
    <ProvidersSettingsSection
      disabled={false}
      generalSettings={generalSettings}
      onGeneralSettingsChange={setGeneralSettings}
    />
  );
}

function SettingsStoryContent({ route }: { route: SettingsStoryRoute }) {
  if (route.kind === "machine") {
    return (
      <Routes>
        <Route
          path={SETTINGS_MACHINE_ROUTE_PATH}
          element={<MachineSettingsView />}
        />
      </Routes>
    );
  }
  if (route.kind === "project") {
    return (
      <Routes>
        <Route
          path={SETTINGS_PROJECT_ROUTE_PATH}
          element={<ProjectDetailSettingsView />}
        />
      </Routes>
    );
  }

  switch (route.id) {
    case "providers":
      return <ProvidersSettingsStory />;
    case "appearance":
      return <AppearanceSettingsStory />;
    case "keyboard":
      return <KeyboardSettingsSection />;
    case "files":
      return <FilePreferencesStory />;
    case "projects":
      return <ProjectsSettingsSection />;
    case "machines":
      return <MachinesSettingsSection />;
    case "updates":
      return <SettingsUpdatesStory />;
    case "experiments":
      return <ExperimentsStory />;
    case "marketplaces":
      return <MarketplacesSettingsSection />;
    case "community":
      return <CommunitySettingsSection />;
    case "archived":
      return <ArchivedThreadsSettingsSection />;
    case "general":
      return (
        <>
          <GeneralSettingsStory desktopBrowserAvailable />
          <VoiceInputStory />
        </>
      );
  }
}

export function FullPage() {
  const navigate = useNavigate();
  const route = useSettingsStoryRoute();
  const initializedFromStoryPath = useRef(false);
  useEffect(() => {
    if (initializedFromStoryPath.current) return;
    initializedFromStoryPath.current = true;
    const storyPath =
      new URLSearchParams(window.location.hash.slice(1)).get("settingsPath") ??
      new URLSearchParams(window.location.search).get("settingsPath");
    if (storyPath?.startsWith("/settings") === true) {
      navigate(storyPath, { replace: true });
    }
  }, [navigate]);

  return (
    <SettingsStoryFixtures>
      <SettingsStoryChrome contentOwnsPageShell={route.kind !== "section"}>
        <SettingsStoryContent route={route} />
      </SettingsStoryChrome>
    </SettingsStoryFixtures>
  );
}
