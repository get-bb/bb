import { useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
// Route views render icons outside the shell's core set. Importing the
// extended registry here ships it as a static dependency of this route chunk,
// so those icons never flash blank waiting for an on-demand load.
import "@bb/shared-ui/icon-extended";
import {
  builtInThemes,
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
  type AppTheme,
  type FaviconColorPreference,
  type PluginThemeMeta,
} from "@bb/domain";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Switch } from "@bb/shared-ui/switch";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
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
import { useHostDaemon, useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { UsageLimitsSettingsSection } from "@/components/settings/UsageLimitsSettingsSection";
import { SidebarThreadListSetting } from "@/components/settings/SidebarThreadListSetting";
import { SplitDimmingSetting } from "@/components/settings/SplitDimmingSetting";
import { useSettingsNavState } from "@/components/settings/settings-nav";
import { PluginSettingsPage } from "@/components/plugin/PluginSettings";
import { FileOpenersSettingsSection } from "@/components/settings/FileOpenersSettingsSection";
import { VoiceInputSettingsSection } from "@/components/settings/VoiceInputSettingsSection";
import { CommunitySettingsSection } from "@/components/settings/CommunitySettingsSection";
import { UpdatesSettingsSection } from "@/components/settings/UpdatesSettingsSection";
import { KeyboardSettingsSection } from "@/components/settings/KeyboardSettingsSection";
import { MachinesSettingsSection } from "@/components/settings/MachinesSettingsSection";
import { ArchivedThreadsSettingsSection } from "@/components/settings/ArchivedThreadsSettingsSection";
import { CliSkillsSettingsSection } from "@/components/settings/CliSkillsSettingsSection";
import { MarketplacesSettingsSection } from "@/components/settings/MarketplacesSettingsSection";
import {
  useUpdateGeneralSettings,
  useUpdateAppearance,
  useUpdateExperiments,
} from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useWorkspaceOpenTargets } from "@/hooks/useWorkspaceOpenTargets";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import {
  FAVICON_COLOR_VALUES,
  getFaviconGlyphHref,
} from "@/lib/favicon-color-preference";
import { useOpenLinksInAppBrowserPreference } from "@/lib/in-app-browser-link-preference";
import { useRewriteLocalhostLinksPreference } from "@/lib/localhost-link-rewrite-preference";
import { useRichTextEditingPreference } from "@/lib/rich-text-editing-preference";
import {
  SETTINGS_ROUTE_PATH,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { useNavigateToThreadAfterCreatePreference } from "@/lib/root-compose-create-preference";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  resolvePreferredWorkspaceOpenTarget,
  supportsWorkspaceOpenTargetCapability,
  useFileOpenTargetPreference,
  useWorkspaceOpenTargetPreference,
  type StoredWorkspaceOpenTargetPreference,
  type WorkspaceOpenTargetCapability,
} from "@/lib/workspace-open-target-preference";
import { getWorkspaceOpenTargetFallbackLabel } from "@/components/workspace-open-target/workspace-open-target-display";
import type { LocalHostDaemonAccessState } from "@/lib/local-host-daemon-access";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

const LOCAL_EDITOR_INTEGRATION_DOCS_URL =
  "https://github.com/get-bb/bb/blob/main/docs/multiple-devices.md#open-bb-from-another-browser";

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
  accessState: LocalHostDaemonAccessState;
  directoryTargetId: StoredWorkspaceOpenTargetPreference;
  fileTargetId: StoredWorkspaceOpenTargetPreference;
  hasDaemon: boolean;
  onDirectoryTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  onFileTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  onRequestAccess: () => Promise<boolean>;
  targets: WorkspaceOpenTarget[];
}

export interface InAppBrowserLinkSettingsControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface RewriteLocalhostLinksSettingsControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface RootComposeBehaviorSettingsControlProps {
  navigateToThreadAfterCreate: boolean;
  onNavigateToThreadAfterCreateChange: (enabled: boolean) => void;
}

export interface SteerActiveThreadOnEnterSettingsControlProps {
  disabled: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface RichTextEditingSettingsControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface UnhandledProviderEventsSettingsControlProps {
  disabled: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface FaviconColorSettingsControlProps {
  disabled: boolean;
  faviconColor: FaviconColorPreference;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
}

export interface AppearanceSettingsSectionProps {
  appearance: AppTheme;
  appearanceDisabled: boolean;
  customThemes: readonly string[];
  pluginThemes: readonly PluginThemeMeta[];
  faviconColor: FaviconColorPreference;
  onAppearanceThemeChange: (themeId: string) => void;
  onCreatePalette: () => void;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
  onThemePreferenceChange: (themePreference: ThemePreference) => void;
  themePreference: ThemePreference;
}

export interface GeneralSettingsSectionProps {
  onReplayOnboarding: () => void;
  desktopBrowserAvailable: boolean;
  navigateToThreadAfterCreate: boolean;
  onNavigateToThreadAfterCreateChange: (enabled: boolean) => void;
  onOpenLinksInAppBrowserChange: (enabled: boolean) => void;
  onRewriteLocalhostLinksChange: (enabled: boolean) => void;
  onRichTextEditingChange: (enabled: boolean) => void;
  onSteerActiveThreadOnEnterChange: (enabled: boolean) => void;
  openLinksInAppBrowser: boolean;
  rewriteLocalhostLinks: boolean;
  richTextEditing: boolean;
  replayOnboardingAvailable: boolean;
  steerActiveThreadOnEnter: boolean;
  steerActiveThreadOnEnterDisabled: boolean;
}

export type DebugSettingsSectionProps =
  UnhandledProviderEventsSettingsControlProps;

function appPaletteLabel(
  appearance: AppTheme,
  pluginThemes: readonly PluginThemeMeta[],
): string {
  const meta = builtInThemes.find((entry) => entry.id === appearance.themeId);
  return (
    meta?.name ??
    pluginThemes.find((entry) => entry.id === appearance.themeId)?.name ??
    appearance.themeId
  );
}

export interface ExperimentsSettingsSectionProps {
  /** True while the config query hasn't loaded or a toggle write is in flight. */
  disabled: boolean;
  claudeCodeMockCliTrafficEnabled: boolean;
  editMessagesEnabled: boolean;
  newOnboardingEnabled: boolean;
  providerSessionReapingEnabled: boolean;
  onClaudeCodeMockCliTrafficEnabledChange: (enabled: boolean) => void;
  onEditMessagesEnabledChange: (enabled: boolean) => void;
  onNewOnboardingEnabledChange: (enabled: boolean) => void;
  onProviderSessionReapingEnabledChange: (enabled: boolean) => void;
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

const SETTINGS_DROPDOWN_TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-36";
const SETTINGS_DROPDOWN_CONTENT_CLASS =
  "min-w-[var(--radix-dropdown-menu-trigger-width)]";

const CREATE_CUSTOM_PALETTE_PROMPT =
  "Create a custom bb palette. First run `bb theme dir` to find the custom theme directory. Ask me for the palette name and visual direction, then create `<theme-dir>/<name>/theme.css` with light and dark theme variables compatible with bb's theme tokens.";
const PALETTE_SETTING_DESCRIPTION =
  "Palettes change bb's colors, including syntax colors in diffs and file previews. Choose a built-in palette or create one from a prompt.";

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
  disabled,
  faviconColor,
  onFaviconColorChange,
}: FaviconColorSettingsControlProps) {
  return (
    <SettingsWithControl
      label="Favicon color"
      description="Tint browser tabs to tell instances apart."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
            aria-label="Favicon color"
            disabled={disabled}
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
        <DropdownMenuContent
          align="end"
          className={SETTINGS_DROPDOWN_CONTENT_CLASS}
        >
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
            className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
            aria-label={definition.label}
          >
            <span className="flex min-w-0 items-center gap-2">
              {selectedTargetId ? (
                <WorkspaceOpenTargetIcon
                  {...(resolvedTarget
                    ? { target: resolvedTarget }
                    : { targetId: selectedTargetId })}
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
        <DropdownMenuContent
          align="end"
          className={SETTINGS_DROPDOWN_CONTENT_CLASS}
        >
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
                <WorkspaceOpenTargetIcon target={target} className="size-5" />
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
  accessState,
  directoryTargetId,
  fileTargetId,
  hasDaemon,
  onDirectoryTargetChange,
  onFileTargetChange,
  onRequestAccess,
  targets,
}: LocalOpenTargetSettingsSectionProps) {
  const [accessRequestPending, setAccessRequestPending] = useState(false);

  if (accessState === "unavailable") {
    return null;
  }

  const handleRequestAccess = async () => {
    setAccessRequestPending(true);
    try {
      await onRequestAccess();
    } finally {
      setAccessRequestPending(false);
    }
  };

  if (!hasDaemon) {
    const accessDenied = accessState === "denied";
    const accessAvailable = accessState === "available";
    const descriptionText = accessDenied
      ? "Your browser blocked access to bb on this device. Allow local network access for this site in browser settings, then reload bb."
      : accessAvailable
        ? "bb couldn’t connect to its local editor helper. Make sure the bb desktop app or CLI is running on this device, then retry. If it is already running, a remote browser origin may need to be configured."
        : "Connect this browser to bb on this device so it can discover installed editors. bb only contacts the local helper after you choose Enable; your browser may ask for local network access.";
    const buttonLabel = accessRequestPending
      ? accessAvailable
        ? "Retrying…"
        : "Enabling…"
      : accessDenied
        ? "Blocked"
        : accessAvailable
          ? "Retry"
          : "Enable";

    return (
      <SettingsSection title="File Preferences">
        <SettingsWithControl
          label="Local editor integration"
          description={
            <>
              {descriptionText}{" "}
              <a
                href={LOCAL_EDITOR_INTEGRATION_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={(event) => {
                  event.preventDefault();
                  openUrlInExternalBrowser(LOCAL_EDITOR_INTEGRATION_DOCS_URL);
                }}
              >
                Setup guide
                <Icon
                  name="ExternalLink"
                  className="size-3 shrink-0"
                  aria-hidden
                />
              </a>
            </>
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={accessRequestPending || accessDenied}
            onClick={handleRequestAccess}
          >
            {buttonLabel}
          </Button>
        </SettingsWithControl>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="File Preferences">
      <div className="space-y-5">
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
const REWRITE_LOCALHOST_LINKS_SETTING_LABEL = "Rewrite localhost links";
const NAVIGATE_TO_THREAD_AFTER_CREATE_SETTING_LABEL =
  "Navigate to threads on creation";
const RICH_TEXT_EDITING_SETTING_LABEL = "Markdown formatting in prompt box";
const UNHANDLED_PROVIDER_EVENTS_SETTING_LABEL =
  "Show unhandled provider events";
const STEER_ACTIVE_THREAD_ON_ENTER_SETTING_LABEL =
  "Steer running threads on Enter";

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

export function SteerActiveThreadOnEnterSettingsControl({
  disabled,
  enabled,
  onEnabledChange,
}: SteerActiveThreadOnEnterSettingsControlProps) {
  return (
    <SettingsWithControl
      label={STEER_ACTIVE_THREAD_ON_ENTER_SETTING_LABEL}
      description="Use Enter to steer the current run and Command+Enter to queue a follow-up."
    >
      <Switch
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onEnabledChange}
        aria-label={STEER_ACTIVE_THREAD_ON_ENTER_SETTING_LABEL}
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
      description="Open web links inside bb."
    >
      <Switch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        aria-label={IN_APP_BROWSER_LINK_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}

export function RewriteLocalhostLinksSettingsControl({
  enabled,
  onEnabledChange,
}: RewriteLocalhostLinksSettingsControlProps) {
  return (
    <SettingsWithControl
      label={REWRITE_LOCALHOST_LINKS_SETTING_LABEL}
      description="Point localhost links at this host."
    >
      <Switch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        aria-label={REWRITE_LOCALHOST_LINKS_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}

export function RichTextEditingSettingsControl({
  enabled,
  onEnabledChange,
}: RichTextEditingSettingsControlProps) {
  return (
    <SettingsWithControl label={RICH_TEXT_EDITING_SETTING_LABEL}>
      <Switch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        aria-label={RICH_TEXT_EDITING_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}

export function UnhandledProviderEventsSettingsControl({
  disabled,
  enabled,
  onEnabledChange,
}: UnhandledProviderEventsSettingsControlProps) {
  return (
    <SettingsWithControl
      label={UNHANDLED_PROVIDER_EVENTS_SETTING_LABEL}
      description="Show raw provider events bb does not recognize. Development builds always show these events."
    >
      <Switch
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onEnabledChange}
        aria-label={UNHANDLED_PROVIDER_EVENTS_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}

export function AppearanceSettingsSection({
  appearance,
  appearanceDisabled,
  customThemes,
  pluginThemes,
  faviconColor,
  onAppearanceThemeChange,
  onFaviconColorChange,
  onCreatePalette,
  onThemePreferenceChange,
  themePreference,
}: AppearanceSettingsSectionProps) {
  return (
    <SettingsSection title="Appearance">
      <div className="space-y-5">
        <SidebarThreadListSetting />
        <SettingsWithControl label="Theme">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
                aria-label="Theme"
              >
                {THEME_PREFERENCE_LABELS[themePreference]}
                <Icon
                  name="ChevronDown"
                  className="size-3.5 text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className={SETTINGS_DROPDOWN_CONTENT_CLASS}
            >
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

        <SettingsWithControl
          label="Palette"
          description={PALETTE_SETTING_DESCRIPTION}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
                aria-label="Palette"
                disabled={appearanceDisabled}
              >
                <span className="min-w-0 truncate">
                  {appPaletteLabel(appearance, pluginThemes)}
                </span>
                <Icon
                  name="ChevronDown"
                  className="size-3.5 text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className={SETTINGS_DROPDOWN_CONTENT_CLASS}
            >
              {builtInThemes.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  onSelect={() => onAppearanceThemeChange(entry.id)}
                >
                  {entry.name}
                  <Icon
                    name="Check"
                    className={cn(
                      "ml-auto",
                      appearance.themeId !== entry.id && "opacity-0",
                      COARSE_POINTER_ICON_SIZE_CLASS,
                    )}
                  />
                </DropdownMenuItem>
              ))}
              {customThemes.map((name) => (
                <DropdownMenuItem
                  key={`custom:${name}`}
                  onSelect={() => onAppearanceThemeChange(name)}
                >
                  {name}
                  <Icon
                    name="Check"
                    className={cn(
                      "ml-auto",
                      appearance.themeId !== name && "opacity-0",
                      COARSE_POINTER_ICON_SIZE_CLASS,
                    )}
                  />
                </DropdownMenuItem>
              ))}
              {pluginThemes.map((theme) => (
                <DropdownMenuItem
                  key={theme.id}
                  onSelect={() => onAppearanceThemeChange(theme.id)}
                >
                  {theme.name}
                  <span className="text-muted-foreground">
                    ({theme.pluginId})
                  </span>
                  <Icon
                    name="Check"
                    className={cn(
                      "ml-auto",
                      appearance.themeId !== theme.id && "opacity-0",
                      COARSE_POINTER_ICON_SIZE_CLASS,
                    )}
                  />
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onCreatePalette}>
                <Icon name="Plus" className={COARSE_POINTER_ICON_SIZE_CLASS} />
                Create
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsWithControl>

        <FaviconColorSettingsControl
          disabled={appearanceDisabled}
          faviconColor={faviconColor}
          onFaviconColorChange={onFaviconColorChange}
        />
        <SplitDimmingSetting />
      </div>
    </SettingsSection>
  );
}

export function GeneralSettingsSection({
  desktopBrowserAvailable,
  navigateToThreadAfterCreate,
  onNavigateToThreadAfterCreateChange,
  onOpenLinksInAppBrowserChange,
  onRewriteLocalhostLinksChange,
  onRichTextEditingChange,
  onSteerActiveThreadOnEnterChange,
  openLinksInAppBrowser,
  rewriteLocalhostLinks,
  richTextEditing,
  replayOnboardingAvailable,
  steerActiveThreadOnEnter,
  steerActiveThreadOnEnterDisabled,
  onReplayOnboarding,
}: GeneralSettingsSectionProps) {
  return (
    <SettingsSection title="General">
      <div className="space-y-5">
        <RootComposeBehaviorSettingsControl
          navigateToThreadAfterCreate={navigateToThreadAfterCreate}
          onNavigateToThreadAfterCreateChange={
            onNavigateToThreadAfterCreateChange
          }
        />

        <RichTextEditingSettingsControl
          enabled={richTextEditing}
          onEnabledChange={onRichTextEditingChange}
        />

        <SteerActiveThreadOnEnterSettingsControl
          disabled={steerActiveThreadOnEnterDisabled}
          enabled={steerActiveThreadOnEnter}
          onEnabledChange={onSteerActiveThreadOnEnterChange}
        />

        {desktopBrowserAvailable ? (
          <InAppBrowserLinkSettingsControl
            enabled={openLinksInAppBrowser}
            onEnabledChange={onOpenLinksInAppBrowserChange}
          />
        ) : null}

        <RewriteLocalhostLinksSettingsControl
          enabled={rewriteLocalhostLinks}
          onEnabledChange={onRewriteLocalhostLinksChange}
        />

        {replayOnboardingAvailable ? (
          <ReplayOnboardingSettingsControl onReplay={onReplayOnboarding} />
        ) : null}
      </div>
    </SettingsSection>
  );
}

/**
 * The parent only shows this control when the new-onboarding experiment is on.
 * Clearing `onboardingCompletedAt` then reopens the flow on the spot.
 */
function ReplayOnboardingSettingsControl({
  onReplay,
}: {
  onReplay: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm">Setup guide</div>
        <p className="mt-0.5 text-xs text-subtle-foreground">
          Walk through agent detection and adding projects again.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onReplay}>
        Show again
      </Button>
    </div>
  );
}

export function DebugSettingsSection({
  disabled,
  enabled,
  onEnabledChange,
}: DebugSettingsSectionProps) {
  return (
    <SettingsSection title="Debug">
      <UnhandledProviderEventsSettingsControl
        disabled={disabled}
        enabled={enabled}
        onEnabledChange={onEnabledChange}
      />
    </SettingsSection>
  );
}

interface ProviderSettingsSectionProps {
  memoryEnabled: boolean;
  subagentsDisabled: boolean;
  workflowsDisabled: boolean;
  disabled: boolean;
  onMemoryEnabledChange: (enabled: boolean) => void;
  onSubagentsDisabledChange: (disabled: boolean) => void;
  onWorkflowsDisabledChange: (disabled: boolean) => void;
  providerId: "codex" | "claude-code";
}

export function ProviderSettingsSection({
  memoryEnabled,
  subagentsDisabled,
  workflowsDisabled,
  disabled,
  onMemoryEnabledChange,
  onSubagentsDisabledChange,
  onWorkflowsDisabledChange,
  providerId,
}: ProviderSettingsSectionProps) {
  const isCodex = providerId === "codex";
  const label = isCodex ? "Codex memory" : "Claude Code memory";
  return (
    <SettingsSection title={isCodex ? "Codex" : "Claude Code"}>
      <div className="space-y-4">
        <SettingsWithControl
          label={label}
          description={
            isCodex
              ? "Allow Codex to recall existing memories and generate new memories from bb threads."
              : "Allow Claude Code to read and write its native auto-memory for bb threads."
          }
        >
          <Switch
            aria-label={label}
            checked={memoryEnabled}
            disabled={disabled}
            onCheckedChange={onMemoryEnabledChange}
          />
        </SettingsWithControl>
        <SettingsWithControl
          label="Disable provider subagents"
          description={
            isCodex
              ? "Prevent Codex from starting native subagents so agents use bb for delegation."
              : "Hide Claude Code's native Task tool so agents use bb for delegation."
          }
        >
          <Switch
            aria-label="Disable provider subagents"
            checked={subagentsDisabled}
            disabled={disabled}
            onCheckedChange={onSubagentsDisabledChange}
          />
        </SettingsWithControl>
        {!isCodex ? (
          <SettingsWithControl
            label="Disable Workflow tool"
            description="Hide Claude Code's native Workflow tool for bb threads."
          >
            <Switch
              aria-label="Disable Workflow tool"
              checked={workflowsDisabled}
              disabled={disabled}
              onCheckedChange={onWorkflowsDisabledChange}
            />
          </SettingsWithControl>
        ) : null}
      </div>
    </SettingsSection>
  );
}

const CLAUDE_CODE_MOCK_CLI_TRAFFIC_EXPERIMENT_LABEL = "Mock CLI Traffic";
const EDIT_MESSAGES_EXPERIMENT_LABEL = "Edit messages";
const NEW_ONBOARDING_EXPERIMENT_LABEL = "New onboarding";
const PROVIDER_SESSION_REAPING_EXPERIMENT_LABEL =
  "Idle provider session release";
export function ExperimentsSettingsSection({
  claudeCodeMockCliTrafficEnabled,
  disabled,
  editMessagesEnabled,
  newOnboardingEnabled,
  providerSessionReapingEnabled,
  onClaudeCodeMockCliTrafficEnabledChange,
  onEditMessagesEnabledChange,
  onNewOnboardingEnabledChange,
  onProviderSessionReapingEnabledChange,
}: ExperimentsSettingsSectionProps) {
  return (
    <SettingsSection
      title="Experiments"
      description="Early features that are off by default. Opt in to try them."
    >
      <div className="space-y-5">
        <SettingsWithControl
          label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_EXPERIMENT_LABEL}
          labelBadge="dev-only"
          description="Route Claude Code through CLI-style traffic."
        >
          <Switch
            checked={claudeCodeMockCliTrafficEnabled}
            disabled={disabled}
            onCheckedChange={onClaudeCodeMockCliTrafficEnabledChange}
            aria-label={CLAUDE_CODE_MOCK_CLI_TRAFFIC_EXPERIMENT_LABEL}
          />
        </SettingsWithControl>

        <SettingsWithControl
          label={EDIT_MESSAGES_EXPERIMENT_LABEL}
          description="Edit a sent message and replace the conversation from that point. Workspace changes are kept."
        >
          <Switch
            checked={editMessagesEnabled}
            disabled={disabled}
            onCheckedChange={onEditMessagesEnabledChange}
            aria-label={EDIT_MESSAGES_EXPERIMENT_LABEL}
          />
        </SettingsWithControl>

        <SettingsWithControl
          label={NEW_ONBOARDING_EXPERIMENT_LABEL}
          description="Enable the new first-run guide for agent setup and project selection."
        >
          <Switch
            checked={newOnboardingEnabled}
            disabled={disabled}
            onCheckedChange={onNewOnboardingEnabledChange}
            aria-label={NEW_ONBOARDING_EXPERIMENT_LABEL}
          />
        </SettingsWithControl>

        <SettingsWithControl
          label={PROVIDER_SESSION_REAPING_EXPERIMENT_LABEL}
          description="Release restorable provider sessions after 30 idle minutes. A change can take up to five minutes."
        >
          <Switch
            checked={providerSessionReapingEnabled}
            disabled={disabled}
            onCheckedChange={onProviderSessionReapingEnabledChange}
            aria-label={PROVIDER_SESSION_REAPING_EXPERIMENT_LABEL}
          />
        </SettingsWithControl>
      </div>
    </SettingsSection>
  );
}

export function SettingsView() {
  const navigate = useNavigate();
  const themePreference = useThemePreference();
  const systemConfigQuery = useSystemConfig();
  const { hasDaemon } = useHostDaemon();
  const { accessState, requestAccess } = useLocalHostDaemonAccess();
  const { workspaceOpenTargets } = useWorkspaceOpenTargets({
    enabled: hasDaemon,
  });
  const [directoryTargetId, setDirectoryTargetId] =
    useWorkspaceOpenTargetPreference(workspaceOpenTargets);
  const [fileTargetId, setFileTargetId] =
    useFileOpenTargetPreference(workspaceOpenTargets);
  const [openLinksInAppBrowser, setOpenLinksInAppBrowser] =
    useOpenLinksInAppBrowserPreference();
  const [rewriteLocalhostLinks, setRewriteLocalhostLinks] =
    useRewriteLocalhostLinksPreference();
  const [navigateToThreadAfterCreate, setNavigateToThreadAfterCreate] =
    useNavigateToThreadAfterCreatePreference();
  const [richTextEditing, setRichTextEditing] = useRichTextEditingPreference();
  // The in-app browser only exists on desktop; hide the toggle entirely on web,
  // where it would have no effect.
  const [desktopBrowserAvailable] = useState(isDesktopBrowserAvailable);
  const experiments = systemConfigQuery.data?.experiments ?? defaultExperiments;
  const updateExperimentsMutation = useUpdateExperiments();
  const generalSettings =
    systemConfigQuery.data?.generalSettings ?? defaultAppSettings;
  const updateGeneralSettingsMutation = useUpdateGeneralSettings();
  const appearance = systemConfigQuery.data?.appearance ?? defaultAppTheme;
  const updateAppearanceMutation = useUpdateAppearance();
  const { activePluginId, activeProviderId, activeSection, hasUnknownSection } =
    useSettingsNavState();
  if (hasUnknownSection) {
    return <Navigate to={SETTINGS_ROUTE_PATH} replace />;
  }

  let content: ReactNode = null;
  if (activePluginId !== null) {
    content = <PluginSettingsPage pluginId={activePluginId} />;
  } else if (activeProviderId !== null) {
    const isCodex = activeProviderId === "codex";
    content = (
      <ProviderSettingsSection
        providerId={activeProviderId}
        memoryEnabled={
          isCodex
            ? generalSettings.codexMemoryEnabled
            : generalSettings.claudeCodeMemoryEnabled
        }
        subagentsDisabled={
          isCodex
            ? generalSettings.codexSubagentsDisabled
            : generalSettings.claudeCodeSubagentsDisabled
        }
        workflowsDisabled={generalSettings.claudeCodeWorkflowsDisabled}
        disabled={
          systemConfigQuery.data === undefined ||
          updateGeneralSettingsMutation.isPending
        }
        onMemoryEnabledChange={(enabled) =>
          updateGeneralSettingsMutation.mutate({
            ...generalSettings,
            ...(isCodex
              ? { codexMemoryEnabled: enabled }
              : { claudeCodeMemoryEnabled: enabled }),
          })
        }
        onSubagentsDisabledChange={(disabled) =>
          updateGeneralSettingsMutation.mutate({
            ...generalSettings,
            ...(isCodex
              ? { codexSubagentsDisabled: disabled }
              : { claudeCodeSubagentsDisabled: disabled }),
          })
        }
        onWorkflowsDisabledChange={(disabled) =>
          updateGeneralSettingsMutation.mutate({
            ...generalSettings,
            claudeCodeWorkflowsDisabled: disabled,
          })
        }
      />
    );
  } else if (activeSection === "appearance") {
    content = (
      <AppearanceSettingsSection
        appearance={appearance}
        appearanceDisabled={
          systemConfigQuery.data === undefined ||
          updateAppearanceMutation.isPending
        }
        customThemes={systemConfigQuery.data?.customThemes ?? []}
        pluginThemes={systemConfigQuery.data?.pluginThemes ?? []}
        faviconColor={appearance.faviconColor}
        themePreference={themePreference}
        onAppearanceThemeChange={(themeId) =>
          updateAppearanceMutation.mutate({
            themeId,
            faviconColor: appearance.faviconColor,
          })
        }
        onCreatePalette={() =>
          navigate(getRootComposeRoutePath(), {
            state: {
              focusPrompt: true,
              initialPrompt: CREATE_CUSTOM_PALETTE_PROMPT,
            },
          })
        }
        onFaviconColorChange={(faviconColor) =>
          updateAppearanceMutation.mutate({
            themeId: appearance.themeId,
            faviconColor,
          })
        }
        onThemePreferenceChange={setPreferredTheme}
      />
    );
  } else if (activeSection === "usage") {
    content = <UsageLimitsSettingsSection />;
  } else if (activeSection === "keyboard") {
    content = <KeyboardSettingsSection />;
  } else if (activeSection === "files") {
    content = (
      <>
        <LocalOpenTargetSettingsSection
          accessState={accessState}
          directoryTargetId={directoryTargetId}
          fileTargetId={fileTargetId}
          hasDaemon={hasDaemon}
          onDirectoryTargetChange={setDirectoryTargetId}
          onFileTargetChange={setFileTargetId}
          onRequestAccess={requestAccess}
          targets={workspaceOpenTargets}
        />
        <FileOpenersSettingsSection />
      </>
    );
  } else if (activeSection === "machines") {
    content = <MachinesSettingsSection />;
  } else if (activeSection === "updates") {
    content = <UpdatesSettingsSection />;
  } else if (activeSection === "experiments") {
    content = (
      <ExperimentsSettingsSection
        claudeCodeMockCliTrafficEnabled={experiments.claudeCodeMockCliTraffic}
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
        editMessagesEnabled={experiments.editMessages}
        onEditMessagesEnabledChange={(enabled) =>
          updateExperimentsMutation.mutate({
            ...experiments,
            editMessages: enabled,
          })
        }
        newOnboardingEnabled={experiments.newOnboarding}
        onNewOnboardingEnabledChange={(enabled) =>
          updateExperimentsMutation.mutate({
            ...experiments,
            newOnboarding: enabled,
          })
        }
        providerSessionReapingEnabled={experiments.providerSessionReaping}
        onProviderSessionReapingEnabledChange={(enabled) =>
          updateExperimentsMutation.mutate({
            ...experiments,
            providerSessionReaping: enabled,
          })
        }
      />
    );
  } else if (activeSection === "marketplaces") {
    content = <MarketplacesSettingsSection />;
  } else if (activeSection === "community") {
    content = <CommunitySettingsSection />;
  } else if (activeSection === "archived") {
    content = <ArchivedThreadsSettingsSection />;
  } else {
    content = (
      <>
        <GeneralSettingsSection
          desktopBrowserAvailable={desktopBrowserAvailable}
          navigateToThreadAfterCreate={navigateToThreadAfterCreate}
          openLinksInAppBrowser={openLinksInAppBrowser}
          rewriteLocalhostLinks={rewriteLocalhostLinks}
          richTextEditing={richTextEditing}
          replayOnboardingAvailable={experiments.newOnboarding}
          steerActiveThreadOnEnter={generalSettings.steerActiveThreadOnEnter}
          steerActiveThreadOnEnterDisabled={
            systemConfigQuery.data === undefined ||
            updateGeneralSettingsMutation.isPending
          }
          onNavigateToThreadAfterCreateChange={setNavigateToThreadAfterCreate}
          onOpenLinksInAppBrowserChange={setOpenLinksInAppBrowser}
          onReplayOnboarding={() =>
            updateGeneralSettingsMutation.mutate({
              ...generalSettings,
              onboardingCompletedAt: null,
            })
          }
          onRewriteLocalhostLinksChange={setRewriteLocalhostLinks}
          onRichTextEditingChange={setRichTextEditing}
          onSteerActiveThreadOnEnterChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              ...generalSettings,
              steerActiveThreadOnEnter: enabled,
            })
          }
        />
        <CliSkillsSettingsSection />
        <VoiceInputSettingsSection />
        <DebugSettingsSection
          enabled={generalSettings.showUnhandledProviderEvents}
          disabled={
            systemConfigQuery.data === undefined ||
            updateGeneralSettingsMutation.isPending
          }
          onEnabledChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              ...generalSettings,
              showUnhandledProviderEvents: enabled,
            })
          }
        />
      </>
    );
  }

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-10">{content}</div>
    </PageShell>
  );
}
