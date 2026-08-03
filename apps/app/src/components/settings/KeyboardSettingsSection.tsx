import { useMemo, useState, type KeyboardEvent } from "react";
import {
  defaultAppSettings,
  type AppCommandId,
  type AppKeybindingOverrides,
  type AppKeybindings,
  type AppShortcut,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Switch } from "@bb/shared-ui/switch";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  APP_COMMAND_GROUPS,
  getAppCommandMetadata,
} from "@/lib/app-command-metadata";
import {
  areAppShortcutsEqual,
  appShortcutFromInput,
  canAssignAppShortcut,
  getCommandShortcut,
  getShortcutConflicts,
  setCommandShortcutOverride,
} from "@/lib/keyboard-shortcut-settings";
import {
  formatAppShortcut,
  formatAppShortcutAria,
  type AppShortcutPresentation,
} from "@/lib/app-keybindings";
import {
  useUpdateGeneralSettings,
  useUpdateKeyboardSettings,
} from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  SettingsBadge,
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";

const EMPTY_KEYBINDINGS: AppKeybindings = [];
const EMPTY_OVERRIDES: AppKeybindingOverrides = [];

function browserPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

function presentShortcut(
  shortcut: AppShortcut,
  platform: string,
): AppShortcutPresentation {
  return {
    ariaKeyshortcuts: formatAppShortcutAria(shortcut, platform),
    label: formatAppShortcut(shortcut, platform),
  };
}

interface ShortcutRecorderProps {
  command: AppCommandId;
  disabled: boolean;
  onChange(shortcut: AppShortcut): void;
  onRecordingChange(command: AppCommandId | null): void;
  recording: boolean;
  shortcut: AppShortcut | null;
}

function ShortcutRecorder({
  command,
  disabled,
  onChange,
  onRecordingChange,
  recording,
  shortcut,
}: ShortcutRecorderProps) {
  const platform = browserPlatform();
  const [error, setError] = useState<string | null>(null);
  const shortcutPresentation =
    shortcut === null ? null : presentShortcut(shortcut, platform);
  const formattedShortcut = shortcutPresentation?.label ?? "unassigned";

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setError(null);
      onRecordingChange(null);
      return;
    }
    const next = appShortcutFromInput(event, platform);
    if (next === null) {
      setError("Press a non-modifier key.");
      return;
    }
    if (!canAssignAppShortcut(command, next)) {
      setError("Use Command, Control, or Alt with a key.");
      return;
    }
    setError(null);
    onChange(next);
    onRecordingChange(null);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        aria-label={
          recording
            ? `Recording shortcut for ${getAppCommandMetadata(command).label}. Press keys or Escape to cancel.`
            : `Record shortcut for ${getAppCommandMetadata(command).label}, current shortcut ${formattedShortcut}`
        }
        aria-pressed={recording}
        className={cn(
          "h-7 min-w-24 px-2 text-xs",
          recording && "border-ring text-foreground",
        )}
        disabled={disabled}
        onBlur={() => {
          setError(null);
          onRecordingChange(null);
        }}
        onClick={() => {
          if (recording) return;
          setError(null);
          onRecordingChange(command);
        }}
        onKeyDown={handleKeyDown}
        size="sm"
        type="button"
        variant="outline"
      >
        {recording ? (
          "Press keys"
        ) : shortcutPresentation === null ? (
          "Unassigned"
        ) : (
          <AppCommandShortcutPill shortcut={shortcutPresentation} />
        )}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface KeyboardCommandRowProps {
  command: AppCommandId;
  defaults: AppKeybindings;
  disabled: boolean;
  onChange(command: AppCommandId, shortcut: AppShortcut | null): void;
  onRecordingChange(command: AppCommandId | null): void;
  overrides: AppKeybindingOverrides;
  recordingCommand: AppCommandId | null;
}

function KeyboardCommandRow({
  command,
  defaults,
  disabled,
  onChange,
  onRecordingChange,
  overrides,
  recordingCommand,
}: KeyboardCommandRowProps) {
  const platform = browserPlatform();
  const metadata = getAppCommandMetadata(command);
  const shortcut = getCommandShortcut(defaults, overrides, command);
  const customized = overrides.some((override) => override.command === command);
  const commandBindings = defaults.filter(
    (binding) => binding.command === command,
  );
  const defaultShortcutBindings = commandBindings.filter(
    (binding, index) =>
      commandBindings.findIndex(
        (candidate) =>
          candidate.desktopOnly === binding.desktopOnly &&
          areAppShortcutsEqual(candidate.shortcut, binding.shortcut),
      ) === index,
  );
  const desktopOnly =
    commandBindings.length > 0 &&
    commandBindings.every((binding) => binding.desktopOnly);
  const conflicts = customized
    ? getShortcutConflicts(defaults, overrides, command)
    : [];

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm text-foreground">{metadata.label}</p>
          {desktopOnly ? <SettingsBadge>Desktop</SettingsBadge> : null}
          {customized ? <SettingsBadge>Custom</SettingsBadge> : null}
        </div>
        <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
          {metadata.description}
        </p>
        {defaultShortcutBindings.length > 1 ? (
          <div
            aria-label={`Default shortcuts for ${metadata.label}`}
            className="mt-1.5 flex flex-wrap items-center gap-1.5"
          >
            <span className="text-xs text-subtle-foreground/75">Defaults:</span>
            {defaultShortcutBindings.map((binding, index) => {
              const presentation = presentShortcut(binding.shortcut, platform);
              return (
                <span
                  className="inline-flex items-center gap-1"
                  key={`${binding.shortcut.key}:${index}`}
                >
                  <AppCommandShortcutPill
                    ariaHidden={false}
                    shortcut={presentation}
                  />
                  <SettingsBadge>
                    {binding.desktopOnly ? "Desktop" : "Web"}
                  </SettingsBadge>
                </span>
              );
            })}
          </div>
        ) : null}
        {conflicts.length > 0 ? (
          <p className="mt-1 text-xs text-warning-text">
            Also used by{" "}
            {conflicts
              .map((candidate) => getAppCommandMetadata(candidate).label)
              .join(", ")}
            . Context determines which command runs.
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-start justify-end gap-1">
        <ShortcutRecorder
          command={command}
          disabled={disabled}
          onChange={(next) => onChange(command, next)}
          onRecordingChange={onRecordingChange}
          recording={recordingCommand === command}
          shortcut={shortcut}
        />
        <Button
          aria-label={`Clear shortcut for ${metadata.label}`}
          className="size-7"
          disabled={disabled || shortcut === null}
          onClick={() => onChange(command, null)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon name="X" className="size-3.5" />
        </Button>
        <Button
          aria-label={`Reset shortcut for ${metadata.label}`}
          className="size-7"
          disabled={disabled || !customized}
          onClick={() => {
            const defaultShortcut = getCommandShortcut(defaults, [], command);
            if (defaultShortcut !== null) onChange(command, defaultShortcut);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon name="RotateCcw" className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function KeyboardSettingsSection() {
  const systemConfig = useSystemConfig();
  const updateGeneralSettings = useUpdateGeneralSettings();
  const updateKeyboardSettings = useUpdateKeyboardSettings();
  const generalSettings =
    systemConfig.data?.generalSettings ?? defaultAppSettings;
  const defaults = systemConfig.data?.defaultKeybindings ?? EMPTY_KEYBINDINGS;
  const serverOverrides =
    systemConfig.data?.keybindingOverrides ?? EMPTY_OVERRIDES;
  const serverOverridesKey = JSON.stringify(serverOverrides);
  const [draft, setDraft] = useState<{
    sourceKey: string;
    value: AppKeybindingOverrides;
  }>(() => ({ sourceKey: serverOverridesKey, value: serverOverrides }));
  const overrides =
    draft.sourceKey === serverOverridesKey ? draft.value : serverOverrides;
  const [recordingCommand, setRecordingCommand] = useState<AppCommandId | null>(
    null,
  );
  const [search, setSearch] = useState("");

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length === 0) return APP_COMMAND_GROUPS;
    return APP_COMMAND_GROUPS.flatMap((group) => {
      const commands = group.commands.filter(
        (metadata) =>
          metadata.label.toLowerCase().includes(query) ||
          metadata.description.toLowerCase().includes(query) ||
          metadata.command.toLowerCase().includes(query),
      );
      return commands.length === 0 ? [] : [{ ...group, commands }];
    });
  }, [search]);

  function updateCommand(command: AppCommandId, shortcut: AppShortcut | null) {
    const previous = overrides;
    const next = setCommandShortcutOverride(
      defaults,
      overrides,
      command,
      shortcut,
    );
    setDraft({ sourceKey: serverOverridesKey, value: next });
    updateKeyboardSettings.mutate(next, {
      onError: () =>
        setDraft({ sourceKey: serverOverridesKey, value: previous }),
    });
  }

  const disabled =
    systemConfig.data === undefined || updateKeyboardSettings.isPending;
  const hasOverrides = overrides.length > 0;

  return (
    <SettingsSection
      action={
        <Button
          disabled={disabled || !hasOverrides}
          onClick={() => {
            const previous = overrides;
            setDraft({ sourceKey: serverOverridesKey, value: [] });
            updateKeyboardSettings.mutate([], {
              onError: () =>
                setDraft({ sourceKey: serverOverridesKey, value: previous }),
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Reset all
        </Button>
      }
      description="Click a shortcut, then press its new keys. Changes sync to every bb window."
      title="Keyboard shortcuts"
    >
      <div className="space-y-5">
        <SettingsWithControl
          description="Show shortcut badges after holding Command or Control."
          label="Show keyboard hints when holding CMD / Control"
        >
          <Switch
            aria-label="Show keyboard hints when holding CMD / Control"
            checked={generalSettings.showKeyboardHints}
            disabled={
              systemConfig.data === undefined || updateGeneralSettings.isPending
            }
            onCheckedChange={(showKeyboardHints) =>
              updateGeneralSettings.mutate({
                ...generalSettings,
                showKeyboardHints,
              })
            }
          />
        </SettingsWithControl>
        <Input
          aria-label="Search keyboard shortcuts"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search shortcuts"
          value={search}
        />
        {visibleGroups.map((group) => (
          <section key={group.label}>
            <h3 className="mb-2 text-xs font-medium text-subtle-foreground">
              {group.label}
            </h3>
            <div className="divide-y divide-border">
              {group.commands.map((metadata) => (
                <KeyboardCommandRow
                  command={metadata.command}
                  defaults={defaults}
                  disabled={disabled}
                  key={metadata.command}
                  onChange={updateCommand}
                  onRecordingChange={setRecordingCommand}
                  overrides={overrides}
                  recordingCommand={recordingCommand}
                />
              ))}
            </div>
          </section>
        ))}
        {visibleGroups.length === 0 ? (
          <p className="py-6 text-center text-sm text-subtle-foreground">
            No shortcuts match “{search}”.
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
