import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { appToast } from "@/components/ui/app-toast.js";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
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
import { cn } from "@bb/shared-ui/lib/utils";
import { SettingsWithControl } from "@/components/ui/settings-section.js";
import { Switch } from "@bb/shared-ui/switch";
import {
  applyPluginSettingsView,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  removePlugin,
  setPluginEnabled,
  updatePluginSettings,
  usePluginList,
  usePluginSettingsView,
  type PluginListItem,
  type PluginSettingFieldDescriptor,
} from "@/hooks/queries/plugin-settings-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  getPluginFrontendDiagnostics,
  subscribePluginFrontendDiagnostics,
} from "@/lib/plugin-frontend";
import { CREATE_PLUGIN_PROMPT } from "@/lib/create-resource-prompts";
import {
  getRootComposeRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "./plugins/BrowsePluginsTab";
import { InstalledPluginsTab } from "./plugins/InstalledPluginsTab";
import {
  PluginUpdateBanner,
  PluginUpdatesSourceCard,
} from "./plugins/PluginUpdatesCard";

/**
 * The Settings "Plugins" surfaces (plugin design §5.2 settingsSection; the
 * plugin management's three-layer disclosure model):
 *
 * - PluginsSettingsSection: management — Installed / Browse
 *   tabs plus the Add-plugin dialog. The installed list is Layer 1: quiet
 *   rows that answer "is anything asking for my attention?".
 * - PluginSettingsDetailSection: one plugin's page (Layer 2) — update
 *   banner, "Updates & source" card, and the host-rendered settings form.
 *   Secrets are write-only: the server reports only `{ set }`, and an empty
 *   secret input means "leave unchanged".
 */

const DROPDOWN_TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-44";
const DROPDOWN_CONTENT_CLASS =
  "min-w-[var(--radix-dropdown-menu-trigger-width)]";

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
        valueLabel={value.length > 0 ? value : "Select"}
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
      (value.length > 0 ? value : "Select a project");
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
        description: pluginAdminErrorMessage(error),
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

type PluginsTab = "installed" | "browse";

function PluginsTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
      {count !== undefined ? (
        <span className="text-2xs text-subtle-foreground">{count}</span>
      ) : null}
    </button>
  );
}

/** The "Plugins" bucket: Installed / Browse (Layer 1). */
export function PluginsSettingsSection() {
  const navigate = useNavigate();
  const listQuery = usePluginList({ enabled: true });
  const plugins = listQuery.data?.plugins ?? [];
  const [tab, setTab] = useState<PluginsTab>("installed");
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });

  const startCreatePlugin = () =>
    navigate(getRootComposeRoutePath(), {
      state: { initialPrompt: CREATE_PLUGIN_PROMPT, focusPrompt: true },
    });

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Plugins</h2>
        <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
          Customize bb to your liking with plugins.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="tablist">
          <PluginsTabButton
            label="Installed"
            count={plugins.length}
            active={tab === "installed"}
            onClick={() => setTab("installed")}
          />
          <PluginsTabButton
            label="Browse"
            active={tab === "browse"}
            onClick={() => setTab("browse")}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-muted-foreground"
            onClick={startCreatePlugin}
          >
            <Icon name="Code" className="size-3.5" />
            Create a plugin
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setAddDialog({ open: true, initial: null })}
          >
            <Icon name="Plus" className="size-3.5" />
            Add plugin
          </Button>
        </div>
      </div>
      {tab === "installed" ? (
        <InstalledPluginsTab plugins={plugins} />
      ) : (
        <BrowsePluginsTab
          onInstall={(initial) => setAddDialog({ open: true, initial })}
        />
      )}
      <AddPluginDialog
        open={addDialog.open}
        initial={addDialog.initial}
        onOpenChange={(open) =>
          setAddDialog((current) => ({ ...current, open }))
        }
      />
    </section>
  );
}

/**
 * Uninstall control on a plugin's detail page. Orphaned builtins can be
 * cleaned up by recording a tombstone while leaving any bundled files alone.
 * A path source likewise keeps its local files; managed (git/npm) sources
 * have their downloaded files deleted.
 */
function RemovePluginSection({ plugin }: { plugin: PluginListItem }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isBuiltin = plugin.provenance === "builtin";
  const isPathSource = plugin.sourceDisplay.toLowerCase().startsWith("path");
  const name = plugin.name ?? plugin.id;
  const remove = useMutation({
    mutationFn: () => removePlugin(fetch, plugin.id),
    onSuccess: () => {
      invalidatePluginList({ queryClient });
      appToast.success(`Removed ${name}`);
      navigate(getSettingsRoutePath("plugins"));
    },
    onError: (error) => {
      appToast.error(`Removing ${name} failed`, {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Remove plugin</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isBuiltin
            ? "Removes the plugin from BB. Its bundled files are left in place."
            : isPathSource
              ? "Uninstalls the plugin. Its local source files are left in place."
              : "Uninstalls the plugin and deletes its downloaded files."}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2.5 text-xs text-destructive-text"
        onClick={() => setConfirmOpen(true)}
      >
        Remove
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {name}?</DialogTitle>
            <DialogDescription>
              {isBuiltin
                ? "This removes the plugin and its stored settings. BB remembers the removal so the plugin stays hidden after restart; its bundled files remain in place."
                : isPathSource
                  ? "This uninstalls the plugin and removes its stored settings. Its local source files stay on disk, so you can reinstall it."
                  : "This uninstalls the plugin, deletes its downloaded files, and removes its stored settings."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              aria-busy={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? (
                <Icon name="Spinner" className="animate-spin" />
              ) : null}
              Remove plugin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Exported for tests (status gating of the settings form). */
export function PluginSettingsDetail({ plugin }: { plugin: PluginListItem }) {
  const queryClient = useQueryClient();
  const { settingsSections } = usePluginSlots();
  const name = plugin.name ?? plugin.id;
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setPluginEnabled(fetch, plugin.id, enabled),
    onError: (error, enabled) => {
      appToast.error(`${enabled ? "Enabling" : "Disabling"} ${name} failed`, {
        description: pluginAdminErrorMessage(error),
      });
    },
    onSettled: () => invalidatePluginList({ queryClient }),
  });
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;
  const hasSettingsSections = settingsSections.some(
    (section) => section.pluginId === plugin.id,
  );
  const settingsContentVisible = enabled && plugin.enabled;
  const pluginSurfacesAvailable =
    settingsContentVisible &&
    PLUGIN_STATUSES_WITH_SETTINGS.includes(plugin.status);
  const frontendDiagnostics = useSyncExternalStore(
    subscribePluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
  );
  const frontendDiagnostic = frontendDiagnostics.get(plugin.id);
  const frontendFailure = frontendDiagnostic?.lastFailure;
  const frontendSettingsPending =
    plugin.status === "running" &&
    plugin.app.bundle !== null &&
    frontendDiagnostic === undefined;
  const provenanceLine =
    plugin.provenance === "catalog"
      ? "official catalog"
      : plugin.provenance === "direct"
        ? "direct install"
        : null;
  const lifecycleControl = (
    <Switch
      checked={enabled}
      disabled={toggle.isPending}
      aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
      onCheckedChange={(next) => toggle.mutate(next)}
    />
  );
  return (
    <div className="space-y-6" data-testid={`plugin-detail-${plugin.id}`}>
      <div className="space-y-3">
        <div>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PluginIcon pluginId={plugin.id} icon={plugin.icon} />
              <h2 className="text-sm font-semibold text-foreground">{name}</h2>
              <span className="text-xs text-muted-foreground">
                v{plugin.version}
              </span>
              {plugin.status === "running" ? null : (
                <Pill variant={statusPillVariant(plugin.status)} size="sm">
                  {plugin.status}
                </Pill>
              )}
            </div>
            {lifecycleControl}
          </div>
          {provenanceLine !== null ? (
            <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
              {provenanceLine}
            </p>
          ) : null}
          {plugin.description !== null && plugin.description.length > 0 ? (
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
        {settingsContentVisible ? (
          <>
            {frontendFailure !== null && frontendFailure !== undefined ? (
              <div
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
                role="alert"
              >
                Frontend {frontendFailure.phase} failure
                {frontendFailure.scriptId === null
                  ? ""
                  : ` in content script “${frontendFailure.scriptId}”`}
                : {frontendFailure.message}
              </div>
            ) : null}
            <PluginUpdateBanner plugin={plugin} />
            <PluginUpdatesSourceCard plugin={plugin} />
            {!pluginSurfacesAvailable ? (
              <div className="rounded-lg border border-border bg-card px-4 py-3.5">
                <p className="text-xs text-muted-foreground">
                  Settings are unavailable while the plugin is {plugin.status}.
                </p>
              </div>
            ) : plugin.hasSettings ? (
              <div className="rounded-lg border border-border bg-card px-4 py-3.5">
                <PluginSettingsForm pluginId={plugin.id} />
              </div>
            ) : frontendFailure !== null && frontendFailure !== undefined ? (
              <div className="rounded-lg border border-border bg-card px-4 py-3.5">
                <p className="text-xs text-muted-foreground">
                  Plugin settings are unavailable because its frontend did not
                  load.
                </p>
              </div>
            ) : !hasSettingsSections && !frontendSettingsPending ? (
              <div className="rounded-lg border border-border bg-card px-4 py-3.5">
                <p className="text-xs text-muted-foreground">
                  This plugin declares no settings.
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {pluginSurfacesAvailable ? (
        <PluginSettingsSections pluginId={plugin.id} />
      ) : null}
      {plugin.provenance !== "builtin" || plugin.isOrphanedBuiltin ? (
        <RemovePluginSection plugin={plugin} />
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
  const listQuery = usePluginList({ enabled: true });
  const plugin = listQuery.data?.plugins.find((entry) => entry.id === pluginId);
  if (plugin === undefined) {
    return listQuery.data === undefined ? null : (
      <EmptyState message={`Plugin "${pluginId}" is not installed.`} />
    );
  }
  return <PluginSettingsDetail plugin={plugin} />;
}
