import { useMemo, useState } from "react";
import { defaultExperiments } from "@bb/domain";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { Switch } from "@/components/ui/switch.js";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { PageShell } from "@/components/ui/page-shell.js";
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
import { cn } from "@/lib/utils";
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
  claudeCodeMockCliTrafficEnabled: boolean;
  onClaudeCodeMockCliTrafficEnabledChange: (enabled: boolean) => void;
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

function LocalOpenTargetPreferenceControl({
  definition,
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
  const unavailableMessage =
    compatibleTargets.length === 0 ? definition.emptyDescription : null;
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
  if (!hasDaemon) {
    return null;
  }

  return (
    <SettingsSection title="File Preferences">
      <div className="space-y-4">
        <LocalOpenTargetPreferenceControl
          definition={DIRECTORY_TARGET_PREFERENCE}
          onTargetChange={onDirectoryTargetChange}
          preferredTargetId={directoryTargetId}
          targets={targets}
        />
        <LocalOpenTargetPreferenceControl
          definition={FILE_TARGET_PREFERENCE}
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

const CLAUDE_CODE_MOCK_CLI_TRAFFIC_EXPERIMENT_LABEL = "Mock CLI Traffic";

export function ExperimentsSettingsSection({
  claudeCodeMockCliTrafficEnabled,
  disabled,
  onClaudeCodeMockCliTrafficEnabledChange,
}: ExperimentsSettingsSectionProps) {
  return (
    <SettingsSection
      title="Experiments"
      description="Early features that are off by default. Opt in to try them."
    >
      <div className="space-y-4">
        <SettingsWithControl
          label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_EXPERIMENT_LABEL}
          description="Proxy Claude Code requests as CLI traffic to api.anthropic.com."
        >
          <Switch
            checked={claudeCodeMockCliTrafficEnabled}
            disabled={disabled}
            onCheckedChange={onClaudeCodeMockCliTrafficEnabledChange}
            aria-label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_EXPERIMENT_LABEL}
          />
        </SettingsWithControl>
      </div>
    </SettingsSection>
  );
}

export function SettingsView() {
  const themePreference = useThemePreference();
  const systemConfigQuery = useSystemConfig();
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
          claudeCodeMockCliTrafficEnabled={
            experiments.claudeCodeMockCliTraffic
          }
          disabled={
            systemConfigQuery.data === undefined ||
            updateExperimentsMutation.isPending
          }
          onClaudeCodeMockCliTrafficEnabledChange={(enabled) =>
            updateExperimentsMutation.mutate({
              ...experiments,
              claudeCodeMockCliTraffic: enabled,
            })
          }
        />
      </div>
    </PageShell>
  );
}
