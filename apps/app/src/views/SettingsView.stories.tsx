import { useState, type ReactNode } from "react";
import {
  defaultAppTheme,
  defaultExperiments,
  type AppTheme,
  type Experiments,
} from "@bb/domain";
import type {
  ProviderUsage,
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { UsageLimitsSettingsSectionContent } from "@/components/settings/UsageLimitsSettingsSection";
import { PageShell } from "@/components/ui/page-shell";
import type { ThemePreference } from "@/hooks/useTheme";
import {
  ExperimentsSettingsSection,
  GeneralSettingsSection,
  LocalOpenTargetSettingsSection,
  type LocalOpenTargetSettingsSectionProps,
} from "./SettingsView";

export default {
  title: "settings/Settings Page",
};

type StoredTargetId = LocalOpenTargetSettingsSectionProps["directoryTargetId"];

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
} = {
  codex: {
    status: "ok",
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
};

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
  const [directoryTargetId, setDirectoryTargetId] =
    useState<StoredTargetId>("finder");
  const [fileTargetId, setFileTargetId] =
    useState<StoredTargetId>("default-app");
  const [experiments, setExperiments] = useState<Experiments>({
    ...defaultExperiments,
    popoutChat: true,
  });

  return {
    appearance,
    directoryTargetId,
    experiments,
    fileTargetId,
    navigateToThreadAfterCreate,
    openLinksInAppBrowser,
    rewriteLocalhostLinks,
    richTextEditing,
    setAppearance,
    setDirectoryTargetId,
    setExperiments,
    setFileTargetId,
    setNavigateToThreadAfterCreate,
    setOpenLinksInAppBrowser,
    setRewriteLocalhostLinks,
    setRichTextEditing,
    setThemePreference,
    themePreference,
  };
}

function GeneralSettingsStory({
  desktopBrowserAvailable = false,
}: {
  desktopBrowserAvailable?: boolean;
}) {
  const state = useSettingsStoryState();

  return (
    <GeneralSettingsSection
      appearance={state.appearance}
      appearanceDisabled={false}
      customThemes={["Monochrome Lab", "Low Contrast"]}
      desktopBrowserAvailable={desktopBrowserAvailable}
      faviconColor={state.appearance.faviconColor}
      navigateToThreadAfterCreate={state.navigateToThreadAfterCreate}
      onAppearanceThemeChange={(themeId) =>
        state.setAppearance((current) => ({ ...current, themeId }))
      }
      onCreatePalette={() => undefined}
      onFaviconColorChange={(faviconColor) =>
        state.setAppearance((current) => ({ ...current, faviconColor }))
      }
      onNavigateToThreadAfterCreateChange={
        state.setNavigateToThreadAfterCreate
      }
      onOpenLinksInAppBrowserChange={state.setOpenLinksInAppBrowser}
      onRewriteLocalhostLinksChange={state.setRewriteLocalhostLinks}
      onRichTextEditingChange={state.setRichTextEditing}
      onThemePreferenceChange={state.setThemePreference}
      openLinksInAppBrowser={state.openLinksInAppBrowser}
      rewriteLocalhostLinks={state.rewriteLocalhostLinks}
      richTextEditing={state.richTextEditing}
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
      directoryTargetId={state.directoryTargetId}
      fileTargetId={state.fileTargetId}
      hasDaemon={true}
      onDirectoryTargetChange={handleDirectoryTargetChange}
      onFileTargetChange={handleFileTargetChange}
      targets={connectedTargets}
    />
  );
}

function ExperimentsStory({
  desktopShellAvailable = true,
}: {
  desktopShellAvailable?: boolean;
}) {
  const state = useSettingsStoryState();

  return (
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={
        state.experiments.claudeCodeMockCliTraffic
      }
      desktopShellAvailable={desktopShellAvailable}
      disabled={false}
      onClaudeCodeMockCliTrafficEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          claudeCodeMockCliTraffic: enabled,
        }))
      }
      onPopoutChatEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          popoutChat: enabled,
        }))
      }
      onPopoutChatHotkeyChange={(popoutChatHotkey) =>
        state.setExperiments((current) => ({
          ...current,
          popoutChatHotkey,
        }))
      }
      onMultiMachineEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          multiMachine: enabled,
        }))
      }
      onPluginsEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          plugins: enabled,
        }))
      }
      onUiForkingEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          uiForking: enabled,
        }))
      }
      multiMachineEnabled={state.experiments.multiMachine}
      pluginsEnabled={state.experiments.plugins}
      popoutChatEnabled={state.experiments.popoutChat}
      popoutChatHotkey={state.experiments.popoutChatHotkey}
      uiForkingEnabled={state.experiments.uiForking}
    />
  );
}

function UsageLimitsStory() {
  const [isFetching, setIsFetching] = useState(false);

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
      <UsageLimitsStory />
      <FilePreferencesStory />
      <ExperimentsStory />
    </SettingsStoryFrame>
  );
}

export function General() {
  return (
    <SettingsStoryFrame>
      <GeneralSettingsStory desktopBrowserAvailable />
    </SettingsStoryFrame>
  );
}

export function UsageAndFiles() {
  return (
    <SettingsStoryFrame>
      <UsageLimitsStory />
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
