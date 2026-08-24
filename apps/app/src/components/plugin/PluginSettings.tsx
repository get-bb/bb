import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { appToast } from "@/components/ui/app-toast.js";
import { PluginSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { Link } from "react-router-dom";
import { SettingsWithControl } from "@/components/ui/settings-section.js";
import { getPluginDetailRoutePath } from "@/lib/route-paths";
import { Switch } from "@bb/shared-ui/switch";
import {
  ResourceDetailConfigurationSection,
  ResourceDetailOverviewSection,
  ResourceDetailPanel,
  ResourceDetailStack,
} from "@bb/shared-ui/resource-detail";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { applyPluginSettingsView } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  updatePluginSettings,
  usePluginList,
  usePluginSettingsView,
  type PluginListItem,
  type PluginSettingFieldDescriptor,
} from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { usePluginSlots } from "@/lib/plugin-slots";

/**
 * Plugin configuration rendered inside the canonical Plugins detail surface.
 * Declarative settings remain host-rendered, while `settingsSection` slots
 * can provide richer plugin-owned controls. Secrets are write-only: the
 * server reports only `{ set }`, and an empty secret input leaves it unchanged.
 * A string marked `experimental_multiline` is a monospace textarea below its
 * label at full width; every other control sits beside its label.
 */

const DROPDOWN_TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-44";
const DROPDOWN_CONTENT_CLASS =
  "min-w-[var(--radix-dropdown-menu-trigger-width)]";

/**
 * A multi-line field sizes itself to its content between six and twenty-four
 * rows where `field-sizing: content` is supported (the min/max heights), and
 * falls back to a `rows` count derived from the value elsewhere: one row per
 * line plus one to type into, within the same bounds.
 */
const MULTILINE_MIN_ROWS = 6;
const MULTILINE_MAX_ROWS = 24;
const MULTILINE_TEXTAREA_CLASS =
  "max-h-96 min-h-32 w-full resize-y overflow-y-auto font-mono text-xs field-sizing-content";

function multilineRows(value: string): number {
  const lines = value.split("\n").length;
  return Math.min(MULTILINE_MAX_ROWS, Math.max(MULTILINE_MIN_ROWS, lines + 1));
}

function isMultilineSetting(descriptor: PluginSettingFieldDescriptor): boolean {
  return (
    descriptor.type === "string" &&
    descriptor.experimental_multiline === true &&
    descriptor.secret !== true
  );
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
  storedValue: unknown;
}

function PluginSettingField({
  descriptor,
  draft,
  onChange,
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
  if (isMultilineSetting(descriptor)) {
    return (
      <Textarea
        value={value}
        aria-label={descriptor.label}
        rows={multilineRows(value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => onChange(event.target.value)}
        className={MULTILINE_TEXTAREA_CLASS}
      />
    );
  }
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

/** Host-rendered declarative settings form for a plugin detail page. */
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
          controlPlacement={isMultilineSetting(descriptor) ? "below" : "inline"}
          {...(descriptor.description !== undefined
            ? { description: descriptor.description }
            : {})}
        >
          <PluginSettingField
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

/**
 * The Settings-page home for one plugin's configuration. The Extensions
 * detail page links here rather than hosting the form itself.
 */
export function PluginSettingsPage({ pluginId }: { pluginId: string }) {
  const listQuery = usePluginList({ enabled: true });
  const plugin =
    listQuery.data?.plugins.find(
      (entry: PluginListItem) => entry.id === pluginId,
    ) ?? null;
  if (listQuery.isFetching && listQuery.data === undefined) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading plugin settings…
      </p>
    );
  }
  if (plugin === null) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        This plugin is not installed.
      </p>
    );
  }
  // Mirrors the Extensions detail page: the same header anatomy and section
  // stack, with a "Plugin details" section that is the counterpart of the
  // detail page's Configuration section (each one sentence linking across).
  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="size-9 shrink-0">
          <PluginIcon
            pluginId={plugin.id}
            icon={plugin.icon}
            className="size-full"
          />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-foreground">
            {plugin.name ?? plugin.id}
          </h1>
          {plugin.description ? (
            <p className="truncate text-xs text-subtle-foreground">
              {plugin.description}
            </p>
          ) : null}
        </div>
      </div>
      <ResourceDetailStack className="mt-6">
        <ResourceDetailConfigurationSection label="Configuration">
          <PluginSettingsDetail plugin={plugin} />
        </ResourceDetailConfigurationSection>
        <ResourceDetailOverviewSection label="Plugin details">
          <p className="max-w-none text-sm leading-relaxed text-muted-foreground">
            Release, capabilities, and health live on{" "}
            <Link
              to={getPluginDetailRoutePath({
                pluginId,
                view: "installed",
              })}
              className="inline-flex items-center gap-0.5 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              its plugin page
              <Icon
                name="ChevronRight"
                className="size-3.5 no-underline"
                aria-hidden
              />
            </Link>
          </p>
        </ResourceDetailOverviewSection>
      </ResourceDetailStack>
    </div>
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
  if (!plugin.hasSettings && !hasSettingsSections) return null;

  return (
    <div className="space-y-6" data-testid={`plugin-detail-${plugin.id}`}>
      {plugin.hasSettings || !settingsAvailable ? (
        <ResourceDetailPanel surface="recessed" className="px-3 py-3">
          {settingsAvailable ? (
            <PluginSettingsForm key={plugin.id} pluginId={plugin.id} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {plugin.enabled
                ? `Settings are unavailable while the plugin is ${plugin.status}.`
                : "Enable this plugin to edit its settings."}
            </p>
          )}
        </ResourceDetailPanel>
      ) : null}
      {settingsAvailable ? (
        <PluginSettingsSections pluginId={plugin.id} />
      ) : null}
    </div>
  );
}
