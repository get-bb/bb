import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  defaultExperiments,
} from "@bb/domain";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { AppSourcesSection } from "@/components/settings/AppSourcesSection";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { WorkspaceOpenTargetIcon } from "@/components/workspace-open-target/WorkspaceOpenTargetIcon";
import {
  setPreferredTheme,
  useThemePreference,
  type ThemePreference,
} from "@/hooks/useTheme";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useUpdateExperiments } from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useWorkspaceOpenTargets } from "@/hooks/useWorkspaceOpenTargets";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import {
  FAVICON_COLOR_VALUES,
  getFaviconGlyphHref,
  useFaviconColorPreference,
  type FaviconColorPreference,
} from "@/lib/favicon-color-preference";
import { useOpenLinksInAppBrowserPreference } from "@/lib/in-app-browser-link-preference";
import { useNavigateToThreadAfterCreatePreference } from "@/lib/root-compose-create-preference";
import { updateClaudeCodeMockCliTraffic } from "@/lib/api";
import { cn } from "@/lib/utils";
import { hydrateSystemConfigCache } from "@/hooks/cache-owners/system-config-cache-owner";
import {
  resolvePreferredWorkspaceOpenTarget,
  supportsWorkspaceOpenTargetCapability,
  useFileOpenTargetPreference,
  useWorkspaceOpenTargetPreference,
  type StoredWorkspaceOpenTargetPreference,
  type WorkspaceOpenTargetCapability,
} from "@/lib/workspace-open-target-preference";
import { getWorkspaceOpenTargetFallbackLabel } from "@/components/workspace-open-target/workspace-open-target-display";

interface ThemePreferenceOption {
  label: string;
  value: ThemePreference;
}

interface FaviconColorOption {
  label: string;
  value: FaviconColorPreference;
}

interface LocalOpenTargetPreferenceDefinition {
  capability: WorkspaceOpenTargetCapability;
  emptyDescription: string;
  label: string;
}

interface LocalOpenTargetPreferenceControlProps {
  definition: LocalOpenTargetPreferenceDefinition;
  hasDaemon: boolean;
  onTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  preferredTargetId: StoredWorkspaceOpenTargetPreference;
  targets: WorkspaceOpenTarget[];
}

export interface LocalOpenTargetSettingsSectionProps {
  directoryTargetId: StoredWorkspaceOpenTargetPreference;
  fileTargetId: StoredWorkspaceOpenTargetPreference;
  hasDaemon: boolean;
  onDirectoryTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  onFileTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  targets: WorkspaceOpenTarget[];
}

export interface InAppBrowserLinkSettingsControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface RootComposeBehaviorSettingsControlProps {
  navigateToThreadAfterCreate: boolean;
  onNavigateToThreadAfterCreateChange: (enabled: boolean) => void;
}

export interface FaviconColorSettingsControlProps {
  faviconColor: FaviconColorPreference;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
}

export interface GeneralSettingsSectionProps {
  desktopBrowserAvailable: boolean;
  faviconColor: FaviconColorPreference;
  navigateToThreadAfterCreate: boolean;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
  onNavigateToThreadAfterCreateChange: (enabled: boolean) => void;
  onOpenLinksInAppBrowserChange: (enabled: boolean) => void;
  onThemePreferenceChange: (themePreference: ThemePreference) => void;
  openLinksInAppBrowser: boolean;
  themePreference: ThemePreference;
}

export interface ExperimentsSettingsSectionProps {
  /** True while the config query hasn't loaded or a toggle write is in flight. */
  disabled: boolean;
  onWorkflowsEnabledChange: (enabled: boolean) => void;
  workflowsEnabled: boolean;
}

export interface ClaudeCodeSettingsSectionProps {
  enabled: boolean;
  endpoint: string;
  isSaving: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onEndpointSave: (endpoint: string) => void;
}

const THEME_PREFERENCE_OPTIONS: ReadonlyArray<ThemePreferenceOption> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const FAVICON_COLOR_OPTIONS: ReadonlyArray<FaviconColorOption> = [
  { label: "Default", value: "default" },
  { label: "Red", value: "red" },
  { label: "Orange", value: "orange" },
  { label: "Yellow", value: "yellow" },
  { label: "Green", value: "green" },
  { label: "Teal", value: "teal" },
  { label: "Blue", value: "blue" },
  { label: "Purple", value: "purple" },
  { label: "Pink", value: "pink" },
];

const FAVICON_COLOR_LABELS: Record<FaviconColorPreference, string> = {
  blue: "Blue",
  default: "Default",
  green: "Green",
  orange: "Orange",
  pink: "Pink",
  purple: "Purple",
  red: "Red",
  teal: "Teal",
  yellow: "Yellow",
};

// Renders the favicon glyph itself in the candidate color by using the
// favicon image as a CSS mask, so the preview matches the resulting tab icon.
function FaviconColorPreview({ value }: { value: FaviconColorPreference }) {
  return (
    <span
      aria-hidden
      className={cn("size-4 shrink-0", value === "default" && "bg-foreground")}
      style={{
        mask: `url("${getFaviconGlyphHref()}") center / contain no-repeat`,
        ...(value === "default"
          ? undefined
          : { backgroundColor: FAVICON_COLOR_VALUES[value] }),
      }}
    />
  );
}

export function FaviconColorSettingsControl({
  faviconColor,
  onFaviconColorChange,
}: FaviconColorSettingsControlProps) {
  return (
    <SettingsWithControl
      label="Favicon color"
      description="Tint the browser tab icon to tell instances apart."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between border-border/60 bg-card sm:w-48"
            aria-label="Favicon color"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FaviconColorPreview value={faviconColor} />
              <span className="min-w-0 truncate">
                {FAVICON_COLOR_LABELS[faviconColor]}
              </span>
            </span>
            <Icon
              name="ChevronDown"
              className="size-3.5 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {FAVICON_COLOR_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onFaviconColorChange(option.value)}
            >
              <FaviconColorPreview value={option.value} />
              {option.label}
              <Icon
                name="Check"
                className={cn(
                  "ml-auto",
                  faviconColor !== option.value && "opacity-0",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}

const DIRECTORY_TARGET_PREFERENCE: LocalOpenTargetPreferenceDefinition = {
  capability: "openDirectory",
  emptyDescription: "No local app can open directories.",
  label: "Directory default",
};

const FILE_TARGET_PREFERENCE: LocalOpenTargetPreferenceDefinition = {
  capability: "openFile",
  emptyDescription: "No local app can open files.",
  label: "File default",
};

const LOCAL_OPEN_TARGET_DISCONNECTED_MENU_MESSAGE =
  "This default can be changed when the local host daemon is available.";

function LocalOpenTargetPreferenceControl({
  definition,
  hasDaemon,
  onTargetChange,
  preferredTargetId,
  targets,
}: LocalOpenTargetPreferenceControlProps) {
  const compatibleTargets = useMemo(
    () =>
      targets.filter((target) =>
        supportsWorkspaceOpenTargetCapability({
          capability: definition.capability,
          target,
        }),
      ),
    [definition.capability, targets],
  );
  const resolvedTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        capability: definition.capability,
        preferredTargetId,
        targets,
      }),
    [definition.capability, preferredTargetId, targets],
  );
  const unavailableMessage = !hasDaemon
    ? LOCAL_OPEN_TARGET_DISCONNECTED_MENU_MESSAGE
    : compatibleTargets.length === 0
      ? definition.emptyDescription
      : null;
  const selectedTargetId = resolvedTarget?.id ?? preferredTargetId;
  const buttonLabel =
    resolvedTarget?.label ??
    (preferredTargetId
      ? getWorkspaceOpenTargetFallbackLabel(preferredTargetId)
      : "Unavailable");

  return (
    <SettingsWithControl label={definition.label}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between border-border/60 bg-card sm:w-48"
            aria-label={definition.label}
          >
            <span className="flex min-w-0 items-center gap-2">
              {selectedTargetId ? (
                <WorkspaceOpenTargetIcon
                  targetId={selectedTargetId}
                  className="size-5"
                />
              ) : null}
              <span className="min-w-0 truncate">{buttonLabel}</span>
            </span>
            <Icon
              name="ChevronDown"
              className="size-3.5 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {unavailableMessage ? (
            <div
              role="note"
              className="px-2 py-[0.3125rem] text-xs leading-snug text-foreground"
            >
              {unavailableMessage}
            </div>
          ) : (
            compatibleTargets.map((target) => (
              <DropdownMenuItem
                key={target.id}
                onSelect={() => onTargetChange(target.id)}
              >
                <WorkspaceOpenTargetIcon
                  targetId={target.id}
                  className="size-5"
                />
                <span className="min-w-0 truncate">{target.label}</span>
                <Icon
                  name="Check"
                  className={cn(
                    "ml-auto",
                    resolvedTarget?.id !== target.id && "opacity-0",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                  )}
                />
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}

export function LocalOpenTargetSettingsSection({
  directoryTargetId,
  fileTargetId,
  hasDaemon,
  onDirectoryTargetChange,
  onFileTargetChange,
  targets,
}: LocalOpenTargetSettingsSectionProps) {
  return (
    <SettingsSection title="File Preferences">
      <div className="space-y-4">
        <LocalOpenTargetPreferenceControl
          definition={DIRECTORY_TARGET_PREFERENCE}
          hasDaemon={hasDaemon}
          onTargetChange={onDirectoryTargetChange}
          preferredTargetId={directoryTargetId}
          targets={targets}
        />
        <LocalOpenTargetPreferenceControl
          definition={FILE_TARGET_PREFERENCE}
          hasDaemon={hasDaemon}
          onTargetChange={onFileTargetChange}
          preferredTargetId={fileTargetId}
          targets={targets}
        />
      </div>
    </SettingsSection>
  );
}

const IN_APP_BROWSER_LINK_SETTING_LABEL = "Open links in the in-app browser";
const NAVIGATE_TO_THREAD_AFTER_CREATE_SETTING_LABEL =
  "Navigate to threads on creation";
const CLAUDE_CODE_MOCK_CLI_TRAFFIC_SETTING_LABEL = "Mock CLI traffic";
const CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT_LABEL = "Mock endpoint";

export function RootComposeBehaviorSettingsControl({
  navigateToThreadAfterCreate,
  onNavigateToThreadAfterCreateChange,
}: RootComposeBehaviorSettingsControlProps) {
  return (
    <SettingsWithControl label={NAVIGATE_TO_THREAD_AFTER_CREATE_SETTING_LABEL}>
      <Switch
        checked={navigateToThreadAfterCreate}
        onCheckedChange={onNavigateToThreadAfterCreateChange}
        aria-label={NAVIGATE_TO_THREAD_AFTER_CREATE_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}

export function InAppBrowserLinkSettingsControl({
  enabled,
  onEnabledChange,
}: InAppBrowserLinkSettingsControlProps) {
  return (
    <SettingsWithControl
      label={IN_APP_BROWSER_LINK_SETTING_LABEL}
      description="Open http and https links from chat in the in-app browser panel instead of your default browser."
    >
      <Switch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        aria-label={IN_APP_BROWSER_LINK_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}

export function GeneralSettingsSection({
  desktopBrowserAvailable,
  faviconColor,
  navigateToThreadAfterCreate,
  onFaviconColorChange,
  onNavigateToThreadAfterCreateChange,
  onOpenLinksInAppBrowserChange,
  onThemePreferenceChange,
  openLinksInAppBrowser,
  themePreference,
}: GeneralSettingsSectionProps) {
  return (
    <SettingsSection title="General">
      <div className="space-y-4">
        <SettingsWithControl label="Theme">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between border-border/60 bg-card sm:w-48"
                aria-label="Theme"
              >
                {THEME_PREFERENCE_LABELS[themePreference]}
                <Icon
                  name="ChevronDown"
                  className="size-3.5 text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {THEME_PREFERENCE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => onThemePreferenceChange(option.value)}
                >
                  {option.label}
                  <Icon
                    name="Check"
                    className={cn(
                      "ml-auto",
                      themePreference !== option.value && "opacity-0",
                      COARSE_POINTER_ICON_SIZE_CLASS,
                    )}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsWithControl>

        <FaviconColorSettingsControl
          faviconColor={faviconColor}
          onFaviconColorChange={onFaviconColorChange}
        />

        <RootComposeBehaviorSettingsControl
          navigateToThreadAfterCreate={navigateToThreadAfterCreate}
          onNavigateToThreadAfterCreateChange={
            onNavigateToThreadAfterCreateChange
          }
        />

        {desktopBrowserAvailable ? (
          <InAppBrowserLinkSettingsControl
            enabled={openLinksInAppBrowser}
            onEnabledChange={onOpenLinksInAppBrowserChange}
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}

const WORKFLOWS_EXPERIMENT_LABEL = "Workflows";

export function ExperimentsSettingsSection({
  disabled,
  onWorkflowsEnabledChange,
  workflowsEnabled,
}: ExperimentsSettingsSectionProps) {
  return (
    <SettingsSection
      title="Experiments"
      description="Early features that are off by default. Opt in to try them."
    >
      <SettingsWithControl
        label={WORKFLOWS_EXPERIMENT_LABEL}
        description="Multi-agent workflow runs: adds the Workflows sidebar section, project workflows page, and teaches agents the bb workflow CLI."
      >
        <Switch
          checked={workflowsEnabled}
          disabled={disabled}
          onCheckedChange={onWorkflowsEnabledChange}
          aria-label={WORKFLOWS_EXPERIMENT_LABEL}
        />
      </SettingsWithControl>
    </SettingsSection>
  );
}

export function ClaudeCodeSettingsSection({
  enabled,
  endpoint,
  isSaving,
  onEnabledChange,
  onEndpointSave,
}: ClaudeCodeSettingsSectionProps) {
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);

  useEffect(() => {
    setDraftEndpoint(endpoint);
  }, [endpoint]);

  return (
    <SettingsSection title="Claude Code">
      <div className="space-y-4">
        <SettingsWithControl
          label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_SETTING_LABEL}
          description="Route Claude Code API requests through an approved test endpoint that receives interactive CLI-shaped requests."
        >
          <Switch
            checked={enabled}
            disabled={isSaving}
            onCheckedChange={onEnabledChange}
            aria-label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_SETTING_LABEL}
          />
        </SettingsWithControl>

        <SettingsWithControl
          label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT_LABEL}
          description="Only http:// loopback URLs or https://api.anthropic.com are accepted."
        >
          <div className="flex w-full flex-col gap-2 sm:w-80 sm:flex-row">
            <Input
              value={draftEndpoint}
              disabled={isSaving}
              onChange={(event) => setDraftEndpoint(event.target.value)}
              aria-label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT_LABEL}
              className="min-w-0"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSaving || draftEndpoint === endpoint}
              onClick={() => onEndpointSave(draftEndpoint)}
              className="shrink-0"
            >
              Save
            </Button>
          </div>
        </SettingsWithControl>
      </div>
    </SettingsSection>
  );
}

export function AppSettingsView() {
  const queryClient = useQueryClient();
  const themePreference = useThemePreference();
  const systemConfigQuery = useSystemConfig();
  const mockCliTraffic =
    systemConfigQuery.data?.claudeCodeMockCliTraffic ??
    DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  const updateMockCliTraffic = useMutation({
    mutationFn: updateClaudeCodeMockCliTraffic,
    onSuccess: (config) => {
      hydrateSystemConfigCache({ config, queryClient });
    },
  });
  const [faviconColor, setFaviconColor] = useFaviconColorPreference();
  const { hasDaemon } = useHostDaemon();
  const { workspaceOpenTargets } = useWorkspaceOpenTargets({
    enabled: hasDaemon,
  });
  const [directoryTargetId, setDirectoryTargetId] =
    useWorkspaceOpenTargetPreference();
  const [fileTargetId, setFileTargetId] = useFileOpenTargetPreference();
  const [openLinksInAppBrowser, setOpenLinksInAppBrowser] =
    useOpenLinksInAppBrowserPreference();
  const [navigateToThreadAfterCreate, setNavigateToThreadAfterCreate] =
    useNavigateToThreadAfterCreatePreference();
  // The in-app browser only exists on desktop; hide the toggle entirely on web,
  // where it would have no effect.
  const [desktopBrowserAvailable] = useState(isDesktopBrowserAvailable);
  const experiments = systemConfigQuery.data?.experiments ?? defaultExperiments;
  const updateExperimentsMutation = useUpdateExperiments();

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <GeneralSettingsSection
          desktopBrowserAvailable={desktopBrowserAvailable}
          faviconColor={faviconColor}
          navigateToThreadAfterCreate={navigateToThreadAfterCreate}
          openLinksInAppBrowser={openLinksInAppBrowser}
          themePreference={themePreference}
          onFaviconColorChange={setFaviconColor}
          onNavigateToThreadAfterCreateChange={setNavigateToThreadAfterCreate}
          onOpenLinksInAppBrowserChange={setOpenLinksInAppBrowser}
          onThemePreferenceChange={setPreferredTheme}
        />

        <LocalOpenTargetSettingsSection
          directoryTargetId={directoryTargetId}
          fileTargetId={fileTargetId}
          hasDaemon={hasDaemon}
          onDirectoryTargetChange={setDirectoryTargetId}
          onFileTargetChange={setFileTargetId}
          targets={workspaceOpenTargets}
        />

        <ExperimentsSettingsSection
          disabled={
            systemConfigQuery.data === undefined ||
            updateExperimentsMutation.isPending
          }
          onWorkflowsEnabledChange={(enabled) =>
            updateExperimentsMutation.mutate({
              ...experiments,
              workflows: enabled,
            })
          }
          workflowsEnabled={experiments.workflows}
        />

        <ClaudeCodeSettingsSection
          enabled={mockCliTraffic.enabled}
          endpoint={mockCliTraffic.endpoint}
          isSaving={updateMockCliTraffic.isPending}
          onEnabledChange={(enabled) =>
            updateMockCliTraffic.mutate({
              enabled,
              endpoint: mockCliTraffic.endpoint,
            })
          }
          onEndpointSave={(endpoint) =>
            updateMockCliTraffic.mutate({
              enabled: mockCliTraffic.enabled,
              endpoint: endpoint.trim(),
            })
          }
        />

        <AppSourcesSection />
      </div>
    </PageShell>
  );
}
