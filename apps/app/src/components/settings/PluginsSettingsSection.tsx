import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { appToast } from "@/components/ui/app-toast.js";
import { PluginSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Pill, type PillVariant } from "@bb/shared-ui/pill";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { Switch } from "@bb/shared-ui/switch";
import {
  applyPluginSettingsView,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginEnabled,
  updatePluginSettings,
  usePluginList,
  usePluginSettingsView,
  type PluginListItem,
  type PluginSettingFieldDescriptor,
} from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { usePreferredTheme } from "@/hooks/useTheme";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getSettingsPluginRoutePath } from "@/lib/route-paths";

/**
 * The Settings "Plugins" surfaces (plugin design §5.2 settingsSection):
 *
 * - PluginsSettingsSection: the management bucket — installed plugins with
 *   enable/disable switches. Install/remove stays on the bb CLI.
 * - PluginSettingsDetailSection: one plugin's settings page, rendering its
 *   declarative settings schema as a host-rendered form — no plugin code
 *   runs on this surface. Secrets are write-only: the server reports only
 *   `{ set }`, and an empty secret input means "leave unchanged".
 *
 * Both render a hint instead of content while the `plugins` experiment is
 * off (the settings nav only links here while it is on).
 */

const DROPDOWN_TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-44";
const DROPDOWN_CONTENT_CLASS =
  "min-w-[var(--radix-dropdown-menu-trigger-width)]";

const PLUGINS_EXPERIMENT_OFF_MESSAGE =
  "Plugins are off. Turn on the Plugins experiment in Settings → Experiments.";

function statusPillVariant(status: string): PillVariant {
  if (status === "running") return "secondary";
  if (status === "error" || status === "incompatible") return "destructive";
  return "outline";
}

interface SettingOptionPickerProps {
  ariaLabel: string;
  onSelect: (value: string) => void;
  options: readonly { label: string; value: string }[];
  valueLabel: string;
}

function SettingOptionPicker({
  ariaLabel,
  onSelect,
  options,
  valueLabel,
}: SettingOptionPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={DROPDOWN_TRIGGER_CLASS}
          aria-label={ariaLabel}
        >
          <span className="min-w-0 truncate">{valueLabel}</span>
          <Icon name="ChevronDown" className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={DROPDOWN_CONTENT_CLASS}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onSelect(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PluginSettingFieldProps {
  descriptor: PluginSettingFieldDescriptor;
  draft: unknown;
  onChange: (value: string | boolean) => void;
  settingKey: string;
  storedValue: unknown;
}

function PluginSettingField({
  descriptor,
  draft,
  onChange,
  settingKey,
  storedValue,
}: PluginSettingFieldProps) {
  const projects = useSidebarNavigation({
    enabled: descriptor.type === "project",
  });

  if (descriptor.type === "boolean") {
    const checked =
      typeof draft === "boolean"
        ? draft
        : typeof storedValue === "boolean"
          ? storedValue
          : false;
    return (
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={descriptor.label}
      />
    );
  }

  if (descriptor.type === "select") {
    const value =
      typeof draft === "string"
        ? draft
        : typeof storedValue === "string"
          ? storedValue
          : "";
    return (
      <SettingOptionPicker
        ariaLabel={descriptor.label}
        valueLabel={value.length > 0 ? value : "Select…"}
        options={descriptor.options.map((option) => ({
          label: option,
          value: option,
        }))}
        onSelect={onChange}
      />
    );
  }

  if (descriptor.type === "project") {
    const value =
      typeof draft === "string"
        ? draft
        : typeof storedValue === "string"
          ? storedValue
          : "";
    const navigation = projects.data;
    const options = navigation
      ? [
          {
            label: navigation.personalProject.name,
            value: navigation.personalProject.id,
          },
          ...navigation.projects.map((project) => ({
            label: project.name,
            value: project.id,
          })),
        ]
      : [];
    const valueLabel =
      options.find((option) => option.value === value)?.label ??
      (value.length > 0 ? value : "Select a project…");
    return (
      <SettingOptionPicker
        ariaLabel={descriptor.label}
        valueLabel={valueLabel}
        options={options}
        onSelect={onChange}
      />
    );
  }

  // type === "string" (including secrets).
  const isSecret = descriptor.secret === true;
  const secretIsSet =
    isSecret &&
    typeof storedValue === "object" &&
    storedValue !== null &&
    (storedValue as { set?: unknown }).set === true;
  const value =
    typeof draft === "string"
      ? draft
      : !isSecret && typeof storedValue === "string"
        ? storedValue
        : "";
  return (
    <Input
      type={isSecret ? "password" : "text"}
      value={value}
      aria-label={descriptor.label}
      placeholder={isSecret ? (secretIsSet ? "[set]" : "[not set]") : undefined}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 w-full text-xs sm:w-64"
    />
  );
}

/** Exported for tests (rendered on a plugin's settings page). */
export function PluginSettingsForm({ pluginId }: { pluginId: string }) {
  const queryClient = useQueryClient();
  const viewQuery = usePluginSettingsView(pluginId, { enabled: true });
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      updatePluginSettings(fetch, pluginId, values),
    onSuccess: (view) => {
      applyPluginSettingsView({ queryClient, pluginId, view });
      setDrafts({});
      appToast.success("Plugin settings saved");
    },
    onError: (error) => {
      appToast.error("Saving plugin settings failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const view = viewQuery.data ?? null;
  if (view === null || Object.keys(view.schema).length === 0) return null;

  // Secrets are write-only; an untouched or emptied secret input means
  // "leave unchanged", so it never rides the update payload.
  const changedValues: Record<string, unknown> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const descriptor = view.schema[key];
    if (descriptor === undefined) continue;
    const isSecret = descriptor.type === "string" && descriptor.secret === true;
    if (isSecret && draft === "") continue;
    if (!isSecret && draft === view.values[key]) continue;
    changedValues[key] = draft;
  }
  const hasChanges = Object.keys(changedValues).length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (hasChanges) save.mutate(changedValues);
      }}
    >
      {Object.entries(view.schema).map(([key, descriptor]) => (
        <SettingsWithControl
          key={key}
          label={descriptor.label}
          labelBadge={
            descriptor.type === "string" && descriptor.secret === true
              ? "secret"
              : undefined
          }
          {...(descriptor.description !== undefined
            ? { description: descriptor.description }
            : {})}
        >
          <PluginSettingField
            settingKey={key}
            descriptor={descriptor}
            storedValue={view.values[key]}
            draft={drafts[key]}
            onChange={(value) => {
              setDrafts((current) => ({ ...current, [key]: value }));
            }}
          />
        </SettingsWithControl>
      ))}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!hasChanges || save.isPending}
          aria-busy={save.isPending}
        >
          {save.isPending ? (
            <Icon name="Spinner" className="animate-spin" />
          ) : null}
          Save settings
        </Button>
      </div>
    </form>
  );
}

/**
 * Statuses whose factory ran, so a settings schema exists server-side. A
 * needs-configuration plugin MUST be configurable here — that status exists
 * precisely to send the user to this form — and degraded plugins are loaded
 * too. Errored/missing/incompatible plugins have no schema to render.
 */
const PLUGIN_STATUSES_WITH_SETTINGS = [
  "running",
  "needs-configuration",
  "degraded",
];

function PluginLogo({
  plugin,
  className,
}: {
  plugin: PluginListItem;
  className: string;
}) {
  const theme = usePreferredTheme();
  const logoUrl =
    theme === "dark" && plugin.logoDarkUrl !== null
      ? plugin.logoDarkUrl
      : plugin.logoUrl;
  if (logoUrl === null) return null;
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      data-testid={`plugin-settings-logo-${plugin.id}`}
      className={className}
    />
  );
}

/** Exported for tests (enable/disable round-trip). */
export function PluginToggleRow({ plugin }: { plugin: PluginListItem }) {
  const queryClient = useQueryClient();
  const { settingsSections } = usePluginSlots();
  const hasSettingsSections = settingsSections.some(
    (section) => section.pluginId === plugin.id,
  );
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setPluginEnabled(fetch, plugin.id, enabled),
    onError: (error, enabled) => {
      appToast.error(`${enabled ? "Enabling" : "Disabling"} ${plugin.id} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSettled: () => invalidatePluginList({ queryClient }),
  });
  // Reflect the in-flight target immediately; the invalidated list settles it.
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;

  return (
    <div
      className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
      data-testid={`plugin-row-${plugin.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <PluginLogo
            plugin={plugin}
            className="size-4 shrink-0 rounded-sm object-contain"
          />
          <span className="text-sm font-medium text-foreground">
            {plugin.id}
          </span>
          <span className="text-xs text-muted-foreground">
            v{plugin.version}
          </span>
          <Pill variant={statusPillVariant(plugin.status)} size="sm">
            {plugin.status}
          </Pill>
        </div>
        {plugin.description !== null && plugin.description.length > 0 ? (
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {plugin.description}
          </p>
        ) : null}
        {plugin.statusDetail !== null && plugin.statusDetail.length > 0 ? (
          <p className="mt-1 text-xs leading-snug text-subtle-foreground/75">
            {plugin.statusDetail}
          </p>
        ) : null}
        {plugin.enabled && (plugin.hasSettings || hasSettingsSections) ? (
          <Link
            to={getSettingsPluginRoutePath(plugin.id)}
            className="mt-1.5 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Plugin settings
            <Icon name="ChevronRight" className="size-3.5" />
          </Link>
        ) : null}
      </div>
      <Switch
        checked={enabled}
        disabled={toggle.isPending}
        onCheckedChange={(next) => toggle.mutate(next)}
        aria-label={`Enable ${plugin.id}`}
      />
    </div>
  );
}

/** The "Plugins" bucket: install state and enable/disable per plugin. */
export function PluginsSettingsSection() {
  const systemConfig = useSystemConfig();
  const pluginsEnabled = systemConfig.data?.experiments.plugins === true;
  const listQuery = usePluginList({ enabled: pluginsEnabled });
  const plugins = listQuery.data ?? [];
  return (
    <SettingsSection
      title="Plugins"
      description="Enable or disable installed BB plugins. Install or remove plugins with the bb CLI (bb plugin install / remove)."
    >
      {systemConfig.data === undefined ? null : !pluginsEnabled ? (
        <EmptyState message={PLUGINS_EXPERIMENT_OFF_MESSAGE} />
      ) : plugins.length === 0 ? (
        <EmptyState message='No plugins installed. Install one with "bb plugin install <source>".' />
      ) : (
        <div className="divide-y divide-border">
          {plugins.map((plugin) => (
            <PluginToggleRow key={plugin.id} plugin={plugin} />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

/** Exported for tests (status gating of the settings form). */
export function PluginSettingsDetail({ plugin }: { plugin: PluginListItem }) {
  const { settingsSections } = usePluginSlots();
  const hasSettingsSections = settingsSections.some(
    (section) => section.pluginId === plugin.id,
  );
  const settingsAvailable =
    plugin.enabled && PLUGIN_STATUSES_WITH_SETTINGS.includes(plugin.status);
  const showDeclarativeSettingsCard =
    plugin.hasSettings || !settingsAvailable || !hasSettingsSections;
  const displayName = plugin.displayName ?? plugin.id;
  const isRunning = plugin.status === "running";
  // A running plugin whose only surface is a settingsSection lets that
  // section own the chrome (its own SettingsSection title + description), so
  // the diagnostic header (version + status pill + manifest description)
  // doesn't stack a second heading above it. The diagnostic header stays for
  // every other case — it's what explains why a section is missing.
  const sectionOwnsHeader =
    isRunning && hasSettingsSections && !plugin.hasSettings;
  return (
    <div className="space-y-6" data-testid={`plugin-detail-${plugin.id}`}>
      {sectionOwnsHeader ? null : (
        <div className="space-y-3">
          <div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PluginLogo
                plugin={plugin}
                className="size-4 shrink-0 rounded-sm object-contain"
              />
              <h2 className="text-sm font-semibold text-foreground">
                {displayName}
              </h2>
              {/* The version + status pills read as diagnostics; a running,
                  configurable plugin doesn't need them on its settings page. */}
              {!isRunning ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    v{plugin.version}
                  </span>
                  <Pill variant={statusPillVariant(plugin.status)} size="sm">
                    {plugin.status}
                  </Pill>
                  {!plugin.enabled ? (
                    <Pill variant="outline" size="sm">
                      disabled
                    </Pill>
                  ) : null}
                </>
              ) : null}
            </div>
            {!isRunning &&
            plugin.description !== null &&
            plugin.description.length > 0 ? (
              <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                {plugin.description}
              </p>
            ) : null}
            {plugin.statusDetail !== null && plugin.statusDetail.length > 0 ? (
              <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                {plugin.statusDetail}
              </p>
            ) : null}
          </div>
          {showDeclarativeSettingsCard ? (
            <div className="rounded-lg border border-border bg-card px-4 py-3.5">
              {settingsAvailable ? (
                plugin.hasSettings ? (
                  <PluginSettingsForm pluginId={plugin.id} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This plugin declares no settings.
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  {plugin.enabled
                    ? `Settings are unavailable while the plugin is ${plugin.status}.`
                    : "Enable this plugin to edit its settings."}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
      {settingsAvailable ? (
        <PluginSettingsSections pluginId={plugin.id} />
      ) : null}
    </div>
  );
}

/** One plugin's settings page, looked up from the installed-plugin list. */
export function PluginSettingsDetailSection({
  pluginId,
}: {
  pluginId: string;
}) {
  const systemConfig = useSystemConfig();
  const pluginsEnabled = systemConfig.data?.experiments.plugins === true;
  const { settingsSections } = usePluginSlots();
  const hasSettingsSections = settingsSections.some(
    (section) => section.pluginId === pluginId,
  );
  const listQuery = usePluginList({
    enabled: pluginsEnabled || hasSettingsSections,
  });
  if (systemConfig.data === undefined) return null;
  if (!pluginsEnabled && !hasSettingsSections) {
    return <EmptyState message={PLUGINS_EXPERIMENT_OFF_MESSAGE} />;
  }
  const plugin = listQuery.data?.find((entry) => entry.id === pluginId);
  if (plugin === undefined) {
    return listQuery.data === undefined ? null : (
      <EmptyState message={`Plugin "${pluginId}" is not installed.`} />
    );
  }
  return <PluginSettingsDetail plugin={plugin} />;
}
