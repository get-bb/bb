import { useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  builtInThemes,
  defaultAppTheme,
  defaultExperiments,
  isValidElectronAccelerator,
  type AppTheme,
  type FaviconColorPreference,
} from "@bb/domain";
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
  DropdownMenuSeparator,
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
import { UsageLimitsSettingsSection } from "@/components/settings/UsageLimitsSettingsSection";
import {
  useUpdateAppearance,
  useUpdateExperiments,
} from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useWorkspaceOpenTargets } from "@/hooks/useWorkspaceOpenTargets";
import { getBbDesktopInfo, isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import {
  FAVICON_COLOR_VALUES,
  getFaviconGlyphHref,
} from "@/lib/favicon-color-preference";
import { useOpenLinksInAppBrowserPreference } from "@/lib/in-app-browser-link-preference";
import { useRewriteLocalhostLinksPreference } from "@/lib/localhost-link-rewrite-preference";
import { useRichTextEditingPreference } from "@/lib/rich-text-editing-preference";
import { getRootComposeRoutePath } from "@/lib/route-paths";
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

export interface RewriteLocalhostLinksSettingsControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface RootComposeBehaviorSettingsControlProps {
  navigateToThreadAfterCreate: boolean;
  onNavigateToThreadAfterCreateChange: (enabled: boolean) => void;
}

export interface RichTextEditingSettingsControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export interface FaviconColorSettingsControlProps {
  disabled: boolean;
  faviconColor: FaviconColorPreference;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
}

export interface GeneralSettingsSectionProps {
  appearance: AppTheme;
  appearanceDisabled: boolean;
  customThemes: readonly string[];
  desktopBrowserAvailable: boolean;
  faviconColor: FaviconColorPreference;
  navigateToThreadAfterCreate: boolean;
  onAppearanceThemeChange: (themeId: string) => void;
  onCreatePalette: () => void;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
  onNavigateToThreadAfterCreateChange: (enabled: boolean) => void;
  onOpenLinksInAppBrowserChange: (enabled: boolean) => void;
  onRewriteLocalhostLinksChange: (enabled: boolean) => void;
  onRichTextEditingChange: (enabled: boolean) => void;
  onThemePreferenceChange: (themePreference: ThemePreference) => void;
  openLinksInAppBrowser: boolean;
  rewriteLocalhostLinks: boolean;
  richTextEditing: boolean;
  themePreference: ThemePreference;
}

function appPaletteLabel(appearance: AppTheme): string {
  const meta = builtInThemes.find((entry) => entry.id === appearance.themeId);
  return meta?.name ?? appearance.themeId;
}

export interface ExperimentsSettingsSectionProps {
  /** True while the config query hasn't loaded or a toggle write is in flight. */
  disabled: boolean;
  claudeCodeMockCliTrafficEnabled: boolean;
  desktopShellAvailable: boolean;
  onClaudeCodeMockCliTrafficEnabledChange: (enabled: boolean) => void;
  onPopoutChatEnabledChange: (enabled: boolean) => void;
  onPopoutChatHotkeyChange: (hotkey: string) => void;
  onUiForkingEnabledChange: (enabled: boolean) => void;
  popoutChatEnabled: boolean;
  popoutChatHotkey: string;
  uiForkingEnabled: boolean;
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
  "Palettes change bb's colors across light and dark mode. Choose a built-in palette or create one from a prompt.";

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
const RICH_TEXT_EDITING_SETTING_LABEL =
  "Markdown formatting in prompt box";

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

export function GeneralSettingsSection({
  appearance,
  appearanceDisabled,
  customThemes,
  desktopBrowserAvailable,
  faviconColor,
  navigateToThreadAfterCreate,
  onAppearanceThemeChange,
  onFaviconColorChange,
  onNavigateToThreadAfterCreateChange,
  onOpenLinksInAppBrowserChange,
  onRewriteLocalhostLinksChange,
  onRichTextEditingChange,
  onCreatePalette,
  onThemePreferenceChange,
  openLinksInAppBrowser,
  rewriteLocalhostLinks,
  richTextEditing,
  themePreference,
}: GeneralSettingsSectionProps) {
  return (
    <SettingsSection title="General">
      <div className="space-y-5">
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
                  {appPaletteLabel(appearance)}
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
      </div>
    </SettingsSection>
  );
}

const CLAUDE_CODE_MOCK_CLI_TRAFFIC_EXPERIMENT_LABEL = "Mock CLI Traffic";
const POPOUT_CHAT_EXPERIMENT_LABEL = "Popout chat";
const POPOUT_CHAT_HOTKEY_LABEL = "Hotkey";
const UI_FORKING_EXPERIMENT_LABEL = "UI forking";

interface HotkeyRecorderProps {
  disabled: boolean;
  hotkey: string;
  onHotkeyChange: (hotkey: string) => void;
}

type HotkeyButtonKeyDownEvent = KeyboardEvent<HTMLButtonElement>;

function formatHotkeyForMacos(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => {
      switch (part) {
        case "Alt":
        case "Option":
          return "⌥";
        case "Command":
        case "Cmd":
          return "⌘";
        case "CommandOrControl":
        case "CmdOrCtrl":
          return "⌘/Ctrl";
        case "Control":
        case "Ctrl":
          return "⌃";
        case "Shift":
          return "⇧";
        default:
          return part;
      }
    })
    .join(" ");
}

function isModifierKey(key: string): boolean {
  return (
    key === "Alt" ||
    key === "Control" ||
    key === "Meta" ||
    key === "OS" ||
    key === "Shift"
  );
}

function normalizeAcceleratorKey(key: string): string | null {
  if (key === " " || key === "Spacebar") {
    return "Space";
  }
  if (key.length === 1) {
    if (key === "+") {
      return "Plus";
    }
    return key.toUpperCase();
  }
  if (key.startsWith("Arrow")) {
    return key.slice("Arrow".length);
  }
  switch (key) {
    case "Backspace":
    case "Delete":
    case "Down":
    case "End":
    case "Enter":
    case "Home":
    case "Insert":
    case "Left":
    case "PageDown":
    case "PageUp":
    case "Right":
    case "Space":
    case "Tab":
    case "Up":
      return key;
    default:
      return /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key) ? key : null;
  }
}

function buildElectronAcceleratorFromKeydown(
  event: HotkeyButtonKeyDownEvent,
): string | null {
  if (isModifierKey(event.key)) {
    return null;
  }

  const key = normalizeAcceleratorKey(event.key);
  if (key === null) {
    return null;
  }

  const modifiers: string[] = [];
  if (event.metaKey) {
    modifiers.push("Command");
  }
  if (event.ctrlKey) {
    modifiers.push("Control");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }
  if (modifiers.length === 0) {
    return null;
  }
  const accelerator = [...modifiers, key].join("+");
  return isValidElectronAccelerator(accelerator) ? accelerator : null;
}

function HotkeyRecorder({
  disabled,
  hotkey,
  onHotkeyChange,
}: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setRecording(true);
    setError(null);
  }

  function handleKeyDown(event: HotkeyButtonKeyDownEvent) {
    if (!recording) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setRecording(false);
      setError(null);
      return;
    }

    const accelerator = buildElectronAcceleratorFromKeydown(event);
    if (accelerator === null) {
      setError("Use at least one modifier with a key.");
      return;
    }

    onHotkeyChange(accelerator);
    setRecording(false);
    setError(null);
  }

  function handleBlur() {
    setRecording(false);
    setError(null);
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "h-7 min-w-24 px-2 font-mono text-xs",
          recording ? "border-ring text-foreground" : null,
        )}
        disabled={disabled}
        onClick={handleClick}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label="Record popout chat hotkey"
      >
        {recording ? "Press keys" : formatHotkeyForMacos(hotkey)}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ExperimentsSettingsSection({
  claudeCodeMockCliTrafficEnabled,
  desktopShellAvailable,
  disabled,
  onClaudeCodeMockCliTrafficEnabledChange,
  onPopoutChatEnabledChange,
  onPopoutChatHotkeyChange,
  onUiForkingEnabledChange,
  popoutChatEnabled,
  popoutChatHotkey,
  uiForkingEnabled,
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
          label={UI_FORKING_EXPERIMENT_LABEL}
          description="Let the bb CLI (bb ui) fork, edit, and live-reload the app's own frontend. This feature is unstable, and your forks will probably break in the future. Off keeps the shipped UI."
        >
          <Switch
            checked={uiForkingEnabled}
            disabled={disabled}
            onCheckedChange={onUiForkingEnabledChange}
            aria-label={UI_FORKING_EXPERIMENT_LABEL}
          />
        </SettingsWithControl>

        <SettingsWithControl
          label={POPOUT_CHAT_EXPERIMENT_LABEL}
          description="Open compact desktop chat with a hotkey."
        >
          <div className="flex items-center gap-2">
            {!desktopShellAvailable ? (
              <span className="text-xs text-muted-foreground">
                Desktop only
              </span>
            ) : null}
            <Switch
              checked={popoutChatEnabled}
              disabled={disabled || !desktopShellAvailable}
              onCheckedChange={onPopoutChatEnabledChange}
              aria-label={POPOUT_CHAT_EXPERIMENT_LABEL}
            />
          </div>
        </SettingsWithControl>

        {popoutChatEnabled ? (
          <div className="border-l border-border pl-3">
            <SettingsWithControl
              label={POPOUT_CHAT_HOTKEY_LABEL}
              description="Record the popout chat shortcut."
            >
              <HotkeyRecorder
                disabled={disabled || !desktopShellAvailable}
                hotkey={popoutChatHotkey}
                onHotkeyChange={onPopoutChatHotkeyChange}
              />
            </SettingsWithControl>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

export function SettingsView() {
  const navigate = useNavigate();
  const themePreference = useThemePreference();
  const systemConfigQuery = useSystemConfig();
  const { hasDaemon } = useHostDaemon();
  const { workspaceOpenTargets } = useWorkspaceOpenTargets({
    enabled: hasDaemon,
  });
  const [directoryTargetId, setDirectoryTargetId] =
    useWorkspaceOpenTargetPreference();
  const [fileTargetId, setFileTargetId] = useFileOpenTargetPreference();
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
  const [desktopShellAvailable] = useState(() => getBbDesktopInfo() !== null);
  const experiments = systemConfigQuery.data?.experiments ?? defaultExperiments;
  const updateExperimentsMutation = useUpdateExperiments();
  const appearance = systemConfigQuery.data?.appearance ?? defaultAppTheme;
  const updateAppearanceMutation = useUpdateAppearance();

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <GeneralSettingsSection
          appearance={appearance}
          appearanceDisabled={
            systemConfigQuery.data === undefined ||
            updateAppearanceMutation.isPending
          }
          customThemes={systemConfigQuery.data?.customThemes ?? []}
          desktopBrowserAvailable={desktopBrowserAvailable}
          faviconColor={appearance.faviconColor}
          navigateToThreadAfterCreate={navigateToThreadAfterCreate}
          openLinksInAppBrowser={openLinksInAppBrowser}
          rewriteLocalhostLinks={rewriteLocalhostLinks}
          richTextEditing={richTextEditing}
          themePreference={themePreference}
          onAppearanceThemeChange={(themeId) =>
            updateAppearanceMutation.mutate({ themeId })
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
          onNavigateToThreadAfterCreateChange={setNavigateToThreadAfterCreate}
          onOpenLinksInAppBrowserChange={setOpenLinksInAppBrowser}
          onRewriteLocalhostLinksChange={setRewriteLocalhostLinks}
          onRichTextEditingChange={setRichTextEditing}
          onThemePreferenceChange={setPreferredTheme}
        />

        <UsageLimitsSettingsSection />

        <LocalOpenTargetSettingsSection
          directoryTargetId={directoryTargetId}
          fileTargetId={fileTargetId}
          hasDaemon={hasDaemon}
          onDirectoryTargetChange={setDirectoryTargetId}
          onFileTargetChange={setFileTargetId}
          targets={workspaceOpenTargets}
        />

        <ExperimentsSettingsSection
          claudeCodeMockCliTrafficEnabled={experiments.claudeCodeMockCliTraffic}
          desktopShellAvailable={desktopShellAvailable}
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
          onPopoutChatEnabledChange={(enabled) =>
            updateExperimentsMutation.mutate({
              ...experiments,
              popoutChat: enabled,
            })
          }
          onPopoutChatHotkeyChange={(hotkey) =>
            updateExperimentsMutation.mutate({
              ...experiments,
              popoutChatHotkey: hotkey,
            })
          }
          onUiForkingEnabledChange={(enabled) =>
            updateExperimentsMutation.mutate({
              ...experiments,
              uiForking: enabled,
            })
          }
          popoutChatEnabled={experiments.popoutChat}
          popoutChatHotkey={experiments.popoutChatHotkey}
          uiForkingEnabled={experiments.uiForking}
        />
      </div>
    </PageShell>
  );
}
