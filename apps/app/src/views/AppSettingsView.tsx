import { useMemo, useState } from "react";
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
import { useWorkspaceOpenTargets } from "@/hooks/useWorkspaceOpenTargets";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import {
  FAVICON_COLOR_VALUES,
  useFaviconColorPreference,
  type FaviconColorPreference,
} from "@/lib/favicon-color-preference";
import { useOpenLinksInAppBrowserPreference } from "@/lib/in-app-browser-link-preference";
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

export interface InAppBrowserLinkSettingsSectionProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
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

function FaviconColorSwatch({ value }: { value: FaviconColorPreference }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 rounded-full",
        value === "default" && "bg-foreground",
      )}
      style={
        value === "default"
          ? undefined
          : { backgroundColor: FAVICON_COLOR_VALUES[value] }
      }
    />
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
    <SettingsSection title="Open File Preferences">
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

export function InAppBrowserLinkSettingsSection({
  enabled,
  onEnabledChange,
}: InAppBrowserLinkSettingsSectionProps) {
  return (
    <SettingsSection title="Browser">
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
    </SettingsSection>
  );
}

export function AppSettingsView() {
  const themePreference = useThemePreference();
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
  // The in-app browser only exists on desktop; hide the toggle entirely on web,
  // where it would have no effect.
  const [desktopBrowserAvailable] = useState(isDesktopBrowserAvailable);

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <SettingsSection title="Appearance">
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
                      onSelect={() => setPreferredTheme(option.value)}
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
                      <FaviconColorSwatch value={faviconColor} />
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
                      onSelect={() => setFaviconColor(option.value)}
                    >
                      <FaviconColorSwatch value={option.value} />
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
          </div>
        </SettingsSection>

        <LocalOpenTargetSettingsSection
          directoryTargetId={directoryTargetId}
          fileTargetId={fileTargetId}
          hasDaemon={hasDaemon}
          onDirectoryTargetChange={setDirectoryTargetId}
          onFileTargetChange={setFileTargetId}
          targets={workspaceOpenTargets}
        />

        {desktopBrowserAvailable ? (
          <InAppBrowserLinkSettingsSection
            enabled={openLinksInAppBrowser}
            onEnabledChange={setOpenLinksInAppBrowser}
          />
        ) : null}

        <AppSourcesSection />
      </div>
    </PageShell>
  );
}
