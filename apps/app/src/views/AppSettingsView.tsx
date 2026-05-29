import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { timeAgo } from "@bb/core-ui";
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
import { CONNECTED_DOT_CLASS } from "@/components/settings/constants";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { WorkspaceOpenTargetIcon } from "@/components/workspace-open-target/WorkspaceOpenTargetIcon";
import {
  HostDeleteDialog,
  type HostDeleteDialogTarget,
} from "@/components/dialogs/HostDeleteDialog";
import {
  HostRenameDialog,
  type HostRenameDialogTarget,
} from "@/components/dialogs/HostRenameDialog";
import { HostJoinAppUrlRequiredDialog } from "@/components/dialogs/HostJoinAppUrlRequiredDialog";
import { HostJoinDialog } from "@/components/dialogs/HostJoinDialog";
import {
  setPreferredTheme,
  useThemePreference,
  type ThemePreference,
} from "@/hooks/useTheme";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useEffectiveHosts } from "@/hooks/queries/effective-hosts";
import { useWorkspaceOpenTargets } from "@/hooks/useWorkspaceOpenTargets";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { useOpenLinksInAppBrowserPreference } from "@/lib/in-app-browser-link-preference";
import {
  invalidateHostDeleteDependentQueries,
  invalidateHostAvailabilityQueries,
} from "@/hooks/cache-effects";
import * as api from "@/lib/api";
import { HttpError } from "@/lib/api";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import type { CreateHostJoinResponse } from "@bb/server-contract";
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

interface RenameHostMutationRequest {
  id: string;
  name: string;
}

interface DeleteHostMutationRequest {
  id: string;
}

interface CancelHostJoinMutationRequest {
  id: string;
}

interface ThemePreferenceOption {
  label: string;
  value: ThemePreference;
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
  const { data: hosts = [], isLoading: hostsLoading } = useEffectiveHosts();
  const queryClient = useQueryClient();

  const [renameTarget, setRenameTarget] =
    useState<HostRenameDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<HostDeleteDialogTarget | null>(null);
  const [joinTarget, setJoinTarget] = useState<CreateHostJoinResponse | null>(
    null,
  );
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [appUrlRequiredOpen, setAppUrlRequiredOpen] = useState(false);

  const renameHost = useMutation({
    meta: {
      errorMessage: "Failed to rename host.",
    },
    mutationFn: ({ id, name }: RenameHostMutationRequest) =>
      api.updateHost(id, { name }),
    onSuccess: () => {
      invalidateHostAvailabilityQueries({ queryClient });
      setRenameTarget(null);
    },
  });

  const deleteHost = useMutation({
    meta: {
      errorMessage: "Failed to remove host.",
    },
    mutationFn: ({ id }: DeleteHostMutationRequest) => api.deleteHost(id),
    onSuccess: () => {
      invalidateHostDeleteDependentQueries({ queryClient });
      setDeleteTarget(null);
    },
  });

  const createHostJoin = useMutation({
    meta: {
      errorMessage: "Failed to create host join command",
      showErrorToast: false,
    },
    mutationFn: () => api.createHostJoin(),
    onSuccess: (result) => {
      invalidateHostAvailabilityQueries({ queryClient });
      setJoinTarget(result);
      setJoinDialogOpen(true);
    },
    onError: (error) => {
      if (error instanceof HttpError && error.code === "app_url_required") {
        setAppUrlRequiredOpen(true);
        return;
      }
      showMutationErrorToast({
        error,
        fallbackMessage: "Failed to create host join command",
      });
    },
  });

  const cancelHostJoin = useMutation({
    meta: {
      errorMessage: "Failed to cancel host join.",
    },
    mutationFn: ({ id }: CancelHostJoinMutationRequest) =>
      api.cancelHostJoin(id),
    onSuccess: (_, request) => {
      invalidateHostAvailabilityQueries({ queryClient });
      setJoinTarget((current) =>
        current?.hostId === request.id ? null : current,
      );
      setJoinDialogOpen(false);
    },
  });

  const joinHost =
    joinTarget !== null
      ? (hosts.find((host) => host.id === joinTarget.hostId) ?? null)
      : null;
  const hostJoinActionPending =
    createHostJoin.isPending || cancelHostJoin.isPending;

  async function handleCreateHostJoin() {
    if (
      joinTarget !== null &&
      joinTarget.expiresAt > Date.now() &&
      joinHost?.status !== "connected"
    ) {
      setJoinDialogOpen(true);
      return;
    }

    if (joinTarget !== null && joinHost?.status !== "connected") {
      try {
        await cancelHostJoin.mutateAsync({ id: joinTarget.hostId });
      } catch {
        return;
      }
    }

    createHostJoin.mutate();
  }

  useEffect(() => {
    if (!joinDialogOpen || joinHost?.status !== "connected") {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setJoinTarget(null);
      setJoinDialogOpen(false);
    }, 1_500);
    return () => window.clearTimeout(timeoutId);
  }, [joinDialogOpen, joinHost?.status]);

  function handleJoinOpenChange(open: boolean) {
    if (open) {
      setJoinDialogOpen(true);
      return;
    }
    if (joinTarget !== null && joinHost?.status !== "connected") {
      cancelHostJoin.mutate({ id: joinTarget.hostId });
    }
    setJoinTarget(null);
    setJoinDialogOpen(false);
  }

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <SettingsSection title="Appearance">
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

        <div className="space-y-2">
          <SettingsSection title="Hosts">
            {hostsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <SettingsRowList>
                {hosts.length === 0 ? (
                  <SettingsRow>
                    <span className="text-sm text-muted-foreground">
                      No registered hosts.
                    </span>
                  </SettingsRow>
                ) : (
                  hosts.map((host) => {
                    const isConnected = host.status === "connected";
                    return (
                      <SettingsRow key={host.id}>
                        <span className="min-w-0 flex-1 truncate">
                          {host.name}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {host.id}
                          </span>
                        </span>
                        {isConnected ? (
                          <span
                            className={CONNECTED_DOT_CLASS}
                            title="Connected"
                          />
                        ) : host.lastSeenAt !== null ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Offline · {timeAgo(host.lastSeenAt)}
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Never connected
                          </span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              aria-label="Host actions"
                            >
                              <Icon name="MoreHorizontal" className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                              onSelect={() =>
                                setRenameTarget({
                                  id: host.id,
                                  currentName: host.name,
                                })
                              }
                            >
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() =>
                                setDeleteTarget({
                                  id: host.id,
                                  name: host.name,
                                })
                              }
                            >
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SettingsRow>
                    );
                  })
                )}
              </SettingsRowList>
            )}
          </SettingsSection>
          {!hostsLoading ? (
            <div className="flex justify-start">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-auto justify-start gap-1.5 px-2 py-1 text-muted-foreground"
                disabled={hostJoinActionPending}
                onClick={() => {
                  void handleCreateHostJoin();
                }}
              >
                <Icon name="Plus" className="size-3.5" />
                Add another host
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <HostRenameDialog
        target={renameTarget}
        pending={renameHost.isPending}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onRename={(id, name) => renameHost.mutate({ id, name })}
      />
      <HostDeleteDialog
        target={deleteTarget}
        pending={deleteHost.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDelete={(id) => deleteHost.mutate({ id })}
      />
      <HostJoinDialog
        open={joinDialogOpen}
        target={joinTarget}
        host={joinHost}
        onOpenChange={handleJoinOpenChange}
      />
      <HostJoinAppUrlRequiredDialog
        open={appUrlRequiredOpen}
        onOpenChange={setAppUrlRequiredOpen}
      />
    </PageShell>
  );
}
