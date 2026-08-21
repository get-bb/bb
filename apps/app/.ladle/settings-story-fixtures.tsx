import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  PERSONAL_PROJECT_ID,
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import type {
  SidebarBootstrapResponse,
  SystemConfigResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import {
  hostProviderCliStatusQueryKey,
  hostsQueryKey,
  pluginListQueryKey,
  pluginMarketplacesQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  systemVersionQueryKey,
} from "../src/hooks/queries/query-keys";
import {
  buildUpdateInventoryProviderIssues,
  type UpdateInventoryMachine,
} from "../src/hooks/useUpdateInventory";
import { createAppQueryClient } from "../src/lib/query-client";
import { getSettingsRoutePath } from "../src/lib/route-paths";
import {
  BbAppUpdateRows,
  MachineUpdatesRows,
  MachineUpdatesSection,
  UpdateActionButton,
} from "../src/components/settings/UpdatesSettingsSection";
import {
  HOST_IDS,
  HOST_NAMES,
  PROJECT_IDS,
  STORY_PROJECT_SOURCES,
  makeHost,
  makeProject,
  makeProviderCliStatus,
} from "./story-fixtures";

const SETTINGS_STORY_NOW = Date.parse("2026-08-19T08:00:00.000Z");

const SETTINGS_STORY_PRIMARY_HOST = makeHost({
  createdAt: SETTINGS_STORY_NOW - 45 * 24 * 60 * 60_000,
  lastSeenAt: SETTINGS_STORY_NOW,
});

const SETTINGS_STORY_HOSTS = [
  SETTINGS_STORY_PRIMARY_HOST,
  makeHost({
    id: HOST_IDS.remote,
    name: HOST_NAMES.remote,
    maxPermissionMode: "auto",
    createdAt: SETTINGS_STORY_NOW - 18 * 24 * 60 * 60_000,
    lastSeenAt: SETTINGS_STORY_NOW - 3 * 60_000,
  }),
];

const localProviderStatus = {
  codex: makeProviderCliStatus("codex", {
    currentVersion: "0.145.0",
    latestVersion: "0.146.0",
    needsUpdate: true,
    installAction: {
      kind: "update",
      label: "Update",
      command: "codex update",
    },
  }),
  "claude-code": makeProviderCliStatus("claude-code", {
    currentVersion: "2.1.0",
    latestVersion: "2.1.0",
  }),
  "acp-cursor": makeProviderCliStatus("acp-cursor", {
    currentVersion: "0.49.0",
    latestVersion: "0.49.0",
  }),
} satisfies ProviderCliStatusResponse;

const remoteProviderStatus = {
  codex: makeProviderCliStatus("codex", {
    currentVersion: "0.145.0",
    latestVersion: "0.146.0",
    needsUpdate: true,
    installAction: {
      kind: "update",
      label: "Update",
      command: "codex update",
    },
  }),
  "claude-code": makeProviderCliStatus("claude-code", {
    currentVersion: "2.1.0",
    latestVersion: "2.1.0",
  }),
  "acp-cursor": makeProviderCliStatus("acp-cursor", {
    installed: false,
    executablePath: null,
    currentVersion: null,
    latestVersion: "0.49.0",
    installSource: undefined,
  }),
} satisfies ProviderCliStatusResponse;

const project = makeProject({
  id: PROJECT_IDS.bb,
  sources: [...STORY_PROJECT_SOURCES],
});
const personalProject = makeProject({
  id: PERSONAL_PROJECT_ID,
  kind: "personal",
  name: "Personal",
  sources: [],
});

const sidebarNavigation = {
  sections: [],
  projects: [{ ...project, defaultExecutionOptions: null, threads: [] }],
  personalProject: {
    ...personalProject,
    defaultExecutionOptions: null,
    threads: [],
  },
} satisfies SidebarBootstrapResponse;

const systemConfig = {
  generalSettings: defaultAppSettings,
  keybindings: [],
  defaultKeybindings: [],
  keybindingOverrides: [],
  experiments: defaultExperiments,
  appearance: defaultAppTheme,
  customThemes: [],
  pluginThemes: [],
  featureFlags: { placeholder: false, timelineWindowEventBudget: 1_500 },
  hostDaemonPort: null,
  localHelperPorts: [],
  serverUrl: "http://localhost:38886",
  primaryHostId: HOST_IDS.local,
  primaryHostPlatform: "darwin",
  voiceTranscriptionEnabled: true,
  dataDir: "/Users/michael/.bb",
} satisfies SystemConfigResponse;

const systemVersion = {
  currentVersion: "0.39.0",
  latestVersion: "0.39.0",
  source: "npm",
  updateAvailable: false,
  isDevelopment: false,
  upgradeCommand: "npx bb-app@latest",
} satisfies SystemVersionResponse;

const settingsUpdateMachine = {
  host: SETTINGS_STORY_PRIMARY_HOST,
  isPrimary: true,
  providerStatus: localProviderStatus,
  statusPending: false,
  statusError: false,
  statusFetching: false,
  issues: buildUpdateInventoryProviderIssues(localProviderStatus),
  canRetryDaemonUpdate: false,
} satisfies UpdateInventoryMachine;

const noJobs: ReadonlySet<string> = new Set();
const noop = () => {};

/** The representative, side-effect-free Updates route inside the Settings story. */
export function SettingsUpdatesStory() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <MachineUpdatesSection
        machine={settingsUpdateMachine}
        isThisMachine={false}
        action={
          <div role="toolbar" aria-label="Bulk update actions">
            <UpdateActionButton
              label="Update all 1 CLI tool"
              tooltipLabel="Update all"
              icon={UPDATE_ACTION_ICON}
              iconPosition="end"
              visibleLabel="Update all"
              variant="default"
              onClick={noop}
            />
          </div>
        }
      >
        <BbAppUpdateRows
          systemVersion={systemVersion}
          desktopInfo={null}
          isDesktop={false}
          onRelaunchDesktop={null}
          onRetryDesktop={null}
        />
        <MachineUpdatesRows
          machine={settingsUpdateMachine}
          runningJobKey={null}
          queuedJobKeys={noJobs}
          onStartInstall={noop}
          onOpenProvider={() => navigate(getSettingsRoutePath("providers"))}
        />
      </MachineUpdatesSection>
    </div>
  );
}

function createSettingsStoryQueryClient() {
  const queryClient = createAppQueryClient({
    showMutationErrorToasts: false,
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        gcTime: Infinity,
        retry: false,
        staleTime: Infinity,
      },
    },
  });
  queryClient.setQueryData(hostsQueryKey(), SETTINGS_STORY_HOSTS);
  queryClient.setQueryData(systemConfigQueryKey(), systemConfig);
  queryClient.setQueryData(systemVersionQueryKey(), systemVersion);
  queryClient.setQueryData(sidebarNavigationQueryKey(), sidebarNavigation);
  queryClient.setQueryData(pluginMarketplacesQueryKey(), []);
  queryClient.setQueryData(
    hostProviderCliStatusQueryKey(HOST_IDS.local),
    localProviderStatus,
  );
  queryClient.setQueryData(
    hostProviderCliStatusQueryKey(HOST_IDS.remote),
    remoteProviderStatus,
  );
  queryClient.setQueryData(pluginListQueryKey(true), { plugins: [] });
  return queryClient;
}

/** Deterministic production-query fixtures shared by every Settings route. */
export function SettingsStoryFixtures({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createSettingsStoryQueryClient);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
